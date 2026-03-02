import { startTokenListener, NewTokenEvent } from './listener/tokenListener';
import { checkMetadata } from './filters/metadata';
import { checkMintAuthority } from './filters/mintAuthority';
import { checkBundleDetect } from './filters/bundleDetect';
import { checkRugHistory } from './filters/rugHistory';
import { checkHolderConcentration } from './filters/holderConcentration';
import { logger } from './logger/logger';
import { DRY_RUN } from '../config';
import { initializeGlobal } from './utils/globalState';
import { executeBuy } from './trading/buyEngine';
import { executeSell } from './trading/sellEngine';
import { monitorLoop, getPositionCount } from './trading/positionManager';
import { startApiServer } from './api/server';

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

    const positionCount = getPositionCount();
    await executeBuy(token, positionCount);
}

// Start bot
(async () => {
    await initializeGlobal();
    startApiServer();
    logger.info(`Starting sniper bot... DRY_RUN=${DRY_RUN}`);

    // Start background monitor loop for open positions
    monitorLoop(
        async (pos, sellPct) => { await executeSell(pos, sellPct, 'TP'); },
        async (pos) => { await executeSell(pos, 1.0, 'SL'); },
        async (pos) => { await executeSell(pos, 1.0, 'TIME_STOP'); }
    ).catch((err: any) => {
        logger.error('Monitor loop crashed', { err: String(err) });
    });

    startTokenListener((token: NewTokenEvent) => {
        // We launch processing asynchronously so the listener isn't blocked
        processNewToken(token).catch(err => {
            logger.error('Error in processing pipeline', { mint: token.mint, err: String(err) });
        });
    });

    // Graceful shutdown
    process.on('SIGINT', () => {
        logger.warning('\n[SYSTEM] Caught interrupt signal (CTRL+C). Shutting down...');
        setTimeout(() => process.exit(0), 1000);
    });
})();