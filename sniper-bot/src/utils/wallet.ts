import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import dotenv from "dotenv";
import { connection } from "./rpc";
import { GAS_RESERVE } from "../../config";

dotenv.config();

// Trim whitespace and remove optional quotes that might have been pasted into .env
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY?.trim().replace(/^["'](.+)["']$/, '$1');

if (!WALLET_PRIVATE_KEY) {
    throw new Error("WALLET_PRIVATE_KEY is not defined");
}

const keypair = Keypair.fromSecretKey(bs58.decode(WALLET_PRIVATE_KEY));

export const wallet = {
    keypair,
    publicKey: keypair.publicKey,
    address: keypair.publicKey.toBase58(),
    async getBalance(): Promise<number> {
        const balance = await connection.getBalance(wallet.publicKey);
        return balance / LAMPORTS_PER_SOL;
    },
    async hasEnoughGas(): Promise<boolean> {
        const balance = await this.getBalance();
        return balance > GAS_RESERVE;
    }
}