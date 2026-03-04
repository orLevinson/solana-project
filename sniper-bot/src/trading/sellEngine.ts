import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAccount } from "@solana/spl-token";
import { PublicKey, LAMPORTS_PER_SOL, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import BN from "bn.js";
import { PUMP_SDK, bondingCurvePda, getSellSolAmountFromTokenAmount } from "@pump-fun/pump-sdk";
import { connection } from "../utils/rpc";
import { wallet } from "../utils/wallet";
import { sendBundle } from "../utils/jito";
import { logger } from "../logger/logger";
import { DRY_RUN, JITO_TIP, SLIPPAGE, COMPUTE_UNIT_LIMIT, COMPUTE_UNIT_PRICE } from "../../config";
import { getGlobal } from "../utils/globalState";
import { Position, removePosition, updatePosition, addHistoryEvent, TradeEvent } from "./positionManager";
import { dryRunState } from "../utils/dryRun";

export async function executeSell(
    pos: Position,
    sellPct: number,
    reason: 'TP' | 'SL' | 'TIME_STOP',
    onConfirmed?: () => void,
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

            const sellEvent: TradeEvent = {
                type: 'sell',
                timestamp: Date.now(),
                solAmount: solNet,
                tokenAmount: tokensToSell.toNumber(),
                price: solNet / tokensToSell.toNumber(),
                signature: 'mock_signature_dry_run',
                reason
            };
            addHistoryEvent(pos.tokenData.mint, sellEvent);

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

        let tokensToSell = new BN(pos.remainingTokens)
            .muln(Math.floor(sellPct * 10_000))
            .divn(10_000);

        if (tokensToSell.isZero()) {
            removePosition(pos.tokenData.mint);
            logger.warning('Sell skipped: zero tokens to sell', { mint: pos.tokenData.mint });
            return false;
        }

        // Guard: verify the on-chain ATA actually has tokens before building the sell.
        // This catches state drift (e.g. a previous partial sell consumed more than expected).
        try {
            const mintPublicKeyEarly = new PublicKey(pos.tokenData.mint);
            const mintInfoEarly = await connection.getAccountInfo(mintPublicKeyEarly);
            const tokenProgramIdEarly = mintInfoEarly?.owner.equals(TOKEN_2022_PROGRAM_ID)
                ? TOKEN_2022_PROGRAM_ID
                : TOKEN_PROGRAM_ID;
            const userAtaEarly = getAssociatedTokenAddressSync(mintPublicKeyEarly, wallet.publicKey, true, tokenProgramIdEarly);
            const ataInfoEarly = await connection.getTokenAccountBalance(userAtaEarly);
            const onChainBalance = BigInt(ataInfoEarly.value.amount);
            if (onChainBalance === 0n) {
                logger.warning('Sell skipped: on-chain ATA balance is 0 — position already fully sold', { mint: pos.tokenData.mint });
                removePosition(pos.tokenData.mint);
                return false;
            }
            // If state drift is detected, clamp tokensToSell to actual balance
            if (onChainBalance < BigInt(tokensToSell.toString())) {
                logger.warning('State drift detected: clamping sell amount to on-chain balance', {
                    mint: pos.tokenData.mint,
                    stateBalance: tokensToSell.toString(),
                    onChainBalance: onChainBalance.toString(),
                });
                tokensToSell = new BN(onChainBalance.toString());
            }
        } catch (ataErr: any) {
            // If the ATA doesn't exist at all, the position was already sold
            if (ataErr?.message?.includes('could not find account') || ataErr?.message?.includes('invalid account owner')) {
                logger.warning('Sell skipped: ATA account not found — position already closed', { mint: pos.tokenData.mint });
                removePosition(pos.tokenData.mint);
                return false;
            }
            // Otherwise log and proceed; the sell simulation will catch it
            logger.warning('Could not pre-check ATA balance, proceeding anyway', { mint: pos.tokenData.mint, err: String(ataErr) });
        }

        // Fetch mint info alongside bonding curve to detect Token-2022 vs legacy
        const [mintInfo, bondingCurveInfo] = await Promise.all([
            connection.getAccountInfo(mintPublicKey),
            connection.getAccountInfo(bcPda),
        ]);

        if (!bondingCurveInfo) {
            throw new Error('Sell skipped: missing bonding curve account');
        }

        // Determine the correct token program from the mint account owner
        const tokenProgramId = mintInfo?.owner.equals(TOKEN_2022_PROGRAM_ID)
            ? TOKEN_2022_PROGRAM_ID
            : TOKEN_PROGRAM_ID;

        const userAta = getAssociatedTokenAddressSync(mintPublicKey, wallet.publicKey, true, tokenProgramId);

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
            tokenProgram: tokenProgramId,
            amount: tokensToSell,
            solAmount: minSolOut,
            slippage: SLIPPAGE,
            mayhemMode: false,
        });

        const tx = new Transaction()
            .add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }))
            .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }))
            .add(...instructions);

        const { bundleId, signature, lastValidBlockHeight } = await sendBundle(tx, wallet.keypair);

        const previousRemaining = pos.remainingTokens;

        // Poll for confirmation async — don't block position monitor
        import("../utils/jito").then(async ({ pollSignatureConfirmation }) => {
            try {
                const confirmed = await pollSignatureConfirmation(signature);
                if (confirmed) {
                    logger.info('Sell bundle accepted by Jito.', { mint: pos.tokenData.mint, bundleId, signature, reason });

                    const sellEvent: TradeEvent = {
                        type: 'sell',
                        timestamp: Date.now(),
                        solAmount: Number(estimatedSol.toString()) / LAMPORTS_PER_SOL,
                        tokenAmount: tokensToSell.toNumber(),
                        price: (Number(estimatedSol.toString()) / LAMPORTS_PER_SOL) / tokensToSell.toNumber(),
                        signature,
                        reason
                    };

                    addHistoryEvent(pos.tokenData.mint, sellEvent);

                    if (sellPct >= 1.0) {
                        removePosition(pos.tokenData.mint);
                        logger.success(`On-chain sell confirmed!`, { mint: pos.tokenData.mint, signature, reason });
                        onConfirmed?.();
                    } else {
                        // Read the REAL on-chain ATA balance instead of trusting arithmetic.
                        // The pump.fun program can consume a slightly different token amount than
                        // requested (rounding, fees), which causes state drift and Error 6023 on
                        // subsequent sells.
                        try {
                            const mintPk = new PublicKey(pos.tokenData.mint);
                            const mintInf = await connection.getAccountInfo(mintPk);
                            const tokenProg = mintInf?.owner.equals(TOKEN_2022_PROGRAM_ID)
                                ? TOKEN_2022_PROGRAM_ID
                                : TOKEN_PROGRAM_ID;
                            const ata = getAssociatedTokenAddressSync(mintPk, wallet.publicKey, true, tokenProg);
                            const ataBalance = await connection.getTokenAccountBalance(ata);
                            const realRemaining = Number(ataBalance.value.amount);

                            if (realRemaining === 0) {
                                removePosition(pos.tokenData.mint);
                                logger.success(`On-chain sell confirmed — ATA fully drained, closing position`, { mint: pos.tokenData.mint, signature, reason });
                            } else {
                                updatePosition(pos.tokenData.mint, { remainingTokens: realRemaining });
                                logger.success(`On-chain sell confirmed!`, { mint: pos.tokenData.mint, signature, reason, remainingTokens: realRemaining });
                            }
                            // Fire the TP state callback only after the sell is confirmed on-chain.
                            // This prevents step.triggered and stopLoss from being stuck in a dirty
                            // state when a bundle drops — which was causing TPs to be skipped forever.
                            onConfirmed?.();
                        } catch (balanceErr) {
                            // ATA gone = fully sold
                            logger.success(`On-chain sell confirmed — ATA likely closed, removing position`, { mint: pos.tokenData.mint, signature, reason });
                            removePosition(pos.tokenData.mint);
                            onConfirmed?.();
                        }
                    }
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