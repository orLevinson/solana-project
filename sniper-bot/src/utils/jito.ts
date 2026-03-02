import { Transaction, VersionedTransaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import { connection } from "./rpc";
import bs58 from "bs58";
import { logger } from "../logger/logger";
import { JITO_TIP_ACCOUNTS, JITO_BLOCK_ENGINE_URL, JITO_TIP, JITO_TIP_MAX, JITO_RETRY_SLOTS, JITO_TIP_ESCALATE } from "../../config";

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

export async function sendBundle(tx: Transaction | VersionedTransaction, payer: Keypair, tipSol: number = JITO_TIP): Promise<string> {
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
                tx.sign(payer);
            }

            const tipB58 = bs58.encode(tipTx.serialize());
            const mainB58 = bs58.encode(tx.serialize());

            const res = await fetch(`${JITO_BLOCK_ENGINE_URL}/api/v1/bundles`, {
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
            logger.info(`Bundle submitted successfully (attempt: ${attempt + 1}): ${bundleId}`, { bundleId, tipSol: cappedTip });
            return bundleId;

        } catch (error) {
            logger.warning(`Bundle submission failed (attempt: ${attempt + 1})`, { error });
            if (attempt < maxAttempts - 1) {
                currentTip = Math.min(JITO_TIP_MAX, currentTip * JITO_TIP_ESCALATE);
                await new Promise(resolve => setTimeout(resolve, JITO_RETRY_SLOTS * 400));
            }
        }
    }
    throw new Error(`Failed to send bundle after ${maxAttempts} attempts`);
}
