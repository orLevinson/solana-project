import { getMint, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { connection } from "../utils/rpc";
import { logger } from "../logger/logger";
import { NewTokenEvent } from "../listener/tokenListener";
import { badWalletCache } from "./filterCache";

export async function checkMintAuthority(token: NewTokenEvent): Promise<boolean> {
    const { mint, devWallet } = token;
    try{
        // Cache hit = already confirmed bad — reject instantly, no RPC needed
        if (badWalletCache.has(devWallet)) {
            logger.warning('FILTER_FAIL: known bad wallet (cached)', { mint, devWallet });
            return false;
        }

        // Try standard Token Program first (used by pump.fun),
        // fall back to Token2022 if this mint lives there instead
        let mintAccount;
        try {
            mintAccount = await getMint(connection, new PublicKey(mint), 'confirmed', TOKEN_PROGRAM_ID);
        } catch {
            mintAccount = await getMint(connection, new PublicKey(mint), 'confirmed', TOKEN_2022_PROGRAM_ID);
        }
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