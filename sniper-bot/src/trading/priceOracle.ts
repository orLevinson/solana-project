import { connection } from "../utils/rpc";
import { logger } from "../logger/logger";
import { PublicKey } from "@solana/web3.js";
import { PRICE_API_FAIL_LIMIT, PUMP_FUN_PROGRAM_ID, PUMP_FUN_REST_API, PRICE_API_RETRY_COOLDOWN } from "../../config";

let restFailCount = 0;
let lastRestProbeAt = 0;

interface mintData {
    virtual_sol_reserves: number;
    virtual_token_reserves: number;
}

async function getPriceRest(mint: string): Promise<number> {
    const res = await fetch(`${PUMP_FUN_REST_API}/${mint}`);
    if (!res.ok) throw new Error(`Failed to fetch mint data for ${mint} ( ${res.status} )`);
    const data = await res.json() as mintData;
    return data.virtual_sol_reserves / data.virtual_token_reserves;
}

async function fetchPriceOnChain(mint: string): Promise<number> {
    const [bondingCurve] = PublicKey.findProgramAddressSync(
        [Buffer.from('bonding-curve'), new PublicKey(mint).toBytes()],
        new PublicKey(PUMP_FUN_PROGRAM_ID)
    );
    const info = await connection.getAccountInfo(bondingCurve);
    if (!info) throw new Error(`Failed to fetch bonding curve for ${mint}`);
    const virtualTokenReserves = info.data.readBigUInt64LE(8);
    const virtualSolReserves = info.data.readBigUInt64LE(16);
    const price = Number((virtualSolReserves * 1000000n) / virtualTokenReserves) / 1e9;
    return price;
}

export async function getPrice(mint: string): Promise<number> {
    const now = Date.now();
    if (now - lastRestProbeAt > PRICE_API_RETRY_COOLDOWN) restFailCount = 0;
    if (restFailCount < PRICE_API_FAIL_LIMIT) {
        try {
            const price = await getPriceRest(mint);
            restFailCount = 0;
            lastRestProbeAt = now;
            return price;
        } catch (err) {
            lastRestProbeAt = now;
            restFailCount++;
        }
    }
    try {
        logger.warning('REST price API failed, using on-chain fallback', { mint });
        return fetchPriceOnChain(mint);
    } catch (error) {
        logger.error('Failed to fetch price on chain', { mint, err: String(error) });
        return 0;
    }
}
