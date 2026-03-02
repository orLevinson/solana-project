import { PublicKey } from '@solana/web3.js';
import { connection } from '../utils/rpc';
import { logger } from '../logger/logger';
import { NewTokenEvent } from '../listener/tokenListener';
import { BUNDLE_SLOT0_LIMIT, BUNDLE_SLOT12_LIMIT, SIGNATURE_FETCH_LIMIT, CONCURRENCY_LIMIT } from '../../config';
import { badWalletCache } from '../utils/filterCache';

async function fetchParsedTxBatch(signatures: string[]): Promise<(Awaited<ReturnType<typeof connection.getParsedTransaction>>)[]> {
    const results: Awaited<ReturnType<typeof connection.getParsedTransaction>>[] = [];

    for (let i = 0; i < signatures.length; i += CONCURRENCY_LIMIT) {
        const batch = signatures.slice(i, i + CONCURRENCY_LIMIT);
        const fetched = await Promise.all(
            batch.map(sig =>
                connection.getParsedTransaction(sig, {
                    maxSupportedTransactionVersion: 0,
                    commitment: 'confirmed',
                })
            )
        );
        results.push(...fetched);
    }

    return results;
}

/**
 * Groups unique buyer wallets by their slot offset from the mint slot.
 * - Skips null transactions and the dev wallet.
 * - Returns a map of { slotOffset -> Set<buyerAddress> }
 */
function groupBuyersBySlotOffset(
    txs: Awaited<ReturnType<typeof connection.getParsedTransaction>>[],
    mintSlot: number,
    devWallet: string
): Map<number, Set<string>> {
    const slotBuyers = new Map<number, Set<string>>();

    for (const tx of txs) {
        if (!tx) continue;

        const buyer = tx.transaction.message.accountKeys[0].pubkey.toBase58();
        if (buyer === devWallet) continue; // dev's own mint tx — not a bundle buyer

        const offset = tx.slot - mintSlot;
        if (offset < 0) continue; // shouldn't happen, but guard anyway

        if (!slotBuyers.has(offset)) slotBuyers.set(offset, new Set());
        slotBuyers.get(offset)!.add(buyer);
    }

    return slotBuyers;
}

export async function checkBundleDetect(token: NewTokenEvent): Promise<boolean> {
    const { mint, devWallet } = token;

    try {
        if (badWalletCache.has(devWallet)) {
            logger.warning('FILTER_FAIL: known bad wallet (cached)', { mint, devWallet });
            return false;
        }

        // Signatures are returned newest-first, so the last entry is the mint tx
        const sigs = await connection.getSignaturesForAddress(
            new PublicKey(mint),
            { limit: SIGNATURE_FETCH_LIMIT }
        );

        if (sigs.length === 0) return true;

        const mintSlot = sigs[sigs.length - 1].slot;

        const txs = await fetchParsedTxBatch(sigs.map(s => s.signature));
        const slotBuyers = groupBuyersBySlotOffset(txs, mintSlot, devWallet);

        const buyers0 = slotBuyers.get(0)?.size ?? 0;
        const buyers1 = slotBuyers.get(1)?.size ?? 0;
        const buyers2 = slotBuyers.get(2)?.size ?? 0;

        if (buyers0 > BUNDLE_SLOT0_LIMIT) {
            badWalletCache.set(devWallet, true);
            logger.warning('FILTER_FAIL: bundle detected in slot 0', { mint, devWallet, buyers0 });
            return false;
        }

        if (buyers1 > BUNDLE_SLOT12_LIMIT || buyers2 > BUNDLE_SLOT12_LIMIT) {
            badWalletCache.set(devWallet, true);
            logger.warning('FILTER_FAIL: bundle detected in slots 1-2', { mint, devWallet, buyers1, buyers2 });
            return false;
        }

        logger.success('FILTER_PASS: bundleDetect', { mint, buyers0, buyers1, buyers2 });
        return true;

    } catch (err) {
        logger.error('Error in bundleDetect', { mint, err: String(err) });
        return false;
    }
}