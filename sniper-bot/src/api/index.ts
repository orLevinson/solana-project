import express from 'express';
import cors from 'cors';
import { DRY_RUN, BUY_SIZE, MAX_POSITIONS, GAS_RESERVE, SLIPPAGE, JITO_TIP, PUMP_FUN_PROGRAM_ID } from '../../config';
import { createStore } from '../utils/jsonStore';
import { Position } from '../trading/positionManager';
import { connection } from '../utils/rpc';
import { wallet } from '../utils/wallet';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { logger } from '../logger/logger';
import { dryRunState } from '../utils/dryRun';

const app = express();
app.use(cors());

// Define port - default 3000
const PORT = process.env.API_PORT || 3000;

// Since the API runs in a separate process, it must read from disk, not memory.
const storeName = DRY_RUN ? 'positions_dryrun' : 'positions';
const store = createStore<Position>(storeName);

app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        mode: DRY_RUN ? 'DRY_RUN' : 'LIVE',
        timestamp: Date.now()
    });
});

app.get('/api/config', (req, res) => {
    res.json({
        mode: DRY_RUN ? 'DRY_RUN' : 'LIVE',
        buySize: BUY_SIZE,
        maxPositions: MAX_POSITIONS,
        gasReserve: GAS_RESERVE,
        slippage: SLIPPAGE,
        jitoTipBase: JITO_TIP,
        pumpFunProgramId: PUMP_FUN_PROGRAM_ID
    });
});

app.get('/api/balance', async (req, res) => {
    try {
        let solBalance = 0;
        if (DRY_RUN) {
            solBalance = await dryRunState.getBalance();
        } else {
            const lamports = await connection.getBalance(wallet.publicKey);
            solBalance = lamports / LAMPORTS_PER_SOL;
        }

        res.json({
            wallet: wallet.publicKey.toBase58(),
            balanceSol: Number(solBalance.toFixed(4)),
            isDryRun: DRY_RUN
        });
    } catch (error: any) {
        logger.error(`[API] Failed to fetch balance`, { err: String(error) });
        res.status(500).json({ error: 'Failed to fetch balance' });
    }
});

app.get('/api/positions/active', (req, res) => {
    // Read fresh from disk since we are a separate process
    const allPositions = Object.values(store.getAll());
    const activePositions = allPositions.filter(p => p.status === 'active');
    res.json(activePositions);
});

app.get('/api/positions/history', (req, res) => {
    const allPositions = Object.values(store.getAll());
    const soldPositions = allPositions.filter(p => p.status === 'sold');
    soldPositions.sort((a, b) => b.entryTime - a.entryTime);
    res.json(soldPositions);
});

app.get('/api/pnl', (req, res) => {
    const allPositions = Object.values(store.getAll());
    const soldPositions = allPositions.filter(p => p.status === 'sold');

    const totalTrades = soldPositions.length;
    let wins = 0;

    // Accurate PNL tracking using the exact SOL amounts recorded in history
    let netPnl = 0;

    soldPositions.forEach(p => {
        const history = p.history || [];
        const isWin = history.some(h => h.type === 'sell' && h.reason === 'TP');
        if (isWin) wins++;

        const totalSoldSol = history
            .filter(h => h.type === 'sell')
            .reduce((sum, h) => sum + h.solAmount, 0);

        // net = SOL returned minus SOL spent
        netPnl += (totalSoldSol - p.solSpent);
    });

    const winRate = totalTrades === 0 ? 0 : (wins / totalTrades) * 100;

    res.json({
        totalTrades,
        wins,
        losses: totalTrades - wins,
        winRate: Number(winRate.toFixed(2)),
        netPnl: Number(netPnl.toFixed(4)),
        currency: 'SOL'
    });
});

app.get('/api/chart/balance', async (req, res) => {
    try {
        let currentBalance = 0;
        if (DRY_RUN) {
            currentBalance = await dryRunState.getBalance();
        } else {
            const lamports = await connection.getBalance(wallet.publicKey);
            currentBalance = lamports / LAMPORTS_PER_SOL;
        }

        const allPositions = Object.values(store.getAll());

        const events: { time: number, delta: number }[] = [];
        allPositions.forEach(p => {
            events.push({ time: p.entryTime, delta: -p.solSpent });
            const history = p.history || [];
            history.filter(h => h.type === 'sell').forEach(h => {
                events.push({ time: h.timestamp, delta: h.solAmount });
            });
        });

        events.sort((a, b) => a.time - b.time);
        const totalDelta = events.reduce((sum, e) => sum + e.delta, 0);
        let assumedStartingBalance = currentBalance - totalDelta;

        const dataPoints = [];
        if (events.length > 0) {
            dataPoints.push({
                time: events[0].time - 60000,
                balance: Number(assumedStartingBalance.toFixed(4))
            });
        } else {
            dataPoints.push({
                time: Date.now() - 60000,
                balance: Number(currentBalance.toFixed(4))
            });
        }

        let runningBalance = assumedStartingBalance;
        events.forEach(e => {
            runningBalance += e.delta;
            dataPoints.push({
                time: e.time,
                balance: Number(runningBalance.toFixed(4))
            });
        });

        dataPoints.push({
            time: Date.now(),
            balance: Number(currentBalance.toFixed(4))
        });

        res.json(dataPoints);
    } catch (error: any) {
        logger.error(`[API] Failed to fetch chart balance`, { err: String(error) });
        res.status(500).json({ error: 'Failed to fetch chart balance' });
    }
});

app.listen(PORT, () => {
    logger.info(`[API] Server listening on port ${PORT}`);
    logger.info(`[API] Status: http://localhost:${PORT}/api/status`);
    logger.info(`[API] Balance: http://localhost:${PORT}/api/balance`);
    logger.info(`[API] Config: http://localhost:${PORT}/api/config`);
    logger.info(`[API] Active Positions: http://localhost:${PORT}/api/positions/active`);
    logger.info(`[API] History: http://localhost:${PORT}/api/positions/history`);
    logger.info(`[API] PNL: http://localhost:${PORT}/api/pnl`);
});
