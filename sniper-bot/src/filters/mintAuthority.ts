import { getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { connection } from "../utils/rpc";
import { logger } from "../logger/logger";

export async function checkMintAuthority(mint: string): Promise<boolean> {
    try{
        const mintAccount = await getMint(connection, new PublicKey(mint));
        if(mintAccount.freezeAuthority !== null){
            logger.warning('FILTER_FAIL: freezeAuthority is still set',{ mint });
            return false;
        }
        if(mintAccount.mintAuthority !== null){
            logger.warning('FILTER_FAIL: mintAuthority is still set',{ mint });
            return false;
        }
        logger.success('FILTER_PASS: mintAuthority',{ mint });
        return true;
    } catch(err){
        logger.error('Error checking mint authority', { mint, err });
        return false;
    }
}