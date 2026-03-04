import { Transaction, VersionedTransaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import { connection } from "./rpc";
import bs58 from "bs58";
import { logger } from "../logger/logger";
import { JITO_TIP_ACCOUNTS, JITO_ENDPOINTS, JITO_TIP, JITO_TIP_MAX, JITO_RETRY_SLOTS, JITO_TIP_ESCALATE } from "../../config";

export function getRandomTipAccount(): PublicKey {
    const randomIndex = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
    return new PublicKey(JITO_TIP_ACCOUNTS[randomIndex]);
}

export function buildTipTransaction(blockhash: string, payer: Keypair, tipLamports: number): Transaction {
    const tx = new Transaction().add(
        SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: getRandomTipAccount(),
            lamports: tipLamports,
        })
    );

    tx.recentBlockhash = blockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);
    return tx;
}

// ─────────────────────────────────────────────────────────────
// DYNAMIC JITO TIP TRACKER
// ─────────────────────────────────────────────────────────────
let cachedDynamicTip = JITO_TIP;

async function trackJitoTipFloor() {
    try {
        const res = await fetch('https://bundles.jito.wtf/api/v1/bundles/tip_floor');
        if (!res.ok) return;
        const data = await res.json() as any[];
        if (data && data.length > 0) {
            // Using the 75th percentile for strong confirmation chances while avoiding overpaying
            const p95 = data[0].landed_tips_95th_percentile;
            if (typeof p95 === 'number') {
                // Clamp between JITO_TIP (floor) and JITO_TIP_MAX (ceiling).
                // Without Math.max, the API can return near-zero values and we massively underbid.
                cachedDynamicTip = Math.max(JITO_TIP, Math.min(JITO_TIP_MAX, p95));
            }
        }
    } catch (e) {
        // Silent catch — we don't want to spam logs if the tip API temporarily disconnects
    }
}

// Poll every 5 seconds in the background
setInterval(trackJitoTipFloor, 5000);
trackJitoTipFloor(); // Call once on initialization

export function getDynamicTip(): number {
    return cachedDynamicTip;
}
// ─────────────────────────────────────────────────────────────

export async function sendBundle(
    tx: Transaction | VersionedTransaction,
    payer: Keypair,
): Promise<{ bundleId: string; signature: string; lastValidBlockHeight: number }> {
    let currentTip = getDynamicTip();
    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const cappedTip = Math.min(currentTip, JITO_TIP_MAX);
            const tipLamports = Math.floor(cappedTip * LAMPORTS_PER_SOL);

            // Fresh blockhash every attempt — stale blockhash is the #1 cause of dropped bundles
            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

            const tipTx = buildTipTransaction(blockhash, payer, tipLamports);

            if (tx instanceof Transaction) {
                tx.recentBlockhash = blockhash;
                tx.feePayer = payer.publicKey;
                tx.signatures = [];
                tx.sign(payer);

                logger.info('Transaction signed', {
                    signature: tx.signatures[0]?.signature
                        ? bs58.encode(tx.signatures[0].signature)
                        : 'NULL - SIGNING FAILED',
                    feePayer: tx.feePayer?.toBase58(),
                    blockhash: tx.recentBlockhash,
                    instructionCount: tx.instructions.length,
                });

                if (!tx.signatures[0]?.signature) {
                    throw new Error('Transaction signing failed — signature is null');
                }

                // Simulate once before any network call — catches slippage/account errors
                // without burning the tip or wasting endpoint slots
                const simResult = await connection.simulateTransaction(tx);
                if (simResult.value.err) {
                    const errStr = JSON.stringify(simResult.value.err);
                    const logs = simResult.value.logs?.slice(-5).join(' | ') ?? '';
                    logger.warning(`Simulation failed — skipping bundle (attempt ${attempt + 1})`, { err: errStr, logs });
                    throw new Error(`SimulationFailed: ${errStr}`);
                }
            } else if (tx instanceof VersionedTransaction) {
                tx.sign([payer]);
                if (!tx.signatures[0]) {
                    throw new Error('VersionedTransaction signing failed');
                }
            }

            const mainSignature = tx instanceof VersionedTransaction
                ? bs58.encode(tx.signatures[0])
                : bs58.encode(tx.signatures[0].signature!);

            const tipB58 = bs58.encode(tipTx.serialize());
            const mainB58 = bs58.encode(tx.serialize());
            const body = JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'sendBundle',
                params: [[mainB58, tipB58]],
            });

            // Fan-out to ALL endpoints simultaneously — first acceptance wins.
            // Jito's 429 is global across endpoints (same rate bucket), so sequential
            // round-robin just burns seconds. A parallel race means one healthy endpoint
            // landing is enough, and we shed no time waiting for failed ones.
            logger.info(`Submitting bundle to all endpoints (attempt ${attempt + 1})`, {
                signature: mainSignature,
                tip: cappedTip,
                blockhash,
                lastValidBlockHeight,
                endpointCount: JITO_ENDPOINTS.length,
            });

            const { bundleId, endpoint } = await Promise.any(
                JITO_ENDPOINTS.map(async (ep) => {
                    const res = await fetch(`${ep}/api/v1/bundles`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body,
                    });
                    if (!res.ok) {
                        throw new Error(`Jito HTTP ${res.status} from ${ep}: ${await res.text()}`);
                    }
                    const parsed = await res.json() as { result?: string; error?: { message: string } };
                    if (parsed.error) throw new Error(`Jito RPC error from ${ep}: ${parsed.error.message}`);
                    if (!parsed.result) throw new Error(`No result from ${ep}`);
                    return { bundleId: parsed.result, endpoint: ep };
                })
            );

            logger.info(`Bundle accepted by Jito (attempt ${attempt + 1})`, { bundleId, tip: cappedTip, endpoint });
            return { bundleId, signature: mainSignature, lastValidBlockHeight };

        } catch (error: any) {
            // AggregateError = Promise.any() — ALL endpoints rejected
            const errorMsg = error instanceof AggregateError
                ? error.errors.map((e: any) => e?.message ?? String(e)).join(' | ')
                : (error?.message || String(error));

            logger.warning(`Bundle submission failed (attempt ${attempt + 1})`, { error: errorMsg });

            if (attempt < maxAttempts - 1) {
                currentTip = Math.min(JITO_TIP_MAX, currentTip * JITO_TIP_ESCALATE);
                // SimulationFailed = on-chain error, no benefit from retrying immediately.
                // Network rejection = short wait then retry with higher tip.
                const isSimFail = errorMsg.includes('SimulationFailed');
                const delay = isSimFail ? 0 : (JITO_RETRY_SLOTS || 2) * 400;
                if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    throw new Error(`Failed to send bundle after ${maxAttempts} attempts`);
}


export async function pollSignatureConfirmation(signature: string): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < 30000) {
        try {
            const { value } = await connection.getSignatureStatus(signature);
            if (value) {
                if (value.err) {
                    // Tx landed on-chain but failed (slippage, bad account, etc.)
                    logger.warning('Transaction landed but failed on-chain', {
                        signature,
                        err: JSON.stringify(value.err),
                        confirmationStatus: value.confirmationStatus,
                    });
                    return false;
                }
                if (value.confirmationStatus === 'confirmed' || value.confirmationStatus === 'finalized') {
                    return true;
                }
            }
        } catch (e) {
            // If we hit a 429 here, wait longer
            await new Promise(r => setTimeout(r, 2000));
        }
        // 1000ms poll interval to save Helius credits
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    // Timeout — bundle was accepted by Jito but never landed in a block
    logger.warning('Bundle confirmation timeout — tx not seen on-chain after 30s', { signature });
    return false;
}