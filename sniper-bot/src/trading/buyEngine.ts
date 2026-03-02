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
import { dryRunState } from "../utils/dryRun";
import { addPosition } from "./positionManager";

export async function executeBuy(token: NewTokenEvent, positionCount: number): Promise<boolean> {
    // DRY_RUN guard — must be first
    if (DRY_RUN) {
        const balanceSol = await dryRunState.getBalance();
        if (balanceSol <= GAS_RESERVE + BUY_SIZE) {
            logger.warning('[DRY RUN] Buy skipped: balance too low', {
                mint: token.mint,
                balanceSol: balanceSol.toFixed(4),
                required: (GAS_RESERVE + BUY_SIZE).toFixed(4),
            });
            return false;
        }
        if (positionCount >= MAX_POSITIONS) {
            logger.warning('[DRY RUN] Buy skipped: MAX_POSITIONS reached', { mint: token.mint, positionCount });
            return false;
        }

        const totalSolCost = BUY_SIZE * 1.01 + JITO_TIP;
        dryRunState.updateBalance(-totalSolCost);

        // Use a fixed token amount for dry run since we don't need real reserves
        const dryTokenAmount = Math.floor(BUY_SIZE * LAMPORTS_PER_SOL / 30); // rough estimate
        logger.info(`[DRY RUN] Virtual buy executed`, {
            mint: token.mint,
            spent: totalSolCost.toFixed(4),
            tokensReceived: dryTokenAmount,
        });
        addPosition(token, totalSolCost, dryTokenAmount);
        return true;
    }

    try {
        if (positionCount >= MAX_POSITIONS) {
            logger.warning('Buy skipped: MAX_POSITIONS reached', { mint: token.mint, positionCount });
            return false;
        }

        const balanceSol = (await connection.getBalance(wallet.publicKey)) / LAMPORTS_PER_SOL;
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
            logger.warning('Buy skipped: missing bonding curve account', { mint: token.mint });
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
            slippage: SLIPPAGE,
        });

        const tx = new Transaction()
            .add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }))
            .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }))
            .add(...instructions);

        const { bundleId, signature, lastValidBlockHeight } = await sendBundle(tx, wallet.keypair, JITO_TIP);
        logger.success('Buy bundle accepted by Jito. Optimistically opening position.', { mint: token.mint, bundleId, signature });

        // Optimistically register position so price monitoring starts immediately
        addPosition(token, BUY_SIZE, tokenAmount.toNumber());

        // Poll for confirmation async — don't block the main thread
        import("../utils/jito").then(async ({ pollSignatureConfirmation }) => {
            try {
                const confirmed = await pollSignatureConfirmation(signature, lastValidBlockHeight);
                if (confirmed) {
                    logger.success(`On-chain buy confirmed!`, { mint: token.mint, signature });
                } else {
                    logger.warning(`Buy bundle dropped by network. Rolling back position.`, { mint: token.mint, signature });
                    import("./positionManager").then(({ removePosition }) => {
                        removePosition(token.mint);
                    });
                }
            } catch (err) {
                logger.error(`Buy confirmation poll error — rolling back position`, { mint: token.mint, err: String(err) });
                import("./positionManager").then(({ removePosition }) => {
                    removePosition(token.mint);
                });
            }
        });

        return true;

    } catch (err) {
        logger.error('Buy failed with exception', { mint: token.mint, err: String(err) });
        return false;
    }
}