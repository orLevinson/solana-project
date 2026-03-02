import { logger } from '../logger/logger';
import { connection } from '../utils/rpc';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
    NEW_WALLET_TX_COUNT,
    RUG_WALLET_TX_FETCH_COUNT,
    RUG_SCORE_THRESHOLD,
    MIN_DEV_SOL_BALANCE,
    MIN_DEV_BUY_SOL,
    MIN_WALLET_AGE_DAYS,
} from '../../config';
import { badWalletCache, passWalletCache } from '../utils/filterCache';
import { NewTokenEvent } from '../listener/tokenListener';

interface RugCheckReport {
    score_normalised: number; // 0–100 scale
}

async function fetchRugCheckScore(mint: string): Promise<number | null> {
    try {
        const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`);
        if (!res.ok) return null;
        const data = await res.json() as RugCheckReport;
        return data.score_normalised;
    } catch (err) {
        logger.error('Error fetching rug check score', { mint, err: String(err) });
        return null; // API down → skip, don't block
    }
}

export async function checkRugHistory(token: NewTokenEvent): Promise<boolean> {
    const { mint, devWallet, devBuyLamports } = token;
    try {
        // Cache checks (instant, no RPC)
        if (badWalletCache.has(devWallet)) {
            logger.warning('FILTER_FAIL: known bad wallet (cached)', { mint, devWallet });
            return false;
        }
        if (passWalletCache.has(devWallet)) {
            logger.success('FILTER_PASS: rugHistory (cached)', { mint, devWallet });
            return true;
        }

        // Dev buy size (no extra RPC — data from tokenListener)
        const devBuySol = devBuyLamports / LAMPORTS_PER_SOL;
        if (devBuySol < MIN_DEV_BUY_SOL) {
            badWalletCache.set(devWallet, true);
            logger.warning('FILTER_FAIL: dev buy too small', { mint, devBuySol: devBuySol.toFixed(4) });
            return false;
        }

        // Parallel: sigs + rug score + SOL balance
        const [sigs, rugScore, balanceLamports] = await Promise.all([
            connection.getSignaturesForAddress(new PublicKey(devWallet), { limit: RUG_WALLET_TX_FETCH_COUNT }),
            fetchRugCheckScore(mint),
            connection.getBalance(new PublicKey(devWallet)),
        ]);

        // SOL balance check
        const balanceSol = balanceLamports / LAMPORTS_PER_SOL;
        if (balanceSol < MIN_DEV_SOL_BALANCE) {
            badWalletCache.set(devWallet, true);
            logger.warning('FILTER_FAIL: dev wallet balance too low', { mint, balanceSol: balanceSol.toFixed(4) });
            return false;
        }

        // Brand new wallet check
        if (sigs.length < NEW_WALLET_TX_COUNT) {
            badWalletCache.set(devWallet, true);
            logger.warning('FILTER_FAIL: brand new wallet', { mint, devWallet, txCount: sigs.length });
            return false;
        }

        // Wallet age estimate
        // If our whole batch of sigs is recent AND batch isn't full (<50),
        // the wallet is confirmed young. If batch IS full, wallet might be older.
        const oldestSig = sigs[sigs.length - 1];
        if (oldestSig.blockTime && sigs.length < RUG_WALLET_TX_FETCH_COUNT) {
            const ageSeconds = Date.now() / 1000 - oldestSig.blockTime;
            const ageDays = ageSeconds / 86400;
            if (ageDays < MIN_WALLET_AGE_DAYS) {
                badWalletCache.set(devWallet, true);
                logger.warning('FILTER_FAIL: wallet too young', { mint, ageDays: ageDays.toFixed(1) });
                return false;
            }
        }

        if (rugScore !== null && rugScore > RUG_SCORE_THRESHOLD) {
            badWalletCache.set(devWallet, true);
            logger.warning('FILTER_FAIL: high rug score', { mint, rugScore });
            return false;
        }

        passWalletCache.set(devWallet, true);
        logger.success('FILTER_PASS: rugHistory', {
            mint,
            devWallet,
            txCount: sigs.length,
            devBuySol: devBuySol.toFixed(4),
            balanceSol: balanceSol.toFixed(4),
        });
        return true;

    } catch (err) {
        logger.error('Error checking rug history', { mint, err: String(err) });
        return false; // fail safe
    }
}
