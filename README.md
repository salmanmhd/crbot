# Paper Lab — multi-strategy crypto PAPER-trading experiment

No real money. No exchange API keys. No orders. Public market data only.

366 independent bots (strategy × params × coin × interval × fee profile × SL/TP), each with its own fake ₹10,000 wallet,
run side by side on live prices for 48 hours. Every bot pays the same costs (fees, bid/ask spread + 0.05 % slippage) and the same
Indian tax rules, then a leaderboard shows what each one would *really* have earned — against two baselines (buy & hold and a seeded random coin-flip).
Before going live, the same bots are backtested on 90 days so backtest and live can be compared.

> Not financial or tax advice. The tax model is a simplified reading of India's VDA rules (s.115BBH / s.194S) — see "Cost model".

---

## 1. Quick start (offline, 1 minute)

Requires **Node ≥ 22.18** (runs TypeScript natively; **zero runtime dependencies**, no build step).

```bash
npm test                      # 44 unit tests
node --no-warnings src/cli.ts plan                    # show the 366-bot matrix
node --no-warnings src/cli.ts sim --out out-sim       # synthetic 90d backtest + accelerated 48h live run
node --no-warnings src/cli.ts serve --out out-sim     # dashboard on http://localhost:8080
```

`sim` is the full pipeline on generated prices, with deliberately nasty conditions: ticks that are up to 4 minutes late, 70-minute
outages, and the database closed and reopened every 7 ticks. Open `out-sim/report/final.md` to see the final report format.
**Synthetic prices are random walks: the numbers mean nothing financially. They only prove the machinery works.**

Commands (`--synthetic` works with any of them; `--out <dir>` defaults to `./out`):

| command | what it does |
|---|---|
| `check` | connectivity test against the real data source (klines + bookTicker) |
| `plan [--list]` | print the bot matrix and write `bots.json` |
| `backtest` | fetch 90 days, run every bot → `data/backtest.json`, `BACKTEST.md` |
| `init` | create the 48 h run: warm-up candles, wallets, buy-and-hold entries |
| `tick [--loop-seconds N]` | one catch-up tick (processes every candle closed since last time), writes dashboard data |
| `run` | daemon for Docker/pm2: init if needed, tick every 60 s, stop at 48 h |
| `report` | rebuild leaderboard/site files from the DB |
| `serve [--port]` | serve the dashboard locally |
| `sim` | accelerated synthetic end-to-end rehearsal |

---

## 2. How it works

### Data
Binance public REST: `/api/v3/klines` + `/api/v3/ticker/bookTicker` on `api.binance.com`, falling back to `data-api.binance.vision`.
Coinbase (public, no key) is a built-in alternative: set `PAPER_PROVIDER=coinbase` (or `provider` in `src/config.ts`).
Binance is **not mandatory** — a provider is just `{ getKlines, getBook }`.

* Only **closed** candles are acted on. Every candle ever fetched is stored in SQLite (`candles` table) → the run is fully replayable.
* HTTP: timeouts, retries with exponential backoff, `Retry-After` on 429/418, host fallback on 451/403.
* **Gaps** (missing candles) are detected per series, written to the `gaps` + `errors` tables, counted in "missed candles" on the dashboard and in the final report — never skipped silently.

### Cost model (identical for every bot — `src/config.ts`, `src/portfolio.ts`)
* **Fee** per side: 0.1 % (`default`) and 0.4 % (`indian`, run on 1 h only so every Indian-fee bot has a matched 0.1 % twin).
* **Spread + slippage**: buys fill at `ask × (1+0.05%)`, sells at `bid × (1−0.05%)`. When a candle is processed within 90 s of its close, `ask`/`bid` are the **real live bookTicker**. When a tick ran late (and in the backtest) the fill is `candle close ± the last observed spread` (flagged `model` per trade; the final report says how many fills were `book` vs `model`).
* **India**: 1 % TDS on every sell value is **locked** (cash you can't trade with; refundable via ITR, so counted in equity). 30 % tax + 4 % cess on each **profitable closed trade**; **losses do not offset gains**; fees are **not deductible** (gain = sell value − buy value; flip `tax.feesDeductible` to change).
* **Two ledgers per bot**: *after tax* (above) and *before tax* (same signals, fees and slippage, no TDS/tax).
* **Equity is on a liquidation basis**: open positions are valued as if sold now, *including the tax that sale would trigger*. Otherwise buy-and-hold would look tax-free just because it never sold.

> Reading the numbers: for a high-turnover loser, **after-tax can beat before-tax**. 1 % TDS on every sell locks capital, the bot runs out of tradable cash and stops paying fees. That is a cost-of-capital effect, not "tax is good"; the final report says how many bots show it.

### Execution rules (same in backtest and live → comparable)
1. Signals are computed on the **closed** candle and executed at its close.
2. SL/TP are checked **first**, on the next candles, using high/low: **if both were touched in one candle the stop wins**; a gap through the stop fills at the open; stop = market order (spread + slippage), take-profit = resting limit (fee only).
3. Long-only spot. One all-in position for signal strategies; grid/DCA use fractional lots (FIFO tax per lot).

### Strategies (`src/strategies.ts`; each is a pure `(candles, params) → BUY | SELL | HOLD`)
Baselines (always compared against): **buyAndHold**, **random** (seeded; 2 seeds; deterministic per candle time).
Strategies: **SMA cross** (9/21, 20/50), **EMA cross** (9/21, 12/26), **RSI mean-reversion** (14 30/70, 7 20/80), **Bollinger mean-reversion** (20 ×2, 20 ×2.5; buy below lower band, sell at the middle), **MACD signal cross** (12-26-9, 8-17-9), **Donchian breakout** (20, 55; exit on half-period low), **Grid** (fixed 1 % / 2 % lines around the start price), **DCA** (2 % of wallet every 12 / 48 candles, never sells).
SL/TP variants (none, 2 %/4 %) apply to the six signal strategies.

**366 bots** = 6 buy-and-hold + 24 random + 6 signal families × 2 params × 9 (coin×interval) × 2 SL/TP + grid 18 + DCA 18, all at 0.1 % fee, **plus** the same on 1 h at 0.4 %.
`maxBots` (default 400) caps the total: baselines are always kept and the rest are sampled by a stable hash of the bot id — **never by performance**. The full list is logged (`plan`) and written to `bots.json`.

### Phase 1 — backtest
90 days (+300 warm-up candles) for every symbol/interval, same bots, same cost model. Reports days 1–60 and 61–90 **separately**. **Nothing is tuned on the last 30 days** — all parameters are fixed in code before any data is seen. Per bot: after-/before-tax return, vs buy-and-hold, trades, win rate, avg win/loss, profit factor, max drawdown, Sharpe (hourly equity returns, annualised), fees, slippage, tax, TDS locked, plus the distribution of rolling-48 h returns (used for the backtest-vs-live gap). **Overfit flag**: top 30 % on days 1–60 but bottom 30 % on days 61–90.

### Phase 2 — live paper run (48 h)
State (cursors, candles, wallets, trades, equity, errors) lives in one SQLite file. A tick fetches every closed candle after each series' **cursor**, runs the bots, and commits *candles + cursor + bot states + trades in one transaction per series*. Consequences:
* a tick that runs late, twice, concurrently-skipped, or after a crash/restart can neither miss nor double-process a candle (tested: a punctual run and a run with jitter + 70-min outages + DB restarts + 33 % random API failures end with identical wallets/trades);
* GitHub cron delays are harmless: the next tick just catches up.

Hourly: `data/snapshots/leaderboard-<time>.json|md`. At 48 h the run stops itself and writes `report/final.md` + `report/final.html`.

---

## 3. Deploy and run the 48 h experiment

### A. GitHub Actions (primary — runs unattended, free for public repos)

**One-time setup**

1. Create a **new public** GitHub repo (e.g. `paper-lab`). Public gives free Pages + unmetered Actions minutes.
2. Push this folder to its `main` branch:
   ```bash
   git remote add origin https://github.com/<you>/paper-lab.git
   git push -u origin main
   ```
3. **Settings → Pages → Build and deployment → Source: _GitHub Actions_.**
4. **Settings → Actions → General → Workflow permissions → _Read and write permissions_ → Save.**

**Start the experiment** (Actions tab → *paper-tick* → **Run workflow**, pick the action):

5. `check` — confirms the runner can reach the data source. Expect ✅ and three `OK  binance BTCUSDT…` lines.
   *If you see HTTP 451/403* (Binance blocks some cloud regions): **Settings → Secrets and variables → Actions → Variables → New repository variable `PAPER_PROVIDER` = `coinbase`**, then re-run `check`.
6. `backtest` — fetches 90 days and writes `data/backtest.json` to the `paper-state` branch (a few minutes).
7. `start` — **this starts the 48 h clock.** It creates the run, does the first tick, and from now on the 5-minute schedule keeps ticking by itself.
8. Your dashboard is at **`https://<you>.github.io/<repo>/`** (also shown in the `deploy` job and under Settings → Pages). Bookmark it on your phone.

When 48 h are up the workflow publishes the final report (`/report/final.html`) and **disables its own schedule**.

How it stays safe: `concurrency: paper-lab-state` (never two runs at once) · every tick is a catch-up tick · state is committed to the `paper-state` branch as a **single orphan commit that is force-pushed** (otherwise ~576 × 5 MB of history would pile up; set repo variable `KEEP_HISTORY=1` for ordinary commits) · the dashboard deploys from the same run, **without** the database.

Each run ticks every minute for 4 minutes (`LOOP_SECONDS`, default 240 → fills at the real bookTicker), publishes, then **dispatches the next run itself** (`CHAIN=1`), so the experiment does not depend on GitHub's unreliable cron; the 5-minute cron is only a backup. This uses roughly continuous runner time (~48 h) — free on public repos; on a private repo set `LOOP_SECONDS=0` and `CHAIN=0`. Other repo *Variables*: `PAPER_PROVIDER`, `PAPER_MAX_BOTS`, `PAPER_RUN_HOURS`.
`reset` (type `RESET`) deletes the state branch to start over. Pages can also be served straight from the `paper-state` branch root (Settings → Pages → Deploy from a branch) if you prefer.

### B. VPS with Docker

```bash
git clone https://github.com/<you>/paper-lab.git && cd paper-lab
docker compose up -d          # state in ./data, dashboard on http://<server-ip>:8080
docker compose logs -f paper
```
The `paper` container initialises on first start, ticks every minute, resumes exactly after reboots/crashes (`restart: on-failure`), and exits 0 (and stays stopped) when the 48 h are done. Put it behind a firewall/reverse proxy if the VPS is public.

### C. Laptop with pm2

```bash
npm i -g pm2
pm2 start ecosystem.config.cjs     # runs the daemon + a local dashboard on :8080
pm2 logs paper-lab
pm2 save && pm2 startup            # optional: survive reboots
```
Closing the lid pauses ticking; on wake the next tick catches up every candle that closed meanwhile (fills for those are `model`-priced, not live-book).

---

## 4. Dashboard (`dashboard/index.html`, one static file)
Leaderboard (sortable, default = after-tax return; baselines highlighted; filters) · top-10 vs buy-and-hold chart · per-bot sheet (equity curve vs hold, trades, backtest comparison) · backtest-vs-live table with the rolling-48 h band and overfit flags · run health (last tick, ticks, missed candles, errors, gaps, longest tick gap) · phone-friendly, light/dark. Chart.js 4.4.1 from cdnjs. It auto-refreshes every minute and marks the run **stale?** if no tick for 25 minutes.

## 5. Final report (`report/final.md` + `.html`)
Top/bottom 10 after tax · how many bots beat buy-and-hold and random (and how many *random* bots beat hold, as the chance baseline) · best/worst by family, interval, symbol, fee, SL/TP · tax effect (rank change before vs after, Spearman) · backtest-vs-live gap per strategy · plain-language conclusion — including "**nothing beat holding**" when that is what the data says — and a noise section (random-bot dispersion, correlated bots, selection effect).

## 6. Config
Everything is in **`src/config.ts`**: symbols, intervals, fee profiles, slippage, spread model, tax rates, SL/TP variants, seeds, bot cap, run length, backtest split. Strategy parameter grids are in `src/strategies.ts`.

## 7. Layout
```
src/config.ts       all configuration            src/portfolio.ts  fees/slippage/TDS/tax ledger
src/strategies.ts   pure strategies + grids      src/bot.ts        per-candle step (SL/TP, signals)
src/indicators.ts   SMA EMA RSI BB MACD Donchian src/bots.ts       bot matrix + cap
src/data/           binance, coinbase, synthetic src/live.ts       init + catch-up tick
src/backtest.ts     90-day walk-forward          src/report.ts     leaderboard, snapshots, final report
src/db.ts           SQLite store                 src/sim.ts        accelerated synthetic rehearsal
tests/              44 tests                     scripts/          state restore/publish for Actions
```

## 8. Honest limitations
* **Not verified against live Binance/Coinbase from the sandbox this was built in** (its network blocks both). Parsing, pagination, retries and host fallback are tested with mocked HTTP responses; use the `check` action first.
* Fills happen at the candle close, with no latency or partial fills; prices from a different venue than where you'd trade differ by a few bps.
* A 48 h window is tiny and the bots share only 3 price paths: expect the leaderboard to be mostly noise. Treat the best bot as a hypothesis for a *fresh* window, not a discovery.
* Model-priced fills (late ticks, backtest) use a thin modelled spread; real spread plus slippage in fast markets can be worse.
* Tax is a simplified model (no loss carry-forward, fees non-deductible, TDS refunded at ITR, INR/USDT treated as a fixed rate so percentages are unaffected). Check with a tax professional before acting on any of it.
