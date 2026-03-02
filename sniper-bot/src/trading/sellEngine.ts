import { getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
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
    try {
        const mintPublicKey = new PublicKey(pos.tokenData.mint);
        const bcPda = bondingCurvePda(pos.tokenData.mint);
        const userAta = getAssociatedTokenAddressSync(mintPublicKey, wallet.publicKey, true, TOKEN_PROGRAM_ID);

        let tokensToSell = new BN(pos.remainingTokens)
            .muln(Math.floor(sellPct * 10_000))
            .divn(10_000);
        let bondingCurveInfo;

        if (DRY_RUN) {
            bondingCurveInfo = await connection.getAccountInfo(bcPda);
            if (!bondingCurveInfo) throw new Error('Sell skipped: missing bonding curve info');
        } else {
            const [bcInfo] = await Promise.all([
                connection.getAccountInfo(bcPda),
            ]);
            bondingCurveInfo = bcInfo;
            if (!bondingCurveInfo) {
                throw new Error('Sell skipped: missing account info');
            }
        }

        if (tokensToSell.isZero()) {
            removePosition(pos.tokenData.mint);
            logger.warning('Sell skipped: zero tokens to sell', { mint: pos.tokenData.mint });
            return false;
        }

        const global = getGlobal();
        const bondingCurve = PUMP_SDK.decodeBondingCurve(bondingCurveInfo);
        const tokenAmountBN = new BN(tokensToSell);
        const estimatedSol = getSellSolAmountFromTokenAmount({
            global,
            feeConfig: null,
            mintSupply: bondingCurve.tokenTotalSupply,
            bondingCurve: bondingCurve,
            amount: tokenAmountBN,
        });

        if (DRY_RUN) {
            // Apply realism: 1% pump.fun fee and Jito tip
            const solGross = Number(estimatedSol.toString()) / LAMPORTS_PER_SOL;
            const solNet = solGross * 0.99 - JITO_TIP;

            dryRunState.updateBalance(solNet);
            logger.info(`[DRY RUN] Virtual ${reason} sell executed`, {
                mint: pos.tokenData.mint,
                tokensSold: tokensToSell,
                solReturned: solNet.toFixed(4),
                reason
            });

            if (sellPct >= 1.0) removePosition(pos.tokenData.mint);
            else updatePosition(pos.tokenData.mint, { remainingTokens: new BN(pos.remainingTokens).sub(tokensToSell).toNumber() });
            return true;
        }

        const minSolOut = estimatedSol.mul(new BN(10_000 - Math.floor(SLIPPAGE * 10_000))).div(new BN(10_000));

        const instructions = await PUMP_SDK.sellInstructions({
            global,
            bondingCurveAccountInfo: bondingCurveInfo,
            bondingCurve: bondingCurve,
            mint: mintPublicKey,
            user: wallet.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
            amount: tokenAmountBN,
            solAmount: minSolOut,
            slippage: SLIPPAGE,
            mayhemMode: false,
        })

        const tx = new Transaction()
            .add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }))
            .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }))
            .add(...instructions);


        const { bundleId, signature } = await sendBundle(tx, wallet.keypair, JITO_TIP);
        logger.info('Sell bundle sent to Jito. Assuming executed.', { mint: pos.tokenData.mint, bundleId, signature, reason, tokensToSell });

        const previousRemaining = pos.remainingTokens;

        if (sellPct >= 1.0) {
            removePosition(pos.tokenData.mint);
        } else {
            updatePosition(pos.tokenData.mint, { remainingTokens: pos.remainingTokens - tokensToSell.toNumber() });
        }

        // Asynchronously poll for actual on-chain confirmation
        import("../utils/jito").then(async ({ pollSignatureConfirmation }) => {
            try {
                const confirmed = await pollSignatureConfirmation(signature);
                if (confirmed) {
                    logger.success(`On-chain sell confirmed!`, { mint: pos.tokenData.mint, signature, reason });
                } else {
                    logger.warning(`Sell bundle was dropped by network. Rolling back position state.`, { mint: pos.tokenData.mint });
                    import("./positionManager").then(({ updatePosition, cachedStore, store }) => {
                        // If we removed it, we need to put it back into active tracking
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
                logger.error(`Error polling sell confirmation`, { mint: pos.tokenData.mint, err: String(err) });
                import("./positionManager").then(({ updatePosition, cachedStore, store }) => {
                    // Rollback on polling error just to be safe
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
        logger.error(`[SellEngine] Sell failed for ${pos.tokenData.symbol ?? "unknown"} (${pos.tokenData.mint})`, { err: String(err) });
        return false;
    }
}