---
trigger: always_on
---

# PUMP.FUN SNIPER BOT — RULES

## WHAT THIS BOT DOES
Monitors Solana in real time for new pump.fun token launches. Detects via WebSocket, runs filters, buys if all pass, monitors position, sells automatically on TP/SL/time/emergency. Edge = speed (first 1–3 blocks) + filters (avoiding rugs). NOT arbitrage or MEV.

## STRATEGY CONTEXT
Pump.fun tokens launch on a bonding curve — price rises as people buy. Early buyers get best price. Most tokens fail, but some pump 5x–50x in minutes. Goal: catch early, take profit fast, cut losers faster. One 5x winner covers ~10 stop-loss losses at 0.1 SOL size.

---

## CAPITAL RULES (2 SOL TOTAL)
- `0.5 SOL` — permanent gas reserve. NEVER trade with this. Running out of gas = stuck in positions.
- `1.5 SOL` — trading bankroll
- `0.1–0.3 SOL` per trade. Start at 0.1 SOL until bot is proven.
- Max `5` concurrent open positions at any time.

---

## DRY RUN MODE
`DRY_RUN=true` in `.env` activates paper-trading. Full pipeline runs but NO transactions are submitted. PnL is simulated and logged identically to live mode with `[DRY]` prefix.
- ALWAYS run DRY_RUN first after any code change.
- NEVER disable DRY_RUN until build steps 1–7 are confirmed stable.
- DRY_RUN check MUST be the first line in `buyEngine.ts` and `sellEngine.ts`.

---

## TECH STACK
- **Language:** TypeScript (NOT Python — Solana ecosystem is TS-first, all SDKs have first-class TS support. `solana-py` is slow and underpowered.)
- **Runtime:** Node.js v18+
- **For dev:** `tsx` (run TS directly). **For production 24/7:** compile to JS, run with `node`. tsx adds overhead and is unstable for long-running processes.

### Key Packages
| Package | Purpose |
|---|---|
| `@solana/web3.js` | Core Solana interactions, tx building, account fetching |
| `@solana/spl-token` | SPL token account reads, mint info |
| `@jito-ts/sdk` | Jito block engine for fast tx landing |
| `pump-fun-sdk` | Buy/sell on pump.fun bonding curve. WARNING: community-maintained, may lag contract upgrades. If SDK calls fail, fall back to raw IDL in `/src/idl/pump_fun.json`. |
| `bs58` | Base58 keypair encoding |
| `dotenv` | `.env` management |
| `chalk` | Colored terminal output |
| `axios` | HTTP to pump.fun REST API |
| `tsx` | Dev runner |

---

## INFRASTRUCTURE

### Helius (helius.dev)
- RPC endpoint + WebSocket for real-time log subscriptions
- Free tier: 1M credits/mo. `getSignaturesForAddress` and WebSocket are credit-heavy — cache aggressively.
- Upgrade to Growth (~$49/mo) proactively before getting throttled mid-session.
- Env vars: `HELIUS_RPC_URL`, `HELIUS_WS_URL`

### Jito (jito.wtf)
- Block engine for fast tx bundles. Validators prioritize bundles over regular txs.
- Tip: `0.001–0.005 SOL` per bundle normally. During viral launches tip wars spike to `0.01–0.02 SOL`.
- Implement dynamic tip scaling based on recent tip success rate.
- Bundle landing NOT guaranteed. Retry logic: if not confirmed within 2 slots (~800ms), resubmit with tip +50%, up to `JITO_TIP_MAX`.
- NEVER send buys/sells as regular transactions. Too slow.
- Env var: `JITO_BLOCK_ENGINE_URL`

### Pump.fun API
- REST for token price + bonding curve progress: `https://frontend-api.pump.fun/coins/{mintAddress}`
- WARNING: unofficial, undocumented, no SLA. Can go down.
- ALWAYS implement on-chain fallback: read bonding curve account via `getAccountInfo()`, parse `virtualSolReserves` / `virtualTokenReserves` to compute spot price. Auto-activates after 3 consecutive REST failures.

---

## EXECUTION FLOW

### 1. LISTEN
WebSocket → Helius → subscribe to pump.fun program logs (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`). Parse `initializeMint2` to extract: mint address, dev wallet, name, symbol, metadata URI.

### 2. FILTER (all 5 must pass — run in parallel)
If ANY fail → discard immediately + log rejection reason.

> **Speed note:** Filters add latency. `rugHistory` (~200–500ms) and `metadata` (~1–3s Arweave/IPFS) are slowest. By the time filters complete, token may already be 2–5x. This is the deliberate safety tradeoff — do NOT remove filters to chase speed.

| Filter | Logic | Skip if |
|---|---|---|
| `rugHistory` | Check dev wallet tx history. Cache bad wallets in-memory. | Dev previously created tokens that died within 30min |
| `bundleDetect` | Fetch first 5 txs, group by slot. Check slots 0–2. | 3+ wallets in slot 0, OR 2+ wallets in slots 1–2 (spread bundling) |
| `mintAuthority` | `getMint()` from `@solana/spl-token` | `mintAuthority` ≠ null OR `freezeAuthority` ≠ null |
| `holderConcentration` | `getProgramAccounts()` top 10 holders. Exclude bonding curve program. | Any single wallet > `HOLDER_CONCENTRATION_LIMIT` (15%) of supply |
| `metadata` | Fetch Metaplex URI → JSON from Arweave/IPFS | No `twitter` or `telegram` fields in JSON |

### 3. BUY
1. Check `DRY_RUN` — if true, simulate + log, return.
2. Check `MAX_POSITIONS` not exceeded.
3. Check gas reserve intact.
4. Build via `pump-fun-sdk` (fallback to raw IDL if SDK fails).
5. Wrap in Jito bundle with tip.
6. Set `slippage: 15%`, `ComputeBudgetProgram` priority fee.
7. Record: mint, entry price, SOL spent, timestamp.

### 4. MONITOR
Poll price every 3s via `priceOracle.ts`. After 3 consecutive REST failures → switch to on-chain bonding curve read automatically. Calculate multiplier vs entry. Check exit conditions every poll. Track `partialSold` and `remainingTokens` per position.

### 5. SELL
Check `DRY_RUN` first. All exit conditions operate on `remainingTokens` (accounts for partial sells).

| Trigger | Condition | Action |
|---|---|---|
| Take Profit | price ≥ 2x entry | Sell 70% via Jito. Set `partialSold=true`. Move SL on remaining 30% to 1.5x entry. |
| Stop Loss | price ≤ 0.6x entry (−40%) | Sell 100% of remaining. No hesitation. |
| Time Stop | open > 10min AND price < 1.2x | Sell 100% of remaining. Flat tokens rarely recover. |
| Emergency | Liquidity removal OR large dev wallet sell detected | Sell 100% of remaining immediately, ignore price. |

---

## FILE STRUCTURE

```
sniper-bot/
├── config.ts                        # All tunable params — import everywhere
├── .env                             # Secrets — NEVER commit to git
└── src/
    ├── index.ts                     # Entry point, wires all modules, graceful shutdown
    ├── listener/
    │   └── tokenListener.ts         # WebSocket → parse initializeMint2 → emit events only
    ├── filters/
    │   ├── rugHistory.ts            # Dev wallet history + in-memory bad wallet cache
    │   ├── bundleDetect.ts          # Coordinated buy detection across slots 0–2
    │   ├── mintAuthority.ts         # getMint() — mintAuthority + freezeAuthority must be null
    │   ├── holderConcentration.ts   # getProgramAccounts() top holders, skip bonding curve acct
    │   └── metadata.ts             # Metaplex URI → Arweave/IPFS JSON → check socials
    ├── trading/
    │   ├── buyEngine.ts             # DRY_RUN check first, filters check, build+submit buy
    │   ├── sellEngine.ts            # DRY_RUN check first, build+submit sell, log PnL
    │   ├── positionManager.ts       # Map<mint, Position>, polling loops, exit condition checks
    │   └── priceOracle.ts           # Abstraction: REST primary → on-chain fallback, getPrice(mint)
    ├── utils/
    │   ├── rpc.ts                   # Single Connection + WebSocket instance, reused everywhere
    │   ├── wallet.ts                # Load keypair from env, SOL balance check, gas reserve guard
    │   └── jito.ts                  # Bundle builder, tip instruction, retry+escalate logic
    └── logger/
        ├── logger.ts                # JSON-lines trades.log, [DRY] prefix in dry run
        └── dashboard.ts             # Chalk terminal: positions, PnL, win rate, SOL balance
```

---

## CONFIG PARAMS (`config.ts`)

```ts
BUY_SIZE = 0.1              // SOL per trade (start here, increase when proven)
MAX_POSITIONS = 5
TAKE_PROFIT = 2.0           // x multiplier
STOP_LOSS = 0.6             // x multiplier (−40%)
TIME_STOP_MINUTES = 10
JITO_TIP = 0.002            // SOL base tip
JITO_TIP_MAX = 0.02         // SOL max tip (tip wars ceiling)
SLIPPAGE = 0.15             // 15%
PRICE_POLL_INTERVAL = 3000  // ms
HOLDER_CONCENTRATION_LIMIT = 0.15  // 15% max single holder
PUMP_FUN_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
GAS_RESERVE = 0.5           // SOL — never trade below this balance
```

---

## ENV VARS (`.env`)

```
HELIUS_RPC_URL=
HELIUS_WS_URL=
JITO_BLOCK_ENGINE_URL=
WALLET_PRIVATE_KEY=         # base58 encoded — NEVER log this
DRY_RUN=true                # start true, flip to false only when ready
```

---

## BUILD ORDER
Build and TEST each step before proceeding. Never skip ahead.

1. `config.ts` — all constants including `DRY_RUN`, `HOLDER_CONCENTRATION_LIMIT`
2. `.env` + `src/utils/rpc.ts` — connect to Helius, log latest block number
3. `src/utils/wallet.ts` — load keypair, print pubkey + balance
4. `src/listener/tokenListener.ts` — log detected tokens to console only (no buying)
5. `src/filters/` (all 5) — test each against known rug + legit tokens
6. `src/utils/jito.ts` — test dummy tx on devnet, verify retry logic fires
7. `src/trading/priceOracle.ts` — test both REST and on-chain fallback paths explicitly
8. `src/trading/buyEngine.ts` — DRY_RUN=true first, then 0.01 SOL live test
9. `src/trading/positionManager.ts` — mock position, test `partialSold` logic
10. `src/trading/sellEngine.ts` — DRY_RUN=true first, then live sell on step 8 position
11. `src/logger/` — verify `[DRY]` prefix, check `trades.log` output
12. `src/index.ts` — wire everything, run full pipeline DRY_RUN for ≥1 hour before live

---

## HARD RULES
- NEVER send txs without Jito. Regular txs are too slow.
- NEVER buy if any single filter fails.
- NEVER use the 0.5 SOL gas reserve for trades.
- NEVER run with real money until steps 1–7 confirmed in DRY_RUN.
- NEVER store `WALLET_PRIVATE_KEY` outside `.env`. Never log it.
- NEVER exceed `MAX_POSITIONS`. Hard check in `buyEngine.ts`.
- NEVER remove the `DRY_RUN` check from `buyEngine` or `sellEngine`.
- ALWAYS log every filter rejection with the reason.
- ALWAYS test filter changes against historical known rugs before deploying.
- ALWAYS implement on-chain price fallback before going live.
- ALWAYS compile to JS (`node`) for production, not `tsx`.
- ALWAYS handle CTRL+C gracefully: close WebSocket, log final state.

---

## KNOWN RISKS

**Competing snipers** — other bots watch the same logs. Filters are your moat, not speed alone.

**Filter latency** — `rugHistory` (~200–500ms) and `metadata` (~1–3s Arweave) eat into speed. Accept this tradeoff. Buying before filtering = faster entry but higher rug exposure. Do not change without deliberate testing.

**Jito tip wars** — spikes to 0.01–0.02 SOL during viral launches. Dynamic tip scaling in `jito.ts` handles this. `JITO_TIP_MAX = 0.02` is your ceiling.

**Bundle detection evasion** — sophisticated bundlers spread across 2–3 slots. Watch `FILTER_FAIL` logs. If bundled rugs slip through, tighten slot range and lower wallet threshold in `bundleDetect.ts`.

**Holder concentration gap** — `mintAuthority=null` doesn't mean supply is safe. `holderConcentration` filter closes this. 15% threshold may need tuning — watch for tokens that pass but dump fast.

**pump-fun-sdk breakage** — pump.fun has changed bonding curve contracts before. Keep `/src/idl/pump_fun.json` current. Raw IDL fallback must be implemented.

**RPC rate limits** — Helius free tier throttles under load. Cache aggressively, batch requests. Upgrade to Growth proactively.

**Pump.fun API downtime** — `priceOracle.ts` fallback handles this. Test the fallback path explicitly before going live.

**False filter passes** — no filter is perfect. ~60–70% of tokens that pass all 5 filters will still lose. Expected. Sizing + stop-losses absorb this.

**Partial sell accounting** — after 70% TP sell, time stop and SL operate on remaining 30% only. `positionManager` must track `remainingTokens` accurately. Wrong accounting = wrong sell