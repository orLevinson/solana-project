import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { connection } from '../utils/rpc';
import { logger } from '../logger/logger';
import { NewTokenEvent } from '../listener/tokenListener';
import { HOLDER_CONCENTRATION_LIMIT, HOLDER_CACHE_ENABLED } from '../../config';
import { holderCache } from '../utils/filterCache';

export async function checkHolderConcentration(token: NewTokenEvent): Promise<boolean> {
    const { mint, devWallet } = token;
    try {
        if (HOLDER_CACHE_ENABLED) {
            const cached = holderCache.get(mint);
            if (cached !== undefined) {
                if (cached.concentrated) {
                    logger.warning('FILTER_FAIL: holder concentration (cached)', { mint, topPct: cached.topPct });
                    return false;
                }
                logger.success('FILTER_PASS: holderConcentration (cached)', { mint });
                return true;
            }
        }

        const accounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
            filters: [
                { dataSize: 165 },
                { memcmp: { offset: 0, bytes: mint } },
            ],
        });
        const balances = accounts
            .map(account => account.account.data.readBigUInt64LE(64))
            .filter(balance => balance > 0n);
        if (balances.length === 0) {
            holderCache.set(mint, { concentrated: false, topPct: 0 });
            logger.warning('FILTER_PASS: no balances found', { mint, devWallet });
            return true;
        }
        const total = balances.reduce((sum, b) => sum + b, 0n);
        const topPct = Math.max(...balances.map(b => Number(b) / Number(total)));
        if (topPct > HOLDER_CONCENTRATION_LIMIT) {
            holderCache.set(mint, { concentrated: true, topPct });
            logger.warning('FILTER_FAIL: holder concentration', { mint, topPct });
            return false;
        }

        holderCache.set(mint, { concentrated: false, topPct });
        logger.success('FILTER_PASS: holderConcentration', { mint });
        return true;
    } catch (err) {
        logger.error('Error checking holder concentration', { mint, err: String(err) });
        return false;
    }
}