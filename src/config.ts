/**
 * ALL experiment configuration lives in this one file.
 * A few values can be overridden by environment variables (see bottom) so CI / Docker can tweak them.
 */
export const CONFIG = {
  // ---- market data -------------------------------------------------------------------------
  provider: 'binance' as 'binance' | 'coinbase',           // data source (public endpoints only)
  binanceHosts: ['https://api.binance.com', 'https://data-api.binance.vision'],
  coinbaseHost: 'https://api.exchange.coinbase.com',
  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
  intervals: ['5m', '15m', '1h'],
  warmupBars: 300,           // candles fed to every strategy (identical in backtest & live => identical signals)
  httpTimeoutMs: 15_000,
  httpRetries: 4,

  // ---- wallets -----------------------------------------------------------------------------
  // Prices are in quote currency (USDT). We treat 1 quote unit == 1 INR-equivalent (fixed FX), which
  // leaves every percentage return unchanged. So the wallet is simply "10,000 units".
  initialCash: 10_000,

  // ---- cost model (identical for every strategy) ---------------------------------------------
  feeProfiles: { default: 0.001, indian: 0.004 } as Record<string, number>, // per side
  extraSlippagePct: 0.0005,  // added on top of the spread: buys fill at ask*(1+x), sells at bid*(1-x)
  modelSpreadPct: 0.0001,    // used ONLY when a live bookTicker is unavailable (backtest, late catch-up fills)
  liveFillMaxLagSec: 90,     // candle processed within this lag of its close => fill at the real bookTicker

  // ---- India tax ----------------------------------------------------------------------------
  tax: {
    tdsRate: 0.01,           // 1% TDS on every sell value: cash locked, refundable via ITR
    taxRate: 0.30,           // 30% on each profitable closed trade
    cessRate: 0.04,          // 4% cess on the tax
    // Section 115BBH allows only cost of acquisition. false => gain = sellValue - buyValue (fees NOT deductible).
    feesDeductible: false,
  },

  // ---- bot matrix ---------------------------------------------------------------------------
  maxBots: 400,              // hard cap; baselines are always kept, the rest are sampled deterministically
  sltpVariants: {
    none: null,
    sl2tp4: { sl: 0.02, tp: 0.04 },
  } as Record<string, { sl: number; tp: number } | null>,
  /** Fee profile -> intervals it is run on. 'indian' only on 1h keeps matched pairs without doubling the bot count. */
  feeProfileIntervals: { default: ['5m', '15m', '1h'], indian: ['1h'] } as Record<string, string[]>,
  randomSeeds: [11, 22],
  randomProb: 0.04,

  // ---- live run -----------------------------------------------------------------------------
  runHours: 48,
  equityEveryMin: 15,        // equity-curve sampling in the live DB
  snapshotEveryMin: 60,      // hourly leaderboard JSON + markdown
  daemonTickSec: 60,         // `run` (docker / pm2) polls every minute

  // ---- backtest -----------------------------------------------------------------------------
  backtestDays: 90,
  splitDay: 60,              // days 1-60 vs 61-90 reported separately; nothing is tuned on 61-90
  overfitHighPct: 0.7,       // top 30% on days 1-60 ...
  overfitLowPct: 0.3,        // ... but bottom 30% on days 61-90  => flagged
};
export type Config = typeof CONFIG;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const c: Config = structuredClone(CONFIG);
  if (env.PAPER_MAX_BOTS) c.maxBots = Number(env.PAPER_MAX_BOTS);
  if (env.PAPER_PROVIDER === 'binance' || env.PAPER_PROVIDER === 'coinbase') c.provider = env.PAPER_PROVIDER;
  if (env.PAPER_RUN_HOURS) c.runHours = Number(env.PAPER_RUN_HOURS);
  if (env.PAPER_SYMBOLS) c.symbols = env.PAPER_SYMBOLS.split(',').map((s) => s.trim());
  if (env.PAPER_INTERVALS) c.intervals = env.PAPER_INTERVALS.split(',').map((s) => s.trim());
  return c;
}
