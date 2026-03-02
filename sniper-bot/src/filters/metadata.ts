import { logger } from "../logger/logger";
import { NewTokenEvent } from "../listener/tokenListener";
import { PUMP_FUN_REST_API } from "../../config";

export interface tokenMetadata {
    mint: string,
    name: string,
    symbol: string,
    description?: string,
    image_uri?: string,
    twitter?: string,
    telegram?: string,
    website?: string
}

export async function checkMetadata(token: NewTokenEvent): Promise<boolean> {
    const { mint } = token;
    try {
        const res = await fetch(`${PUMP_FUN_REST_API}/${mint}`);
        if (!res.ok) throw new Error(`Failed to fetch metadata for ${mint}`);
        const data = await res.json() as tokenMetadata;
        token.name = token.name ?? data.name;
        token.symbol = token.symbol ?? data.symbol;
        token.description = token.description ?? data.description;
        token.image_uri = token.image_uri ?? data.image_uri;
        token.twitter = token.twitter ?? data.twitter;
        token.telegram = token.telegram ?? data.telegram;
        token.website = token.website ?? data.website;
        if (!data.twitter && !data.telegram && !data.website) {
            logger.warning('FILTER_FAIL: metadata missing both twitter and telegram', { mint });
            return false;
        }
        if (!data.image_uri) {
            logger.warning('FILTER_FAIL: metadata missing image uri', { mint });
            return false;
        }
        logger.success('FILTER_PASS: metadata', { mint });
        return true;
    } catch (err) {
        logger.error('Error checking metadata', { mint, err: String(err) });
        return true; // fail safe - other filters will catch problems
    }
}
