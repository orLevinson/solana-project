import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, LAMPORTS_PER_SOL, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import BN from "bn.js";
import { PUMP_SDK, bondingCurvePda, getSellSolAmountFromTokenAmount } from "@pump-fun/pump-sdk";
import { connection } from "../utils/rpc";
import { wallet } from "../utils/wallet";
import { sendBundle } from "../utils/jito";
import { logger } from "../logger/logger";
import { DRY_RUN, JITO_TIP, SLIPPAGE, COMPUTE_UNIT_LIMIT, COMPUTE_UNIT_PRICE } from "../../config";
import { getGlobal } from "../utils/globalState";
import { Position, removePosition, updatePosition } from "./positionManager";
import { dryRunState } from "../utils/dryRun";

export async function executeSell(
    pos: Position,
    sellPct: number,
    reason: 'TP' | 'SL' | 'TIME_STOP'
): Promise<boolean> {
    // DRY_RUN guard — must be first
    if (DRY_RUN) {
        try {
            const bcPda = bondingCurvePda(pos.tokenData.mint);
            const bondingCurveInfo = await connection.getAccountInfo(bcPda);
            if (!bondingCurveInfo) throw new Error('Missing bonding curve info');

            const tokensToSell = new BN(pos.remainingTokens)
                .muln(Math.floor(sellPct * 10_000))
                .divn(10_000);

            if (tokensToSell.isZero()) {
                removePosition(pos.tokenData.mint);
                logger.warning('[DRY RUN] Sell skipped: zero tokens', { mint: pos.tokenData.mint });
                return false;
            }

            const global = getGlobal();
            const bondingCurve = PUMP_SDK.decodeBondingCurve(bondingCurveInfo);
            const estimatedSol = getSellSolAmountFromTokenAmount({
                global,
                feeConfig: null,
                mintSupply: bondingCurve.tokenTotalSupply,
                bondingCurve,
                amount: tokensToSell,
            });

            const solGross = Number(estimatedSol.toString()) / LAMPORTS_PER_SOL;
            const solNet = solGross * 0.99 - JITO_TIP;
            dryRunState.updateBalance(solNet);

            logger.info(`[DRY RUN] Virtual ${reason} sell executed`, {
                mint: pos.tokenData.mint,
                tokensSold: tokensToSell.toString(),
                solReturned: solNet.toFixed(4),
                reason,
            });

            if (sellPct >= 1.0) {
                removePosition(pos.tokenData.mint);
            } else {
                updatePosition(pos.tokenData.mint, {
                    remainingTokens: new BN(pos.remainingTokens).sub(tokensToSell).toNumber(),
                });
            }
            return true;
        } catch (err) {
            logger.error(`[DRY RUN] Sell failed`, { mint: pos.tokenData.mint, err: String(err) });
            return false;
        }
    }

    try {
        const mintPublicKey = new PublicKey(pos.tokenData.mint);
        const bcPda = bondingCurvePda(pos.tokenData.mint);
        const userAta = getAssociatedTokenAddressSync(mintPublicKey, wallet.publicKey, true, TOKEN_PROGRAM_ID);

        const tokensToSell = new BN(pos.remainingTokens)
            .muln(Math.floor(sellPct * 10_000))
            .divn(10_000);

        if (tokensToSell.isZero()) {
            removePosition(pos.tokenData.mint);
            logger.warning('Sell skipped: zero tokens to sell', { mint: pos.tokenData.mint });
            return false;
        }

        const bondingCurveInfo = await connection.getAccountInfo(bcPda);
        if (!bondingCurveInfo) {
            throw new Error('Sell skipped: missing bonding curve account');
        }

        const global = getGlobal();
        const bondingCurve = PUMP_SDK.decodeBondingCurve(bondingCurveInfo);
        const estimatedSol = getSellSolAmountFromTokenAmount({
            global,
            feeConfig: null,
            mintSupply: bondingCurve.tokenTotalSupply,
            bondingCurve,
            amount: tokensToSell,
        });

        const minSolOut = estimatedSol
            .mul(new BN(10_000 - Math.floor(SLIPPAGE * 10_000)))
            .div(new BN(10_000));

        const instructions = await PUMP_SDK.sellInstructions({
            global,
            bondingCurveAccountInfo: bondingCurveInfo,
            bondingCurve,
            mint: mintPublicKey,
            user: wallet.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            amount: tokensToSell,
            solAmount: minSolOut,
            slippage: SLIPPAGE,
            mayhemMode: false,
        });

        const tx = new Transaction()
            .add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }))
            .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }))
            .add(...instructions);

        const { bundleId, signature, lastValidBlockHeight } = await sendBundle(tx, wallet.keypair, JITO_TIP);
        logger.info('Sell bundle accepted by Jito.', { mint: pos.tokenData.mint, bundleId, signature, reason });

        const previousRemaining = pos.remainingTokens;

        // Optimistically update position state
        if (sellPct >= 1.0) {
            removePosition(pos.tokenData.mint);
        } else {
            updatePosition(pos.tokenData.mint, {
                remainingTokens: pos.remainingTokens - tokensToSell.toNumber(),
            });
        }

        // Poll for confirmation async — don't block position monitor
        import("../utils/jito").then(async ({ pollSignatureConfirmation }) => {
            try {
                const confirmed = await pollSignatureConfirmation(signature, lastValidBlockHeight);
                if (confirmed) {
                    logger.success(`On-chain sell confirmed!`, { mint: pos.tokenData.mint, signature, reason });
                } else {
                    logger.warning(`Sell bundle dropped by network. Rolling back position state.`, { mint: pos.tokenData.mint, signature });
                    import("./positionManager").then(({ updatePosition, cachedStore, store }) => {
                        if (sellPct >= 1.0) {
                            pos.status = 'active';
                            pos.isProcessing = false;
                            cachedStore.set(pos.tokenData.mint, pos);
                            store.set(pos.tokenData.mint, pos);
                        } else {
                            updatePosition(pos.tokenData.mint, { remainingTokens: previousRemaining, isProcessing: false });
                        }
                    });
                }
            } catch (err) {
                logger.error(`Sell confirmation poll error — rolling back position`, { mint: pos.tokenData.mint, err: String(err) });
                import("./positionManager").then(({ updatePosition, cachedStore, store }) => {
                    if (sellPct >= 1.0) {
                        pos.status = 'active';
                        pos.isProcessing = false;
                        cachedStore.set(pos.tokenData.mint, pos);
                        store.set(pos.tokenData.mint, pos);
                    } else {
                        updatePosition(pos.tokenData.mint, { remainingTokens: previousRemaining, isProcessing: false });
                    }
                });
            }
        });

        return true;

    } catch (err) {
        logger.error(`Sell failed for ${pos.tokenData.symbol ?? 'unknown'} (${pos.tokenData.mint})`, { err: String(err) });
        return false;
    }
}