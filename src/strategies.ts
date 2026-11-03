import type { Candle, Signal } from './types.ts';
import { sma, ema, rsi, bollinger, macd, donchianHigh, donchianLow } from './indicators.ts';

/** Context injected into every strategy call next to its own params (keeps strategies pure). */
export interface StratCtx { startTime: number; intervalMs: number; refPrice: number }
export type StrategyFn = (candles: Candle[], params: any) => Signal;

export interface StrategyDef {
  family: string;
  baseline: boolean;
  /** all = one all-in position at a time; fraction = each BUY invests `fraction` of the initial wallet. */
  sizing: { mode: 'all' } | { mode: 'fraction'; fraction: number };
  sellMode: 'all' | 'lowest_profitable' | 'never';
  allowSltp: boolean;
  variants: { label: string; params: Record<string, number> }[];
  fn: StrategyFn;
}

const closes = (c: Candle[]) => c.map((x) => x.close);
const last = (a: number[]) => a[a.length - 1];
const prev = (a: number[]) => a[a.length - 2];
const ok = (...xs: number[]) => xs.every((x) => !Number.isNaN(x));

/** Deterministic uniform [0,1) from (seed, idx) -- no state, so replays are exact. */
export function rnd01(seed: number, idx: number): number {
  let a = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(idx | 0, 0x85ebca6b)) >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function cross(fast: number[], slow: number[]): Signal {
  const f1 = last(fast), s1 = last(slow), f0 = prev(fast), s0 = prev(slow);
  if (!ok(f1, s1, f0, s0)) return 'HOLD';
  if (f0 - s0 <= 0 && f1 - s1 > 0) return 'BUY';
  if (f0 - s0 >= 0 && f1 - s1 < 0) return 'SELL';
  return 'HOLD';
}

export const buyAndHold: StrategyFn = () => 'BUY';

/** Seeded coin flip: independent draw per candle. BUY is ignored when already long, SELL when flat. */
export const randomStrat: StrategyFn = (c, p) => {
  const idx = Math.floor(c[c.length - 1].openTime / 60_000);
  const u = rnd01(p.seed, idx);
  if (u < p.prob) return 'BUY';
  if (u > 1 - p.prob) return 'SELL';
  return 'HOLD';
};

export const smaCross: StrategyFn = (c, p) => {
  if (c.length < p.slow + 1) return 'HOLD';
  const v = closes(c);
  return cross(sma(v, p.fast), sma(v, p.slow));
};
export const emaCross: StrategyFn = (c, p) => {
  if (c.length < p.slow + 1) return 'HOLD';
  const v = closes(c);
  return cross(ema(v, p.fast), ema(v, p.slow));
};
export const rsiMeanRev: StrategyFn = (c, p) => {
  if (c.length < p.period + 2) return 'HOLD';
  const r = last(rsi(closes(c), p.period));
  if (!ok(r)) return 'HOLD';
  if (r < p.lo) return 'BUY';
  if (r > p.hi) return 'SELL';
  return 'HOLD';
};
export const bollMeanRev: StrategyFn = (c, p) => {
  if (c.length < p.period + 1) return 'HOLD';
  const b = bollinger(closes(c), p.period, p.k);
  const px = c[c.length - 1].close;
  if (!ok(last(b.lower), last(b.mid))) return 'HOLD';
  if (px < last(b.lower)) return 'BUY';
  if (px > last(b.mid)) return 'SELL';
  return 'HOLD';
};
export const macdCross: StrategyFn = (c, p) => {
  if (c.length < p.slow + p.signal + 2) return 'HOLD';
  const m = macd(closes(c), p.fast, p.slow, p.signal);
  const h1 = last(m.hist), h0 = prev(m.hist);
  if (!ok(h1, h0)) return 'HOLD';
  if (h0 <= 0 && h1 > 0) return 'BUY';
  if (h0 >= 0 && h1 < 0) return 'SELL';
  return 'HOLD';
};
export const donchianBreakout: StrategyFn = (c, p) => {
  const exit = Math.max(2, Math.floor(p.period / 2));
  if (c.length < p.period + 2) return 'HOLD';
  const hi = last(donchianHigh(c.map((x) => x.high), p.period));
  const lo = last(donchianLow(c.map((x) => x.low), exit));
  const px = c[c.length - 1].close;
  if (ok(hi) && px > hi) return 'BUY';
  if (ok(lo) && px < lo) return 'SELL';
  return 'HOLD';
};
/** Fixed %-grid anchored at the price when the bot started. Crossing a line down => BUY, up => SELL. */
export const gridStrat: StrategyFn = (c, p) => {
  if (c.length < 2 || !(p.refPrice > 0)) return 'HOLD';
  const step = Math.log(1 + p.step);
  const lvl = (x: number) => Math.floor(Math.log(x / p.refPrice) / step);
  const a = lvl(c[c.length - 2].close), b = lvl(c[c.length - 1].close);
  if (b < a) return 'BUY';
  if (b > a) return 'SELL';
  return 'HOLD';
};
/** Buy a fixed amount every N candles counted from the bot's start. Never sells. */
export const dcaStrat: StrategyFn = (c, p) => {
  const idx = Math.round((c[c.length - 1].openTime - p.startTime) / p.intervalMs);
  return idx >= 0 && idx % p.every === 0 ? 'BUY' : 'HOLD';
};

export const STRATEGIES: Record<string, StrategyDef> = {
  buyAndHold: { family: 'buyAndHold', baseline: true, sizing: { mode: 'all' }, sellMode: 'never', allowSltp: false,
    variants: [{ label: 'hold', params: {} }], fn: buyAndHold },
  random: { family: 'random', baseline: true, sizing: { mode: 'all' }, sellMode: 'all', allowSltp: false,
    variants: [], fn: randomStrat }, // variants (seeds) are filled from config in bots.ts
  sma: { family: 'sma', baseline: false, sizing: { mode: 'all' }, sellMode: 'all', allowSltp: true,
    variants: [{ label: '9-21', params: { fast: 9, slow: 21 } }, { label: '20-50', params: { fast: 20, slow: 50 } }], fn: smaCross },
  ema: { family: 'ema', baseline: false, sizing: { mode: 'all' }, sellMode: 'all', allowSltp: true,
    variants: [{ label: '9-21', params: { fast: 9, slow: 21 } }, { label: '12-26', params: { fast: 12, slow: 26 } }], fn: emaCross },
  rsi: { family: 'rsi', baseline: false, sizing: { mode: 'all' }, sellMode: 'all', allowSltp: true,
    variants: [{ label: '14-30-70', params: { period: 14, lo: 30, hi: 70 } }, { label: '7-20-80', params: { period: 7, lo: 20, hi: 80 } }], fn: rsiMeanRev },
  bollinger: { family: 'bollinger', baseline: false, sizing: { mode: 'all' }, sellMode: 'all', allowSltp: true,
    variants: [{ label: '20-2.0', params: { period: 20, k: 2 } }, { label: '20-2.5', params: { period: 20, k: 2.5 } }], fn: bollMeanRev },
  macd: { family: 'macd', baseline: false, sizing: { mode: 'all' }, sellMode: 'all', allowSltp: true,
    variants: [{ label: '12-26-9', params: { fast: 12, slow: 26, signal: 9 } }, { label: '8-17-9', params: { fast: 8, slow: 17, signal: 9 } }], fn: macdCross },
  donchian: { family: 'donchian', baseline: false, sizing: { mode: 'all' }, sellMode: 'all', allowSltp: true,
    variants: [{ label: '20', params: { period: 20 } }, { label: '55', params: { period: 55 } }], fn: donchianBreakout },
  grid: { family: 'grid', baseline: false, sizing: { mode: 'fraction', fraction: 0.1 }, sellMode: 'lowest_profitable', allowSltp: false,
    variants: [{ label: '1pct', params: { step: 0.01 } }, { label: '2pct', params: { step: 0.02 } }], fn: gridStrat },
  dca: { family: 'dca', baseline: false, sizing: { mode: 'fraction', fraction: 0.02 }, sellMode: 'never', allowSltp: false,
    variants: [{ label: 'every12', params: { every: 12 } }, { label: 'every48', params: { every: 48 } }], fn: dcaStrat },
};
