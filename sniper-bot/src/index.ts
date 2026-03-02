import { startTokenListener, NewTokenEvent } from './listener/tokenListener';
import { checkMetadata } from './filters/metadata';
import { checkMintAuthority } from './filters/mintAuthority';
import { checkBundleDetect } from './filters/bundleDetect';
import { checkRugHistory } from './filters/rugHistory';
import { checkHolderConcentration } from './filters/holderConcentration';
import { logger } from './logger/logger';
import { DRY_RUN } from '../config';
import { initializeGlobal } from './utils/globalState';

async function processNewToken(token: NewTokenEvent) {
    logger.info(`\n🚀 NEW TOKEN DETECTED: ${token.mint}`);
    logger.info(`   Dev: ${token.devWallet}`);

    // Run filters in order of speed & cost (Fail fast)

    // 1. Metadata (Free, fast API call, filters out 95% of tokens instantly)
    if (!(await checkMetadata(token))) return;

    // 2. Mint Authority (Fast, 1 lightweight RPC call)
    if (!(await checkMintAuthority(token))) return;

    // 3. Bundle Detect (Medium, ~6 RPC calls, checks first few blocks)
    if (!(await checkBundleDetect(token))) return;

    // 4. Rug History (Medium-Slow, RPC + API, caches help)
    if (!(await checkRugHistory(token))) return;

    // 5. Holder Concentration (Slowest, getProgramAccounts is heavy)
    if (!(await checkHolderConcentration(token))) return;

    // --- ALL FILTERS PASSED ---
    logger.success(`\n💎 TOKEN PASSED ALL FILTERS! Ready to buy: ${token.mint}\n`);

    if (DRY_RUN) {
        logger.info(`[DRY RUN] Would execute buy for ${token.mint} here`);
    } else {
        // Buy logic will go here
    }
}

// Start bot
(async () => {
    await initializeGlobal();
    logger.info(`Starting sniper bot... DRY_RUN=${DRY_RUN}`);
    startTokenListener((token: NewTokenEvent) => {
        // We launch processing asynchronously so the listener isn't blocked
        processNewToken(token).catch(err => {
            logger.error('Error in processing pipeline', { mint: token.mint, err: String(err) });
        });
    });
})();