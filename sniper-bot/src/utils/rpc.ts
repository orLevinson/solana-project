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

// If WS_URL is provided, we use it explicitly. 
// Otherwise, web3.js will try to derive it from RPC_URL automatically.
export const connection = new Connection(RPC_URL, {
    commitment: "confirmed",
    wsEndpoint: WS_URL
});