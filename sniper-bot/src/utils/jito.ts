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

export async function sendBundle(tx: Transaction | VersionedTransaction, payer: Keypair, tipSol: number = JITO_TIP): Promise<{ bundleId: string, signature: string }> {
    let currentTip = tipSol;
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const cappedTip = Math.min(currentTip, JITO_TIP_MAX);
            const tipLamports = Math.floor(cappedTip * LAMPORTS_PER_SOL);
            const { blockhash } = await connection.getLatestBlockhash();
            const tipTx = buildTipTransaction(blockhash, payer, tipLamports);

            if (tx instanceof Transaction) {
                tx.recentBlockhash = blockhash;
                tx.feePayer = payer.publicKey;
                // Sign the transaction with the new blockhash
                tx.sign(payer);
            } else if (tx instanceof VersionedTransaction) {
                // For VersionedTransactions, we would need to reconstruct the message with the new blockhash
                // However, pump.fun SDK returns standard Transactions, so this is just a safeguard
                tx.sign([payer]);
            }

            const tipB58 = bs58.encode(tipTx.serialize());
            const mainB58 = bs58.encode(tx.serialize());

            // Round-robin through endpoints on retry to avoid 429 Rate Limits
            const endpoint = JITO_ENDPOINTS[attempt % JITO_ENDPOINTS.length];

            const res = await fetch(`${endpoint}/api/v1/bundles`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "sendBundle",
                    params: [[tipB58, mainB58]]
                })
            });

            if (!res.ok) {
                throw new Error(`Jito HTTP ${res.status}: ${await res.text()}`)
            }

            const parsedRes = await res.json() as { result?: string; error?: { message: string } };

            if (parsedRes.error) {
                throw new Error(`Jito RPC error: ${parsedRes.error.message}`)
            }

            if (!parsedRes.result) {
                throw new Error('No result from Jito')
            }

            const bundleId = parsedRes.result!;
            logger.info(`Bundle submitted to Jito (attempt: ${attempt + 1}): ${bundleId}`, { bundleId, tipSol: cappedTip });

            // Extract main transaction signature
            let mainSignature: string;
            if (tx instanceof VersionedTransaction) {
                mainSignature = bs58.encode(tx.signatures[0]);
            } else {
                mainSignature = bs58.encode(tx.signatures[0].signature!);
            }

            return { bundleId, signature: mainSignature };

        } catch (error: any) {
            const errorMsg = error?.message || String(error);
            logger.warning(`Bundle submission failed (attempt: ${attempt + 1})`, { error: errorMsg });
            if (attempt < maxAttempts - 1) {
                currentTip = Math.min(JITO_TIP_MAX, currentTip * JITO_TIP_ESCALATE);
                // JITO_RETRY_SLOTS from config is usually undefined if not in config.ts, let's fallback to 2
                await new Promise(resolve => setTimeout(resolve, (JITO_RETRY_SLOTS || 2) * 400));
            }
        }
    }
    throw new Error(`Failed to send bundle after ${maxAttempts} attempts`);
}

export async function pollSignatureConfirmation(signature: string, maxWaitMs = 15000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
        const { value } = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
        if (value) {
            if (value.err) {
                throw new Error(`Transaction confirmed but failed: ${JSON.stringify(value.err)}`);
            }
            if (value.confirmationStatus === 'confirmed' || value.confirmationStatus === 'finalized') {
                return true;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
    return false;
}
