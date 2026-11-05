# Backtest — 90 days (binance)

Window 2026-08-05T12:00:00.000Z → 2026-11-03T12:00:00.000Z. Days 1–60 vs 61–90 reported separately; **no parameter was tuned on the last 30 days** (all params are fixed up-front in `src/strategies.ts`).

Bots: 366. Beat buy-and-hold (after tax): 1/336. Flagged as likely overfit: 43.

## Top 10 / Bottom 10 by after-tax return

| # | bot | after tax | before tax | vs B&H | days 1–60 | days 61–90 | trades | maxDD | overfit |
|---|---|---|---|---|---|---|---|---|---|
| 1 | dca:every12:SOLUSDT:5m:default:none | 17.47% | 25.50% | 0.30% | 44.23% | -18.55% | 0 | 20.86% | ⚠️ |
| 2 | buyAndHold:hold:SOLUSDT:1h:default:none | 17.17% | 25.06% | 0.00% | 43.83% | -18.54% | 0 | 20.85% |  |
| 3 | buyAndHold:hold:SOLUSDT:1h:indian:none | 16.44% | 24.31% | 0.00% | 42.91% | -18.52% | 0 | 20.83% |  |
| 4 | dca:every12:SOLUSDT:15m:default:none | 15.71% | 22.93% | -1.46% | 41.92% | -18.47% | 0 | 20.77% | ⚠️ |
| 5 | dca:every48:SOLUSDT:5m:default:none | 15.42% | 22.52% | -1.75% | 41.54% | -18.45% | 0 | 20.76% | ⚠️ |
| 6 | buyAndHold:hold:ETHUSDT:1h:default:none | 14.33% | 20.93% | 0.00% | 30.21% | -12.19% | 0 | 16.21% |  |
| 7 | buyAndHold:hold:BTCUSDT:1h:default:none | 13.67% | 19.97% | 0.00% | 22.44% | -7.17% | 0 | 9.10% |  |
| 8 | buyAndHold:hold:ETHUSDT:1h:indian:none | 13.63% | 20.21% | 0.00% | 29.39% | -12.18% | 0 | 16.19% |  |
| 9 | rsi:14-30-70:SOLUSDT:1h:default:none | 13.51% | 26.79% | -3.66% | 25.85% | -9.81% | 11 | 11.15% |  |
| 10 | dca:every48:BTCUSDT:5m:default:none | 13.20% | 19.29% | -0.47% | 21.93% | -7.16% | 0 | 9.09% |  |
| … | | | | | | | | | |
| 357 | macd:12-26-9:ETHUSDT:1h:indian:none | -38.86% | -50.09% | -52.49% | -28.80% | -14.13% | 83 | 39.26% |  |
| 358 | ema:9-21:ETHUSDT:1h:indian:sl2tp4 | -39.84% | -49.27% | -53.47% | -27.51% | -17.01% | 61 | 39.84% |  |
| 359 | macd:8-17-9:SOLUSDT:1h:indian:none | -40.06% | -55.12% | -56.51% | -29.51% | -14.97% | 109 | 40.19% |  |
| 360 | macd:8-17-9:ETHUSDT:1h:indian:none | -40.40% | -55.04% | -54.03% | -32.90% | -11.18% | 103 | 40.83% |  |
| 361 | macd:8-17-9:BTCUSDT:1h:indian:none | -40.45% | -60.50% | -53.42% | -29.66% | -15.34% | 112 | 40.53% |  |
| 362 | macd:8-17-9:SOLUSDT:1h:indian:sl2tp4 | -40.89% | -56.73% | -57.34% | -30.40% | -15.08% | 109 | 41.02% |  |
| 363 | macd:12-26-9:ETHUSDT:1h:indian:sl2tp4 | -41.58% | -53.52% | -55.21% | -32.65% | -13.26% | 83 | 41.96% |  |
| 364 | sma:9-21:ETHUSDT:1h:indian:sl2tp4 | -41.93% | -55.08% | -55.56% | -29.83% | -17.25% | 73 | 42.26% |  |
| 365 | macd:8-17-9:BTCUSDT:1h:indian:sl2tp4 | -42.33% | -63.76% | -55.30% | -32.15% | -15.01% | 112 | 42.40% |  |
| 366 | macd:8-17-9:ETHUSDT:1h:indian:sl2tp4 | -43.00% | -59.95% | -56.63% | -34.93% | -12.40% | 103 | 43.41% |  |
