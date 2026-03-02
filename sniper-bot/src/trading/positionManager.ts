import { getPrice } from './priceOracle';
import { logger } from '../logger/logger';
import { PRICE_POLL_INTERVAL, EXIT_STRATEGY, TpStep } from '../../config';
import { NewTokenEvent } from '../listener/tokenListener';
import { createStore } from '../utils/jsonStore';

export interface Position {
    tokenData: NewTokenEvent;
    entryPrice: number;
    entryTime: number;
    solSpent: number;
    tokensBought: number;
    remainingTokens: number;
    tpSteps: (TpStep & { triggered: boolean })[]; // deep copy with triggered state
    stopLoss: number;   // current floor, moves up after each TP step
    status: 'active' | 'sold';
    isProcessing: boolean;
}

const store = createStore<Position>('positions');

const cachedStore = new Map<string, Position>(
    Object.entries(store.getAll())
        .filter(([, p]) => p.status === 'active')
        .map(([k, p]) => [k, { ...p, isProcessing: false }]) // reset stale locks from crash
);

export function addPosition(tokenData: NewTokenEvent, solSpent: number, tokensBought: number) {
    const entryPrice = solSpent / tokensBought;
    const position: Position = {
        tokenData,
        entryPrice,
        entryTime: Date.now(),
        solSpent,
        tokensBought,
        remainingTokens: tokensBought,
        tpSteps: EXIT_STRATEGY.tpSteps.map(s => ({ ...s, triggered: false })),
        stopLoss: EXIT_STRATEGY.startSL,
        status: 'active',
        isProcessing: false
    };
    cachedStore.set(tokenData.mint, position);
    store.set(tokenData.mint, position);
    logger.info(`[PositionManager] Added position for ${tokenData.symbol}`, { position });
}

export function removePosition(mint: string) {
    cachedStore.delete(mint);
    const position = store.get(mint);
    if (position) {
        position.status = 'sold';
        store.set(mint, position);
    }
    logger.info(`[PositionManager] Removed position for ${mint}`);
}

export function updatePosition(mint: string, update: Partial<Position>) {
    const position = cachedStore.get(mint);
    if (position) {
        Object.assign(position, update);
        store.set(mint, position);
        cachedStore.set(mint, position);
        logger.info(`[PositionManager] Updated position for ${mint}`, { update });
    }
}

export function getPositionCount(): number {
    return cachedStore.size;
}

export function getPosition(mint: string): Position | undefined {
    return cachedStore.get(mint);
}

export async function monitorSinglePosition(
    onTakeProfit: (pos: Position, sellPct: number) => Promise<void>,
    onStopLoss: (pos: Position) => Promise<void>,
    onTimeStop: (pos: Position) => Promise<void>,
    pos: Position
): Promise<void> {
    try {
        const price = await getPrice(pos.tokenData.mint);
        const mult = price / pos.entryPrice;
        const ageMins = (Date.now() - pos.entryTime) / 60_000;

        let tpFired = false;
        for (const step of pos.tpSteps) {
            if (!step.triggered && mult >= step.mult) {
                if (pos.isProcessing) return;
                pos.isProcessing = true;
                updatePosition(pos.tokenData.mint, { isProcessing: pos.isProcessing });
                await onTakeProfit(pos, step.sellPct);
                step.triggered = true;
                pos.stopLoss = step.newSL;
                updatePosition(pos.tokenData.mint, { tpSteps: pos.tpSteps, stopLoss: pos.stopLoss });
                tpFired = true;
                pos.isProcessing = false;
                updatePosition(pos.tokenData.mint, { isProcessing: pos.isProcessing });
                break;
            }
        }

        if (!tpFired) {
            if (mult <= pos.stopLoss) {
                await onStopLoss(pos);
            } else if (ageMins >= EXIT_STRATEGY.timeStopMins && mult < EXIT_STRATEGY.timeStopMinMult) {
                await onTimeStop(pos);
            }
        }
    } catch (err) {
        logger.error('[PositionManager] Error monitoring position', {
            mint: pos.tokenData.mint,
            err: String(err),
        });
    }
}

export async function monitorLoop(
    onTakeProfit: (pos: Position, sellPct: number) => Promise<void>,
    onStopLoss: (pos: Position) => Promise<void>,
    onTimeStop: (pos: Position) => Promise<void>): Promise<void> {
    let running = true;
    process.on('SIGINT', () => {
        running = false;
    });
    while (running) {
        await Promise.all(
            Array.from(cachedStore.values()).map(pos =>
                monitorSinglePosition(onTakeProfit, onStopLoss, onTimeStop, pos)
            )
        );
        await new Promise(r => setTimeout(r, PRICE_POLL_INTERVAL));
    }
}