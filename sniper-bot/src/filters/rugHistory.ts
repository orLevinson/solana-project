import { logger } from '../logger/logger';
import { connection } from '../utils/rpc';
import { PublicKey } from '@solana/web3.js';
import { NEW_WALLET_TX_COUNT, RUG_WALLET_TX_FETCH_COUNT, RUG_SCORE_THRESHOLD } from '../../config';
import { badWalletCache, passWalletCache } from '../utils/filterCache';
import { NewTokenEvent } from '../listener/tokenListener';

interface RugCheckReport {
    score: number;              // 0 = safe, 1000 = extreme risk
}

async function fetchRugCheckScore(mint: string): Promise<number | null> {
    try {
        const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`);
        if (!res.ok) return null;
        const data = await res.json() as RugCheckReport;
        return data.score;
    } catch (err) {
        logger.error('Error fetching rug check score', { mint, err: String(err) });
    return null; // API down → skip this check, don't block
  }
}

export async function checkRugHistory(token: NewTokenEvent): Promise<boolean> {
    const { mint, devWallet } = token;
    try {
        // Cache hit = already confirmed bad — reject instantly, no RPC needed
        if (badWalletCache.has(devWallet)) {
            logger.warning('FILTER_FAIL: known bad wallet (cached)', { mint, devWallet });
            return false;
        }
        if (passWalletCache.has(devWallet)) {
            logger.success('FILTER_PASS: known good wallet (cached)', { mint, devWallet });
            return true;
        }

        const [sigs, rugScore] = await Promise.all([
            connection.getSignaturesForAddress(new PublicKey(devWallet), { limit: RUG_WALLET_TX_FETCH_COUNT }),
            fetchRugCheckScore(mint),
        ]);

        // Brand new wallet = almost certainly created just to rug
        // Typical rug wallet: 1 funding tx + 1 create tx = 2-3 total
        if (sigs.length < NEW_WALLET_TX_COUNT) {
            badWalletCache.set(devWallet, true);
            logger.warning('FILTER_FAIL: brand new wallet', { mint, devWallet, txCount: sigs.length });
            return false;
        }

        if (rugScore !== null && rugScore > RUG_SCORE_THRESHOLD) {
            badWalletCache.set(devWallet, true);
            logger.warning('FILTER_FAIL: high rug score', { mint, rugScore });
            return false;
        }

        logger.success('FILTER_PASS: rugHistory', { mint, devWallet, txCount: sigs.length });
        return true;

    } catch (err) {
        logger.error('Error checking rug history', { mint, err: String(err) });
        return false; // fail safe — never buy if we can't verify
    }
}
