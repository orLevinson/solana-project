import { Connection } from "@solana/web3.js";
import dotenv from 'dotenv';
import { logger } from '../logger/logger';

dotenv.config();

// Trim whitespace and remove optional quotes that might have been pasted into .env
const RPC_URL = process.env.HELIUS_RPC_URL?.trim().replace(/^["'](.+)["']$/, '$1');
const WS_URL = process.env.HELIUS_WS_URL?.trim().replace(/^["'](.+)["']$/, '$1');

if (!RPC_URL) {
    throw new Error('HELIUS_RPC_URL is not defined');
}

// Diagnostic Log: Help the user verify they updated their .env correctly
const maskedUrl = RPC_URL.includes('api-key=')
    ? RPC_URL.replace(/api-key=[^&]+/, "api-key=***" + RPC_URL.slice(-4))
    : RPC_URL;
logger.info(`[RPC] Initializing connection to: ${maskedUrl}`);

if (RPC_URL.includes('YOUR-KEY')) {
    logger.error("[RPC] CRITICAL: You are still using the 'YOUR-KEY' placeholder in your .env file! Please update it with your real Helius API key.");
}

// If WS_URL is provided, we use it explicitly. 
// Otherwise, web3.js will try to derive it from RPC_URL automatically.
export const connection = new Connection(RPC_URL, {
    commitment: "confirmed",
    wsEndpoint: WS_URL
});