import { LRUCache } from '../utils/cache';
import { BAD_WALLET_CACHE_SIZE } from '../../config';


// Bad wallets stay flagged for the entire process lifetime (TTL = 0)
// Good wallets stay flagged for 5 minutes to prevent duplicate API calls
export const badWalletCache = new LRUCache<string, true>(BAD_WALLET_CACHE_SIZE, 0);
export const passCache = new LRUCache<string, true>(BAD_WALLET_CACHE_SIZE, 5 * 60_000); // 5 min TTL
