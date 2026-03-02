// ============================================================
// config.ts — Single source of truth for all tunable params.
// Import this file everywhere. Never hardcode values elsewhere.
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

// ─────────────────────────────────────────────────────────────
// PUMP.FUN PROGRAM
// ─────────────────────────────────────────────────────────────
// The on-chain program address for pump.fun. All token launches
// emit logs from this address — this is what the WebSocket listens to.
export const PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_FUN_REST_API = 'https://api.pump.fun/tokens';

// ─────────────────────────────────────────────────────────────
// CAPITAL & POSITION SIZING
// ─────────────────────────────────────────────────────────────
// BUY_SIZE: SOL spent per trade. Start low at 0.1 until the bot
//   is proven profitable. Raise gradually, never above 0.3.
// MAX_POSITIONS: Hard cap on simultaneous open trades.
//   More than 5 = hard to track + one bad run wipes too much.
// GAS_RESERVE: SOL permanently set aside for Jito tips + fees.
//   If balance drops to this level, bot stops buying. Never touch.
export const BUY_SIZE = 0.1;   // SOL per trade
export const MAX_POSITIONS = 5;     // max concurrent open positions
export const GAS_RESERVE = 0.5;   // SOL reserved for gas — never trade below this

// ─────────────────────────────────────────────────────────────
// EXIT CONDITIONS
// ─────────────────────────────────────────────────────────────
// TAKE_PROFIT: At 2x entry, sell 70% of position via Jito.
//   The remaining 30% rides with a tighter stop loss.
// STOP_LOSS: At -40% (0.6x entry), sell everything immediately.
//   No hesitation. Capital preservation over hope.
// TRAILING_STOP_AFTER_TP: After the 70% TP sell, the stop loss
//   on the remaining 30% moves up to 1.5x entry (locking profit).
// TIME_STOP_MINUTES: If a position is still open after 10 minutes
//   AND below TIME_STOP_MIN_MULT, sell everything. Flat = done.
export const TAKE_PROFIT = 2.0;  // x multiplier → sell 70%
export const STOP_LOSS = 0.6;  // x multiplier → sell 100% (−40%)
export const TRAILING_STOP_AFTER_TP = 1.5;  // x — new SL floor after partial TP
export const TIME_STOP_MINUTES = 10;   // minutes before time stop activates
export const TIME_STOP_MIN_MULT = 1.2;  // x — must be above this to avoid time stop

// ─────────────────────────────────────────────────────────────
// EXECUTION (JITO)
// ─────────────────────────────────────────────────────────────
// SLIPPAGE: 15% is intentionally high for new bonding curve tokens.
//   Price can move 5-10% in the time it takes to build + land a tx.
//   Lower = more failed txs. 15% is the right tradeoff here.
// JITO_TIP: Base tip in SOL paid to Jito validators per bundle.
//   Higher = faster landing. 0.002 SOL is normal market rate.
// JITO_TIP_MAX: Hard ceiling. Tip wars during viral launches can
//   spike to 0.01-0.02 SOL. We never go above this automatically.
// JITO_RETRY_SLOTS: Wait this many slots (~400ms each) before
//   assuming a bundle failed and resubmitting.
// JITO_TIP_ESCALATE: Multiply tip by this factor on each retry.
//   1.5x per retry: 0.002 → 0.003 → 0.0045 → ... → JITO_TIP_MAX
export const SLIPPAGE = 0.15;   // 15% slippage tolerance
export const JITO_TIP = 0.002;  // SOL base tip per bundle
export const JITO_TIP_MAX = 0.02;   // SOL tip ceiling (tip wars)
export const JITO_RETRY_SLOTS = 2;      // slots to wait before retry (~800ms)
export const JITO_TIP_ESCALATE = 1.5;   // tip multiplier on each retry
export const JITO_BLOCK_ENGINE_URL = 'https://frankfurt.mainnet.block-engine.jito.wtf';
export const COMPUTE_UNIT_LIMIT = 200_000;  // max compute units per tx
export const COMPUTE_UNIT_PRICE = 10_000;   // microlamports per compute unit


export const JITO_TIP_ACCOUNTS = [
    "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
    "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
    "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
    "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
    "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
    "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
    "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
    "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT"
]

// ─────────────────────────────────────────────────────────────
// PRICE MONITORING
// ─────────────────────────────────────────────────────────────
// PRICE_POLL_INTERVAL: How often to poll price per open position.
//   3s is the sweet spot — fast enough to catch exits, slow enough
//   not to hammer the API / RPC.
// PRICE_API_FAIL_LIMIT: After this many consecutive REST API
//   failures, priceOracle.ts switches to on-chain bonding curve
//   reads automatically. Resets to REST when it recovers.
export const PRICE_POLL_INTERVAL = 3_000;  // ms between price polls
export const PRICE_API_FAIL_LIMIT = 3;      // failures before on-chain fallback
export const PRICE_API_RETRY_COOLDOWN = 30_000; // ms to wait before retrying REST API

// ─────────────────────────────────────────────────────────────
// FILTERS
// ─────────────────────────────────────────────────────────────
// HOLDER_CONCENTRATION_LIMIT: If any single wallet (excluding the
//   bonding curve program itself) holds more than this % of supply,
//   the token is rejected. 15% is aggressive — lower = safer but
//   more rejections. Tune based on what passes but still dumps.
// RUG_HISTORY_WINDOW_MINS: How quickly a past token must have
//   died to flag its creator as a serial rugger. 30min is tight —
//   tokens that die at 31 minutes slip through. Adjust if you see
//   repeat dev wallets passing the rugHistory filter.
export const HOLDER_CONCENTRATION_LIMIT = 0.15;  // 15% max single holder
export const RUG_HISTORY_WINDOW_MINS = 30;    // minutes — rug detection window
export const RUG_WALLET_TX_FETCH_COUNT = 50; // amount of TX to check for rug history
export const NEW_WALLET_TX_COUNT = 10; // amount of TX to check for new wallet detection
export const RUG_SCORE_THRESHOLD = 35; // rug score threshold
export const MIN_DEV_SOL_BALANCE = 0.5;   // SOL — min dev wallet balance
export const MIN_DEV_BUY_SOL = 0.1;  // SOL — min dev buy at launch
export const MIN_WALLET_AGE_DAYS = 7;     // days — min estimated wallet age
export const BUNDLE_SLOT0_LIMIT = 2; // amount of TX to check for bundle slot 0
export const BUNDLE_SLOT12_LIMIT = 5; // amount of TX to check for bundle slot 1 and 2
export const SIGNATURE_FETCH_LIMIT = 15; // amount of TX to check for bundle detection
export const CONCURRENCY_LIMIT = 5; // amount of TX to check for bundle detection

// ─────────────────────────────────────────────────────────────
// IN-MEMORY CACHES
// ─────────────────────────────────────────────────────────────
// These caches persist for the lifetime of the bot process and
// prevent redundant RPC/API calls for data we've already fetched.
//
// BAD_WALLET_CACHE_SIZE: Max entries in the rugHistory bad-wallet
//   cache. Once full, oldest entries are evicted (LRU). 1000 is
//   enough for a full day of operation without memory pressure.
//
// HOLDER_CACHE_ENABLED: Whether to cache getProgramAccounts()
//   holder results per mint. Useful if the same token is detected
//   twice (rare but possible with WS reconnects).
// HOLDER_CACHE_TTL_MS: How long holder data is considered fresh.
//   60 seconds — tokens move fast, beyond that the data is stale.
// HOLDER_CACHE_MAX_SIZE: Max number of mints to keep holder data
//   for. Keeps memory bounded. Old entries evicted LRU.
export const BAD_WALLET_CACHE_SIZE = 1_000;  // max bad wallet entries
export const HOLDER_CACHE_ENABLED = true;   // cache holder concentration results
export const HOLDER_CACHE_TTL_MS = 60_000; // ms — holder data TTL (60 seconds)
export const HOLDER_CACHE_MAX_SIZE = 500;    // max mints in holder cache

// ─────────────────────────────────────────────────────────────
// MODE
// ─────────────────────────────────────────────────────────────
// DRY_RUN=true → full pipeline runs but NO transactions are sent.
// PnL is simulated. All log entries get a [DRY] prefix.
// Defaults to TRUE if env var is missing or anything other than
// the exact string "false" — this prevents accidental live trading.
export const DRY_RUN = process.env.DRY_RUN !== 'false';
