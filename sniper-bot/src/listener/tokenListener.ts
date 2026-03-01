import { connection } from '../utils/rpc';
import { PUMP_FUN_PROGRAM_ID } from '../../config';
import { PublicKey } from '@solana/web3.js';
import { logger } from '../logger/logger';

// ─────────────────────────────────────────────────────────────
// The event emitted for every newly detected pump.fun token.
//
// The listener's job is to be FAST and LEAN:
// - mint and devWallet come straight from accountKeys (no extra RPC)
// - name/symbol/metadataUrl are left to the metadata filter (Step 5)
//   which fetches the Arweave/IPFS JSON and also checks for socials.
// ─────────────────────────────────────────────────────────────
export interface NewTokenEvent {
    mint:      string;   // token mint address
    devWallet: string;   // address that paid for / created the token
    timestamp: number;   // ms since epoch — used by time stop logic
}

type TokenCallback = (token: NewTokenEvent) => void;

// ─────────────────────────────────────────────────────────────
// Subscribes to pump.fun program logs via Helius WebSocket.
// Every new token creation emits "InitializeMint2" in its logs.
// On detection: fetch the transaction, extract mint + dev wallet,
// fire the callback. Everything else is handled downstream.
// ─────────────────────────────────────────────────────────────
export function startTokenListener(onToken: TokenCallback): void {
    const programPublicKey = new PublicKey(PUMP_FUN_PROGRAM_ID);
    console.log('[Listener] Listening for new token launches on pump.fun...');

    connection.onLogs(programPublicKey, async ({ logs, signature }) => {
        try {
            // Fast path: ignore all pump.fun txs that aren't token creations
            const isNewToken = logs.some(line => line.includes('InitializeMint2'));
            if (!isNewToken) return;

            logger.info('[Listener] New token detected!', { signature });

            // Fetch the full transaction to read account keys
            const tx = await connection.getParsedTransaction(signature, {
                maxSupportedTransactionVersion: 0,
                commitment: 'confirmed',
            });
            if (!tx) {
                logger.warning('[Listener] TX not available yet, skipping token.', { signature });
                return;
            }

            const accountKeys = tx.transaction.message.accountKeys;

            // accountKeys[0] = fee payer = the dev/creator (writable signer)
            // accountKeys[1] = mint      = the new token's mint address
            const devWallet = accountKeys[0].pubkey.toBase58();
            const mint      = accountKeys[1].pubkey.toBase58();

            const event: NewTokenEvent = { mint, devWallet, timestamp: Date.now() };

            logger.info('[Listener] Token ready!', { mint, devWallet });
            onToken(event);

        } catch (err) {
            // Never throw from an async onLogs callback — it would create an
            // unhandled Promise rejection that could kill the WebSocket.
            logger.error('[Listener] Error processing tx:', { signature, err });
        }
    }, 'confirmed');

    logger.info('[Listener] Token listener started. Waiting for new tokens...');
}
