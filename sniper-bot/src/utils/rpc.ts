import { Connection } from "@solana/web3.js";
import dotenv from 'dotenv';
import { logger } from '../logger/logger';

dotenv.config();

const RPC_URL = process.env.HELIUS_RPC_URL;

if (!RPC_URL) {
    throw new Error('HELIUS_RPC_URL is not defined');
}

export const connection = new Connection(RPC_URL as string, "confirmed");