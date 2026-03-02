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

export async function sendBundle(
    tx: Transaction | VersionedTransaction,
    payer: Keypair,
    tipSol: number = JITO_TIP
): Promise<{ bundleId: string; signature: string; lastValidBlockHeight: number }> {
    let currentTip = tipSol;
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
                tx.signatures = []; // clear any signatures from previous attempt or SDK pre-signing
                tx.sign(payer);
            } else if (tx instanceof VersionedTransaction) {
                tx.sign([payer]);
            }

            const tipB58 = bs58.encode(tipTx.serialize());
            const mainB58 = bs58.encode(tx.serialize());

            // Round-robin through endpoints on retry to avoid 429s
            const endpoint = JITO_ENDPOINTS[attempt % JITO_ENDPOINTS.length];

            // Log the signature so it can be looked up on Solscan for debugging
            const mainSignature = tx instanceof VersionedTransaction
                ? bs58.encode(tx.signatures[0])
                : bs58.encode((tx as Transaction).signatures[0].signature!);

            logger.info(`Submitting bundle (attempt ${attempt + 1})`, {
                signature: mainSignature,
                tip: cappedTip,
                blockhash,
                lastValidBlockHeight,
                endpoint,
            });

            const res = await fetch(`${endpoint}/api/v1/bundles`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "sendBundle",
                    params: [[mainB58, tipB58]]

                })
            });

            if (!res.ok) {
                throw new Error(`Jito HTTP ${res.status}: ${await res.text()}`);
            }

            const parsedRes = await res.json() as { result?: string; error?: { message: string } };

            if (parsedRes.error) {
                throw new Error(`Jito RPC error: ${parsedRes.error.message}`);
            }

            if (!parsedRes.result) {
                throw new Error('No result from Jito');
            }

            const bundleId = parsedRes.result;
            logger.info(`Bundle accepted by Jito (attempt ${attempt + 1})`, { bundleId, tip: cappedTip });

            return { bundleId, signature: mainSignature, lastValidBlockHeight };

        } catch (error: any) {
            const errorMsg = error?.message || String(error);
            logger.warning(`Bundle submission failed (attempt ${attempt + 1})`, { error: errorMsg });

            if (attempt < maxAttempts - 1) {
                currentTip = Math.min(JITO_TIP_MAX, currentTip * JITO_TIP_ESCALATE);
                await new Promise(resolve => setTimeout(resolve, (JITO_RETRY_SLOTS || 2) * 400));
            }
        }
    }

    throw new Error(`Failed to send bundle after ${maxAttempts} attempts`);
}

export async function pollSignatureConfirmation(
    signature: string,
    lastValidBlockHeight: number,
    maxWaitMs = 30000
): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
        // Check if blockhash has expired — no point waiting further
        const currentHeight = await connection.getBlockHeight('confirmed');
        if (currentHeight > lastValidBlockHeight) {
            logger.warning('Blockhash expired before confirmation', { signature, currentHeight, lastValidBlockHeight });
            return false;
        }

        const { value } = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
        if (value) {
            if (value.err) {
                throw new Error(`Transaction confirmed but failed on-chain: ${JSON.stringify(value.err)}`);
            }
            if (value.confirmationStatus === 'confirmed' || value.confirmationStatus === 'finalized') {
                return true;
            }
        }

        await new Promise(resolve => setTimeout(resolve, 500)); // poll every 500ms, was 1500ms
    }

    return false;
}