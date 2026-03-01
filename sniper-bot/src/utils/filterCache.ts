import { LRUCache } from './cache';
import {
    BAD_WALLET_CACHE_SIZE,
    HOLDER_CACHE_MAX_SIZE,
    HOLDER_CACHE_TTL_MS,
} from '../../config';

// Wallet caches
export const badWalletCache = new LRUCache<string, true>(BAD_WALLET_CACHE_SIZE, 0);
export const passWalletCache = new LRUCache<string, true>(BAD_WALLET_CACHE_SIZE, 5 * 60_000);

// Mint caches (per-token data)
export const holderCache = new LRUCache<string, { concentrated: boolean; topPct: number }>(
    HOLDER_CACHE_MAX_SIZE,
    HOLDER_CACHE_TTL_MS
);
