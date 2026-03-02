import { PublicKey, LAMPORTS_PER_SOL, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { PUMP_SDK, bondingCurvePda, getBuyTokenAmountFromSolAmount } from "@pump-fun/pump-sdk";
import { connection } from '../utils/rpc';
import { wallet } from '../utils/wallet';
import { sendBundle } from "../utils/jito";
import { logger } from "../logger/logger";
import { NewTokenEvent } from "../listener/tokenListener";
import { DRY_RUN, MAX_POSITIONS, GAS_RESERVE, BUY_SIZE, JITO_TIP, SLIPPAGE, COMPUTE_UNIT_LIMIT, COMPUTE_UNIT_PRICE } from "../../config";
import { getGlobal } from "../utils/globalState";
import { addPosition } from "./positionManager";

export async function executeBuy(token: NewTokenEvent, positionCount: number): Promise<boolean> {
    if (DRY_RUN) {
        logger.info(`[DRY RUN] Would buy ${token.symbol} (${token.mint})`, { token });
        return true;
    }

    try {
        if (positionCount >= MAX_POSITIONS) {
            logger.warning('Buy skipped: MAX_POSITIONS reached', { mint: token.mint, positionCount });
            return false;
        }

        const balanceLamports = await connection.getBalance(wallet.publicKey);
        const balanceSol = balanceLamports / LAMPORTS_PER_SOL;
        if (balanceSol <= GAS_RESERVE + BUY_SIZE) {
            logger.warning('Buy skipped: balance too low', {
                mint: token.mint,
                balanceSol: balanceSol.toFixed(4),
                required: (GAS_RESERVE + BUY_SIZE).toFixed(4),
            });
            return false;
        }

        const mintPublicKey = new PublicKey(token.mint);
        const bondingCurvePDA = bondingCurvePda(token.mint);
        const userAta = getAssociatedTokenAddressSync(mintPublicKey, wallet.publicKey, true, TOKEN_PROGRAM_ID);
        const global = getGlobal();
        const [bondingCurveInfo, userAtaInfo] = await Promise.all([
            connection.getAccountInfo(bondingCurvePDA),
            connection.getAccountInfo(userAta),
        ]);

        if (!bondingCurveInfo) {
            logger.warning('Buy skipped: missing account info', { mint: token.mint });
            return false;
        }

        const bondingCurve = PUMP_SDK.decodeBondingCurve(bondingCurveInfo);

        const solLamports = new BN(Math.floor(BUY_SIZE * LAMPORTS_PER_SOL));
        const tokenAmount = getBuyTokenAmountFromSolAmount({
            global,
            feeConfig: null,
            mintSupply: null,
            bondingCurve,
            amount: solLamports,
        });

        const minTokenAmount = tokenAmount
            .muln(10_000 - Math.floor(SLIPPAGE * 10_000))
            .divn(10_000);

        const instructions = await PUMP_SDK.buyInstructions({
            global,
            bondingCurveAccountInfo: bondingCurveInfo,
            bondingCurve,
            associatedUserAccountInfo: userAtaInfo,
            mint: mintPublicKey,
            user: wallet.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            amount: minTokenAmount,
            solAmount: solLamports,
            slippage: SLIPPAGE
        });

        const tx = new Transaction().
            add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }))
            .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }))
            .add(...instructions);

        const bundleId = await sendBundle(tx, wallet.keypair, JITO_TIP);
        logger.info('Buy bundle sent', { mint: token.mint, bundleId });
        addPosition(token, BUY_SIZE, tokenAmount.toNumber());
        return true;
    } catch (err) {
        logger.error('Buy failed with exception', { mint: token.mint, err: String(err) });
        return false;
    }
}