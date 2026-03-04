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

async function processNewToken(token: NewTokenEvent) {
    logger.info(`\n🚀 NEW TOKEN DETECTED: ${token.mint}`);
    logger.info(`   Dev: ${token.devWallet}`);

    // Run all 5 filters in parallel — bottleneck is now the slowest single filter
    // (~500ms) rather than their sequential sum (~1,500ms). All filters must pass.
    const [meta, mint, bundle, rug, holder] = await Promise.all([
        checkMetadata(token),
        checkMintAuthority(token),
        checkBundleDetect(token),
        checkRugHistory(token),
        checkHolderConcentration(token),
    ]);
    if (!meta || !mint || !bundle || !rug || !holder) return;

    // --- ALL FILTERS PASSED ---
    logger.success(`\n💎 TOKEN PASSED ALL FILTERS! Ready to buy: ${token.mint}\n`);

    const positionCount = getPositionCount();
    await executeBuy(token, positionCount);
}

// Start bot
(async () => {
    await initializeGlobal();
    // API is now running in a separate standalone process (src/api/index.ts)
    logger.info(`Starting sniper bot... DRY_RUN=${DRY_RUN}`);

    // Start background monitor loop for open positions
    monitorLoop(
        async (pos, sellPct, onConfirmed) => { await executeSell(pos, sellPct, 'TP', onConfirmed); },
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