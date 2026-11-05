# Final report — 366-bot paper-trading experiment

Window: **2026-11-03 18:11 IST → 2026-11-05 18:11 IST** (48.0h; UTC 2026-11-03T12:41:20.086Z) · data: binance · wallet per bot: 10,000 · all numbers are PAPER results after fees, slippage, spread and Indian tax (liquidation basis — open positions are valued as if sold now, including the tax that sale would trigger).

## Plain-language conclusion

**56 of 336 strategy bots (17%) beat buy-and-hold after tax.** For reference, 1 of 24 purely random bots (4%) also did. That is higher than the random baseline, but see the noise section before reading anything into it.

177 of 336 strategy bots (53%) beat the random baseline for their own coin/interval/fee. Around 50% is what a coin flip gives, so **the strategies as a group showed no reliable edge over random in this window.**

170 of 336 strategy bots had a positive after-tax return; the market itself (buy-and-hold, 0.1% fee) returned ETH 3.07%, BTC 1.76%, SOL 1.11%.

Best strategy bot: **rsi:14-30-70:SOLUSDT:1h:default:none** at 4.12% — but the best *random* bot got 2.75%. With 336 bots, one of them topping the table is expected by luck alone.

### How much of this is noise?

- The window is only **48 hours**. That is a tiny sample: a handful of trades per bot, and one market regime.
- Random bots (no skill by construction) ended with an after-tax standard deviation of **1.97%** between them. Differences between bots smaller than roughly **±3.94%** are indistinguishable from noise.
- The bots are **not independent**: they trade only 3 coins, so they share the same few price paths. Counting 366 bots as 366 experiments overstates the evidence.
- You tested many bots; the best one looking good is the *expected* result of selection, not evidence of skill. Re-running the same bots on a fresh 48h window is the only honest confirmation.

## Top 10 bots (after tax)

| # | bot | after tax | before tax | vs B&H | trades |
|---|---|---|---|---|---|
| 1 | rsi:14-30-70:SOLUSDT:1h:default:none | 4.12% | 6.09% | 3.01% | 1 |
| 2 | rsi:7-20-80:SOLUSDT:1h:default:none | 4.12% | 6.09% | 3.01% | 1 |
| 3 | rsi:7-20-80:ETHUSDT:1h:default:none | 3.99% | 5.90% | 0.92% | 1 |
| 4 | rsi:14-30-70:SOLUSDT:1h:indian:none | 3.49% | 5.45% | 2.99% | 1 |
| 5 | rsi:7-20-80:SOLUSDT:1h:indian:none | 3.49% | 5.45% | 2.99% | 1 |
| 6 | macd:12-26-9:ETHUSDT:1h:default:none | 3.45% | 5.11% | 0.38% | 1 |
| 7 | rsi:14-30-70:BTCUSDT:1h:default:none | 3.44% | 5.10% | 1.68% | 1 |
| 8 | rsi:7-20-80:BTCUSDT:1h:default:none | 3.44% | 5.10% | 1.68% | 1 |
| 9 | macd:8-17-9:ETHUSDT:1h:default:none | 3.41% | 5.05% | 0.34% | 1 |
| 10 | rsi:7-20-80:ETHUSDT:1h:indian:none | 3.36% | 5.26% | 0.91% | 1 |

## Bottom 10 bots (after tax)

| # | bot | after tax | before tax | vs B&H | trades |
|---|---|---|---|---|---|
| 357 | macd:8-17-9:ETHUSDT:5m:default:none | -6.23% | -5.14% | -9.30% | 30 |
| 358 | macd:8-17-9:SOLUSDT:5m:default:none | -6.43% | -4.71% | -7.54% | 25 |
| 359 | macd:8-17-9:ETHUSDT:5m:default:sl2tp4 | -6.51% | -5.62% | -9.58% | 30 |
| 360 | macd:12-26-9:BTCUSDT:5m:default:none | -6.52% | -6.17% | -8.29% | 25 |
| 361 | macd:12-26-9:BTCUSDT:5m:default:sl2tp4 | -6.52% | -6.17% | -8.29% | 25 |
| 362 | macd:8-17-9:SOLUSDT:5m:default:sl2tp4 | -6.70% | -5.16% | -7.82% | 25 |
| 363 | macd:12-26-9:SOLUSDT:5m:default:sl2tp4 | -7.16% | -6.10% | -8.27% | 25 |
| 364 | macd:12-26-9:SOLUSDT:5m:default:none | -7.30% | -6.34% | -8.41% | 25 |
| 365 | macd:8-17-9:BTCUSDT:5m:default:none | -8.29% | -8.47% | -10.06% | 34 |
| 366 | macd:8-17-9:BTCUSDT:5m:default:sl2tp4 | -8.29% | -8.47% | -10.06% | 34 |

Baselines are in **bold** where they appear. Buy-and-hold rows: ETHUSDT default 3.07% · ETHUSDT indian 2.45% · BTCUSDT default 1.76% · BTCUSDT indian 1.15% · SOLUSDT default 1.11% · SOLUSDT indian 0.51%.

## What did best / worst?

Strategy bots only (baselines excluded). Means over a handful of correlated bots — read as descriptive, not predictive.

**By strategy family**

| group | bots | mean after tax | median after tax | % beat B&H | mean trades |
|---|---|---|---|---|---|
| rsi | 48 | 1.27% | 1.24% | 42% | 1.4 |
| dca | 24 | 0.11% | 0.06% | 0% | 0.0 |
| grid | 24 | -0.17% | -0.18% | 0% | 13.3 |
| ema | 48 | -0.41% | -0.71% | 8% | 4.0 |
| sma | 48 | -0.54% | -0.98% | 17% | 3.9 |
| donchian | 48 | -0.54% | -0.41% | 0% | 2.7 |
| bollinger | 48 | -0.87% | -0.22% | 17% | 2.5 |
| macd | 48 | -0.97% | 0.21% | 33% | 9.2 |

**By interval**

| group | bots | mean after tax | median after tax | % beat B&H | mean trades |
|---|---|---|---|---|---|
| 1h | 168 | 0.61% | 0.41% | 29% | 1.2 |
| 15m | 84 | -0.30% | 0.05% | 10% | 3.8 |
| 5m | 84 | -2.11% | -1.51% | 0% | 11.2 |

**By symbol**

| group | bots | mean after tax | median after tax | % beat B&H | mean trades |
|---|---|---|---|---|---|
| ETHUSDT | 112 | 0.10% | 0.12% | 7% | 4.2 |
| BTCUSDT | 112 | -0.28% | 0.02% | 19% | 4.3 |
| SOLUSDT | 112 | -0.72% | -0.42% | 24% | 4.5 |

**By fee profile (default 0.1% vs Indian 0.4%; indian ran on 1h only)**

| group | bots | mean after tax | median after tax | % beat B&H | mean trades |
|---|---|---|---|---|---|
| indian | 84 | 0.26% | 0.04% | 29% | 1.2 |
| default | 252 | -0.48% | 0.00% | 13% | 5.4 |

**By SL/TP variant**

| group | bots | mean after tax | median after tax | % beat B&H | mean trades |
|---|---|---|---|---|---|
| none | 192 | -0.19% | 0.02% | 15% | 4.5 |
| sl2tp4 | 144 | -0.44% | 0.00% | 19% | 4.1 |

**Fee effect (matched pairs, 1h, no SL/TP, 48 pairs):** moving from 0.1% to 0.4% per side cost on average 0.63% of the wallet.

## Effect of Indian tax

- Total tax charged across all bots: **25263.33**; TDS locked (refundable via ITR, counted in equity but unavailable for trading): **118448.27** — both summed over all 366 wallets.
- Mean return drag from tax on strategy bots: **0.74%** of the wallet.
- Rank correlation before vs after tax (Spearman): **0.963** (1.0 = tax never changes the ordering).
- **Why after-tax can beat before-tax for some losers:** 1% TDS is withheld on every sell and locked, so a high-turnover bot runs out of *tradable* cash and stops paying fees. 14 of 366 bots finished with a better after-tax than before-tax number for this reason (locked TDS is counted at full value because it is refundable). Treat that as a cost-of-capital effect, not as tax being good.
- Tax does **not** allow losses to offset gains and fees are not deductible (section 115BBH reading, toggle in config). Frequent traders therefore pay tax on winners and get nothing back on losers — compare each bot's *before* and *after* column.

**Biggest rank drops after tax** (rank before → after):

- random:seed11:ETHUSDT:5m:default:none: 170 → 287 (0.59% → -1.57%)
- ema:12-26:SOLUSDT:5m:default:sl2tp4: 126 → 215 (1.38% → -0.37%)
- macd:8-17-9:ETHUSDT:15m:default:sl2tp4: 142 → 231 (1.20% → -0.62%)
- ema:9-21:ETHUSDT:5m:default:none: 185 → 270 (0.37% → -1.26%)
- ema:9-21:ETHUSDT:5m:default:sl2tp4: 195 → 276 (0.25% → -1.34%)

**Biggest rank gains after tax** (they gained because others were taxed more, e.g. holders that never realised a gain):

- dca:every48:ETHUSDT:1h:default:none: 221 → 172 (0.09% → 0.06%)
- dca:every12:SOLUSDT:1h:default:none: 220 → 171 (0.11% → 0.06%)
- dca:every48:SOLUSDT:15m:default:none: 219 → 170 (0.11% → 0.06%)
- dca:every12:BTCUSDT:1h:default:none: 218 → 169 (0.12% → 0.07%)
- dca:every48:BTCUSDT:15m:default:none: 217 → 168 (0.12% → 0.07%)

## Backtest vs live

Backtest: 90 days (binance), same bots, same cost model. "Backtest 48h" is the average return over every rolling 48h window inside the backtest; the band is its 10th–90th percentile. Gap = live − backtest mean.

| strategy | bots | backtest 48h mean | backtest p10…p90 (avg) | live (mean) | gap | live outside band |
|---|---|---|---|---|---|---|
| bollinger | 48 | -0.45% | -1.63% … 0.23% | -0.87% | -0.42% | 40/48 |
| buyAndHold | 6 | 0.36% | -2.32% … 3.25% | 1.68% | 1.31% | 1/6 |
| dca | 24 | 0.17% | -2.12% … 2.68% | 0.11% | -0.06% | 0/24 |
| donchian | 48 | -0.35% | -1.94% … 0.93% | -0.54% | -0.20% | 16/48 |
| ema | 48 | -0.54% | -2.25% … 0.95% | -0.41% | 0.14% | 11/48 |
| grid | 24 | -0.22% | -1.91% … 1.26% | -0.17% | 0.05% | 0/24 |
| macd | 48 | -0.63% | -2.07% … 0.52% | -0.97% | -0.34% | 39/48 |
| random | 24 | -0.40% | -2.01% … 0.74% | -0.32% | 0.09% | 13/24 |
| rsi | 48 | -0.23% | -1.90% … 1.19% | 1.27% | 1.49% | 27/48 |
| sma | 48 | -0.52% | -2.17% … 0.91% | -0.54% | -0.02% | 31/48 |

Bots flagged as likely overfit in the backtest (good days 1–60, bad days 61–90): 43. Their live mean: 0.36% vs -0.39% for the rest.

## Run health & data quality

- Ticks: 1782 · candles processed: 2448 · **missed candles (gaps): 0** · errors logged: 0 · longest gap between ticks: 362.7 min.
- Fill pricing: 1025 trades filled at the real live bid/ask, 524 at modelled prices (candle close ± observed spread, used when a tick ran late). Both include the extra 0.05% slippage.
- Assumptions worth remembering: signals act at the candle close; SL/TP are checked on closed candles using high/low (stop wins if both are touched); take-profit fills as a limit (fee, no slippage); stop-loss fills as a market order.
