import { logger } from "../logger/logger";
import { connection } from "./rpc";
import { GLOBAL_PDA, PUMP_SDK } from "@pump-fun/pump-sdk";
import { Global } from "@pump-fun/pump-sdk";

let cachedGlobal: Global | null = null;

const MAX_RETRIES = 5;
const RETRY_DELAY = 2_000; // ms between retries

export async function initializeGlobal(): Promise<void> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const info = await connection.getAccountInfo(GLOBAL_PDA);
            if (!info) throw new Error("GLOBAL_PDA account returned null");

            cachedGlobal = PUMP_SDK.decodeGlobal(info);

            // Subscribe to live updates — pump.fun rarely changes global,
            // but when they do (fee changes) we need the latest params.
            connection.onAccountChange(GLOBAL_PDA, (accountInfo) => {
                try {
                    cachedGlobal = PUMP_SDK.decodeGlobal(accountInfo);
                    logger.info("[GlobalState] Global account updated via WebSocket");
                } catch (err) {
                    // Don't update cache if decode fails — keep old value
                    logger.error("[GlobalState] Failed to decode global update", { err: String(err) });
                }
            });

            logger.info("[GlobalState] Initialized and subscribed to updates");
            return;

        } catch (err) {
            logger.warning(`[GlobalState] initializeGlobal attempt ${attempt}/${MAX_RETRIES} failed`, {
                err: String(err),
            });

            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, RETRY_DELAY));
            }
        }
    }

    // All retries exhausted — bot cannot run without global state
    throw new Error(`[GlobalState] Failed to initialize after ${MAX_RETRIES} attempts. Check RPC connection.`);
}

export function getGlobal(): Global {
    if (!cachedGlobal) throw new Error("[GlobalState] Global not initialized — call initializeGlobal() at startup");
    return cachedGlobal;
}