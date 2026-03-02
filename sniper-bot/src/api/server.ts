import express from 'express';
import cors from 'cors';
import { logger } from '../logger/logger';
import { DRY_RUN } from '../../config';
import { cachedStore, getHistoryStore } from '../trading/positionManager';

const app = express();
app.use(cors());

// Define port - default 3000
const PORT = process.env.API_PORT || 3000;

app.get('/api/status', (req, res) => {
    res.json({
        status: 'online',
        mode: DRY_RUN ? 'DRY_RUN' : 'LIVE',
        timestamp: Date.now()
    });
});

app.get('/api/positions/active', (req, res) => {
    // cachedStore only holds active positions
    const activePositions = Array.from(cachedStore.values());
    res.json(activePositions);
});

app.get('/api/positions/history', (req, res) => {
    const historyStore = getHistoryStore();
    const allPositions = Object.values(historyStore.getAll());
    const soldPositions = allPositions.filter(p => p.status === 'sold');

    // Sort newest closed first
    soldPositions.sort((a, b) => b.entryTime - a.entryTime);
    res.json(soldPositions);
});

app.get('/api/pnl', (req, res) => {
    const historyStore = getHistoryStore();
    const allPositions = Object.values(historyStore.getAll());
    const soldPositions = allPositions.filter(p => p.status === 'sold');

    const totalTrades = soldPositions.length;
    let wins = 0;
    let netPnlEstimate = 0; // In reality, this should be tracked tightly in sellEngine output

    soldPositions.forEach(p => {
        const tpFiredCount = p.tpSteps.filter(s => s.triggered).length;
        if (tpFiredCount > 0) {
            wins++;
            netPnlEstimate += p.solSpent * 0.5; // Rough estimation: average 50% profit
        } else {
            netPnlEstimate -= p.solSpent * 0.4; // Rough estimation: full SL hit
        }
    });

    const winRate = totalTrades === 0 ? 0 : (wins / totalTrades) * 100;

    res.json({
        totalTrades,
        wins,
        losses: totalTrades - wins,
        winRate: Number(winRate.toFixed(2)),
        netPnlEstimate: Number(netPnlEstimate.toFixed(4)),
        currency: 'SOL'
    });
});

export function startApiServer() {
    app.listen(PORT, () => {
        logger.info(`[API] Server listening on port ${PORT}`);
        logger.info(`[API] Active Positions: http://localhost:${PORT}/api/positions/active`);
        logger.info(`[API] History: http://localhost:${PORT}/api/positions/history`);
        logger.info(`[API] PNL: http://localhost:${PORT}/api/pnl`);
    });
}
