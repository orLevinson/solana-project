---
trigger: always_on
---

PUMP.FUN SNIPER BOT — FULL CONTEXT RULES

=== WHAT THIS BOT DOES ===
Monitors Solana blockchain in real time for newly created tokens on pump.fun.
When a new token is detected, it runs filters to assess quality, buys if filters
pass, monitors the position, and sells automatically based on profit/loss rules.
The edge is speed (buying in first 1-3 blocks) + filters (avoiding rugs).
This is NOT an arbitrage or MEV bot. It is a momentum sniper.

=== WHY PUMP.FUN ===
Pump.fun is a Solana token launchpad where anyone can create a token in seconds.
Tokens launch on a bonding curve — price increases as people buy. Early buyers
get the best price. Most tokens fail, but occasional ones pump 5x–50x in minutes.
The strategy is to catch those early, take profit fast, and cut losers faster.

=== CAPITAL CONTEXT ===
Total capital: 2 SOL
- 0.5 SOL is permanently reserved as gas buffer. Never use this for trades.
  Reason: Jito tips + transaction fees add up. Running out of SOL for gas =
  stuck in a position you can't exit.
- 1.5 SOL is the trading bankroll
- Each trade uses 0.1–0.3 SOL. Start at 0.1 SOL per trade until bot is proven.
- Max 5 concurrent open positions at any time.
  Reason: More than 5 and you lose track, and one bad run wipes too much capital.
- One 5x winner = covers ~10 stop-loss losses at 0.1 SOL size.
  Math: win 0.4 SOL on 5x, lose 0.04 SOL on each SL hit.

=== DRY RUN MODE ===
DRY_RUN=true in .env activates paper-trading mode. The entire pipeline runs
(listen → filter → buy → monitor → sell) but no transactions are ever submitted.
All PnL is simulated and logged identically to live mode.
- ALWAYS run in DRY_RUN mode first when deploying any code change.
- NEVER disable DRY_RUN until steps 1–6 of the build order are confirmed stable.
- DRY_RUN must be checked as the first line in buyEngine.ts and sellEngine.ts,
  before any transaction is constructed.

=== TECH STACK ===
Language: TypeScript (not Python — Solana ecosystem is TS-first, all major SDKs
  have first-class TS support. Python's solana-py is underpowered and slow.)
Runtime: Node.js v18+
Key packages:
- @solana/web3.js — core Solana interactions, tx building, account fetching
- @solana/spl-token — SPL token account reads, mint info
- @jito-ts/sdk — Jito block engine integration for fast tx landing
- pump-fun-sdk — pump.fun program interaction (buy/sell on bonding curve)
  WARNING: pump-fun-sdk is community-maintained and may lag behind pump.fun
  contract upgrades. If SDK calls start failing, fall back to building raw
  transactions directly against the program IDL. Keep the IDL in /src/idl/.
- bs58 — base58 encoding/decoding for keypairs
- dotenv — environment variable management (.env file)
- chalk — colored terminal output for logging
- axios — HTTP requests to pump.fun API for price data
- tsx — run TypeScript directly without compiling (dev/testing speed only)
  NOTE: For production 24/7 operation, compile to JS and run with plain node.
  tsx adds overhead and is less stable for long-running processes.

=== INFRASTRUCTURE ===
Helius (helius.dev):
  - Provides the RPC endpoint for reading chain state
  - Provides WebSocket endpoint for real-time log subscriptions
  - Free tier gives 1M credits/month — enough to start, but getSignaturesForAddress
    and WebSocket subscriptions are credit-heavy. Cache aggressively.
  - Upgrade to $49/mo Growth plan once the bot is proven. Do not wait until
    you get throttled mid-session — plan the upgrade proactively.
  - Required env var: HELIUS_RPC_URL, HELIUS_WS_URL

Jito (jito.wtf):
  - Block engine that lets you submit transaction bundles
  - Bundles land faster than regular mempool txs because validators prioritize them
  - You pay a "tip" of 0.001–0.005 SOL per bundle to a Jito tip account
  - During high-volume periods (viral launches), tip wars can spike to 0.01–0.02
    SOL per bundle. Implement dynamic tip scaling based on recent tip history.
  - Bundle landing is NOT guaranteed. Implement retry logic: if a bundle is not
    confirmed within 2 block slots (~800ms), resubmit with a higher tip.
  - NEVER send buys or sells as regular transactions — too slow, you'll miss entries
  - Required env var: JITO_BLOCK_ENGINE_URL

Pump.fun API:
  - REST API for fetching token price, market cap, bonding curve progress
  - Used by positionManager.ts to poll current price of open positions
  - Endpoint: https://frontend-api.pump.fun/coins/{mintAddress}
  - WARNING: This is an unofficial, undocumented API. No SLA. It can go down.
  - ALWAYS implement an on-chain fallback: read the bonding curve account directly
    via getAccountInfo() and parse the reserve fields to calculate price.
    Fallback activates automatically if the REST API returns non-200 for >3 polls.

=== EXECUTION FLOW (detailed) ===
1. LISTEN: WebSocket connects to Helius. Subscribes to logs from pump.fun program
   address (6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P). Every new token
   creation emits an initializeMint2 log. Parse this to extract: mint address,
   dev wallet address, token name, symbol, metadata URI.

2. FILTER: Run all 5 checks in parallel. If ANY fail, discard immediately.
   Log every rejection with the specific reason — this data is critical for tuning.

   SPEED NOTE: Filters add latency. rugHistory (RPC call, ~200–500ms) and
   metadata (Arweave/IPFS HTTP fetch, ~1–3s) are the slowest. By the time all
   filters complete, the token may already be 2–5x. This is the deliberate safety
   tradeoff: we sacrifice some entries to avoid rugs. Accept it and do not remove
   filters to chase speed.

   - rugHistory: fetch dev wallet's transaction history. If they previously
     created tokens that went to zero quickly or removed liquidity = skip.
     Maintain a local in-memory cache of known bad wallets to skip re-fetching
     on repeat offenders.
   - bundleDetect: fetch the first 5 transactions on the new token. Group by block
     slot. If 3+ unique wallets bought in slot 0 = coordinated bundle = skip.
     CAVEAT: sophisticated bundlers spread buys across 2–3 slots to evade this.
     Consider checking slots 0–2 and lowering threshold to 2+ wallets if you
     observe many bundled rugs passing this filter in production logs.
   - mintAuthority: fetch mint account via getMint(). mintAuthority MUST be null.
     freezeAuthority should also be null. If either is set, skip.
   - holderConcentration: fetch the top 10 token holders via getProgramAccounts().
     If any single wallet (excluding the bonding curve program) holds >15% of
     supply = skip. Reason: large concentrated holders dump and crash price even
     when mint authority is revoked. This closes the gap that mintAuthority alone
     misses.
   - metadata: fetch Metaplex metadata account for the token. Retrieve the URI,
     fetch the JSON from Arweave/IPFS. Check for twitter and telegram fields.
     No socials = low effort = higher rug probability = skip.

3. BUY: Build swap transaction using pump.fun SDK to buy on bonding curve.
   Check DRY_RUN flag first — if true, simulate and log, do not submit.
   Wrap in Jito bundle with tip. Set slippage to 15% (new pools are volatile).
   Set compute unit limit and price via ComputeBudgetProgram.
   Record entry: mint address, entry price, SOL spent, timestamp.

4. MONITOR: positionManager polls price every 3 seconds via pump.fun REST API.
   If REST API fails 3 consecutive polls, switch to on-chain bonding curve read.
   Calculates current multiplier vs entry price. Checks all exit conditions.
   Maintains a Map of open positions keyed by mint address.
   IMPORTANT: partialSold flag must be tracked per position. After a 70% TP sell,
   the remaining 30% is still in the map. All subsequent exit checks (time stop,
   stop loss, emergency) must operate on the remaining token balance only and
   must correctly reflect that a partial sell has already occurred in PnL logs.

5. SELL: Exit triggers checked on every poll:
   - Take Profit: price >= 2x entry → sell 70% of position immediately via Jito,
     set partialSold=true, move stop-loss on remaining 30% to 1.5x entry.
   - Stop Loss: price <= 0.6x entry (−40%) → sell 100% of REMAINING balance
     immediately, no hesitation. If partialSold=true, only remaining 30% is sold.
   - Time Stop: position open > 10 minutes AND price < 1.2x entry → sell 100%
     of REMAINING balance. Applies regardless of partialSold state.
     Reason: flat tokens rarely pump, capital is better deployed elsewhere.
   - Emergency: detect liquidity removal or large dev wallet sell → sell 100%
     of REMAINING balance immediately regardless of price.
   Check DRY_RUN flag first in sellEngine — if true, simulate and log only.

=== FILE STRUCTURE + WHAT EACH FILE DOES ===
config.ts
  — Single source of truth for all tunable parameters. Import this everywhere.
  — Contains: BUY_SIZE, MAX_POSITIONS, TAKE_PROFIT, STOP_LOSS, TIME_STOP,
    JITO_TIP, JITO_TIP_MAX, SLIPPAGE, PRICE_POLL_INTERVAL, PUMP_FUN_PROGRAM_ID,
    HOLDER_CONCENTRATION_LIMIT (default 0.15 = 15%)

.env
  — Secret keys and URLs. Never commit this to git.
  — Contains: HELIUS_RPC_URL, HELIUS_WS_URL, JITO_BLOCK_ENGINE_URL,
    WALLET_PRIVATE_KEY (base58 encoded), DRY_RUN (true/false)

src/utils/rpc.ts
  — Creates and exports the Connection object (Helius RPC)
  — Creates and exports the WebSocket connection
  — Single instance used everywhere, no duplicate connections

src/utils/wallet.ts
  — Loads keypair from WALLET_PRIVATE_KEY env var
  — Helper to check current SOL balance
  — Ensures gas reserve is respected before any trade

src/utils/jito.ts
  — Jito bundle builder utility
  — Takes a transaction, wraps it in a bundle, adds tip instruction, submits
  — Implements retry logic: if bundle not confirmed within 2 slots, resubmit
    with tip increased by 50%, up to JITO_TIP_MAX. Log every retry attempt.
  — Dynamic tip scaling: track last 10 submitted tip amounts and their landing
    success rate. Raise base tip during high-activity windows automatically.

src/listener/tokenListener.ts
  — Subscribes to pump.fun program logs via Helius WebSocket
  — Parses initializeMint2 events to extract new token data
  — Emits events to the filter engine, does nothing else
  — This is the entry point of the entire pipeline

src/filters/rugHistory.ts
  — Fetches dev wallet's past transactions using getSignaturesForAddress
  — Looks for pattern: wallet created token → token died within 30min = rug flag
  — Maintains a local in-memory cache (Map) of known bad wallets to avoid
    re-fetching. Cache persists for the lifetime of the process.

src/filters/bundleDetect.ts
  — Fetches first 5 transactions on the new token
  — Groups by block slot. If 3+ unique wallets bought in slot 0 = bundle detected
  — Also checks slots 1–2 for spread bundling patterns (2+ wallets = flag)
  — Returns boolean: isBundled

src/filters/mintAuthority.ts
  — Fetches mint account using getMint() from @solana/spl-token
  — Checks mintAuthority field. Must be null.
  — Checks freezeAuthority. Must be null.

src/filters/holderConcentration.ts
  — Fetches top 10 SPL token accounts via getProgramAccounts() with filters
  — Calculates each holder's % of total supply
  — Skips the bonding curve program account from the check
  — Returns: { concentrated: boolean, topHolderPct: number }
  — Fails filter if any single holder > HOLDER_CONCENTRATION_LIMIT

src/filters/metadata.ts
  — Fetches Metaplex metadata account for the token
  — Retrieves URI, fetches the JSON from Arweave/IPFS
  — Checks for twitter and telegram fields in the JSON
  — Returns: { hasSocials: boolean, name, symbol, image }

src/trading/buyEngine.ts
  — Checks DRY_RUN first. If true: log simulated buy, register mock position, return.
  — Takes a validated token (passed all filters)
  — Checks positionManager to ensure MAX_POSITIONS not exceeded
  — Checks wallet.ts to ensure gas reserve intact
  — Builds buy transaction via pump-fun-sdk (fall back to raw IDL if SDK fails)
  — Submits via jito.ts
  — On success: registers position in positionManager

src/trading/positionManager.ts
  — Maintains Map<mintAddress, Position> of all open trades
  — Position shape: { mint, entryPrice, currentPrice, solSpent,
    tokenAmount, openedAt, partialSold, remainingTokens, apiFailCount }
  — startMonitoring(mint): begins polling loop for a position
  — stopMonitoring(mint): clears interval, removes from map
  — On each poll: try REST API price; if apiFailCount >= 3 switch to on-chain
    bonding curve account read. Update currentPrice, calculate multiplier,
    call checkExitConditions(). Pass partialSold state to exit checks.

src/trading/sellEngine.ts
  — Checks DRY_RUN first. If true: log simulated sell with PnL, return.
  — Takes mint address + sell reason (TP / SL / TIME / EMERGENCY) + token amount
  — Builds sell transaction via pump-fun-sdk (fall back to raw IDL if SDK fails)
  — Submits via jito.ts
  — Logs result: SOL received, profit/loss, hold time, sell reason

src/trading/priceOracle.ts
  — Abstraction layer for price fetching used by positionManager
  — Primary: pump.fun REST API
  — Fallback: read bonding curve account on-chain, parse virtualSolReserves
    and virtualTokenReserves to compute spot price
  — Exposes a single getPrice(mint): Promise<number> interface
  — Handles the primary/fallback switching transparently

src/logger/logger.ts
  — Logs every event to trades.log file (JSON lines format)
  — Events: TOKEN_DETECTED, FILTER_PASS, FILTER_FAIL (with reason),
    BUY_SENT, BUY_CONFIRMED, SELL_SENT, SELL_CONFIRMED, BUNDLE_RETRY
  — In DRY_RUN mode, events are prefixed with [DRY] for easy filtering
  — This data is critical for tuning filters in production

src/logger/dashboard.ts
  — Terminal display using chalk
  — Shows: current open positions, total PnL today, win rate, SOL balance,
    DRY_RUN indicator if active
  — Refreshes every 5 seconds

src/index.ts
  — Wires everything together
  — Initializes RPC, wallet, positionManager
  — Starts tokenListener
  — Handles graceful shutdown on CTRL+C (close WebSocket, log final state)

=== BUILD ORDER ===
Build and test each module before moving to the next. Never skip ahead.
1.  config.ts — define all constants first (include DRY_RUN, HOLDER_CONCENTRATION_LIMIT)
2.  .env + src/utils/rpc.ts — get RPC connection working, log latest block
3.  src/utils/wallet.ts — load keypair, print public key + balance
4.  src/listener/tokenListener.ts — log detected tokens to console (no buying yet)
5.  src/filters/ (all 5) — test each filter against known rug and legit tokens
    holderConcentration is new; test it against a known bundled launch
6.  src/utils/jito.ts — test with a tiny dummy transaction; verify retry logic fires
7.  src/trading/priceOracle.ts — test both REST and on-chain fallback paths
8.  src/trading/buyEngine.ts — run with DRY_RUN=true first; then test with 0.01 SOL
9.  src/trading/positionManager.ts — mock a position, test polling + partialSold logic
10. src/trading/sellEngine.ts — run with DRY_RUN=true first; then test live sell
11. src/logger/ — verify [DRY] prefixing works; check trades.log output
12. src/index.ts — wire everything, run full pipeline in DRY_RUN for at least 1 hour
    before switching to live trading

=== HARD RULES ===
- NEVER send transactions without Jito. Regular txs are too slow.
- NEVER buy if any single filter fails. One rule exists for a reason.
- NEVER use the 0.5 SOL gas reserve for trades under any circumstances.
- NEVER run the bot with real money until steps 1–7 are confirmed working in DRY_RUN.
- NEVER store WALLET_PRIVATE_KEY anywhere except .env. Never log it.
- NEVER exceed MAX_POSITIONS. Add a hard check in buyEngine.ts.
- NEVER remove the DRY_RUN check from buyEngine or sellEngine. It must always exist.
- ALWAYS log every filter rejection with the reason. You need this data.
- ALWAYS test new filter logic against historical known rugs before deploying.
- ALWAYS have a kill switch: CTRL+C gracefully closes WS and logs state.
- ALWAYS implement the on-chain price fallback in priceOracle.ts before going live.
- ALWAYS compile to JS and run with node for production 24/7 operation, not tsx.

=== KNOWN RISKS ===
- Competing snipers: other bots are watching the same logs. Your filters are
  your moat — speed alone won't save you if you buy rugs.
- Filter latency eating your speed edge: rugHistory (~200–500ms) and metadata
  (~1–3s for Arweave/IPFS) are the slowest filters. Accept this tradeoff.
  The alternative (buying first, filtering second, selling on fail) is faster
  but increases rug exposure. Do not change the filter-first approach without
  very deliberate testing.
- Jito tip wars: during high activity, tips spike to 0.01–0.02 SOL per bundle.
  Dynamic tip scaling in jito.ts handles this. Budget JITO_TIP_MAX = 0.02 SOL.
- Bundle detection evasion: sophisticated bundlers spread buys across 2–3 slots.
  Monitor your FILTER_FAIL logs. If bundled rugs keep slipping through, tighten
  the slot range and lower the wallet threshold in bundleDetect.ts.
- Holder concentration gap: mintAuthority null does not mean supply is safe.
  holderConcentration filter closes this gap, but 15% threshold may need tuning.
  Watch for tokens where holderConcentration passes but price still crashes fast.
- pump-fun-sdk breakage: pump.fun has changed bonding curve contracts before.
  If buy/sell SDK calls fail consistently, fall back to raw IDL transactions.
  Keep /src/idl/pump_fun.json up to date.
- RPC rate limits: Helius free tier throttles under load. Cache aggressively,
  batch requests where possible. Upgrade to Growth plan (~$49/mo) proactively.
- Pump.fun API downtime: priceOracle.ts fallback to on-chain reads handles this.
  Test the fallback path explicitly before going live.
- False filter passes: no filter is perfect. Even passing all 5 checks, ~60–70%
  of tokens will still lose. This is expected. Sizing and stop-losses absorb this.
- Partial sell + time stop interaction: after a 70% TP sell, the time stop and
  stop loss operate on the remaining 30% only. positionManager must track
  remainingTokens accurately. Incorrect accounting here will cause wrong sell
  sizes and corrupted PnL data.