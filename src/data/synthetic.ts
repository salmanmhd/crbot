import type { Book, Candle, Clock, MarketData } from '../types.ts';
import { INTERVAL_MS } from '../types.ts';
import { rnd01 } from '../strategies.ts';

export const SYNTH_EPOCH = Date.UTC(2026, 0, 1);
const DAYS = 700;
const BASE: Record<string, number> = { BTCUSDT: 60000, ETHUSDT: 3000, SOLUSDT: 150 };
const MIN = 60_000;

function normal(seed: number, idx: number): number {
  const u1 = Math.max(1e-12, rnd01(seed, idx * 2 + 1)), u2 = rnd01(seed, idx * 2 + 2);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
const hashStr = (s: string) => { let h = 7; for (const ch of s) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; return h; };

/**
 * Deterministic fake market: 1-minute random walk with regime-switching drift and volatility,
 * aggregated into any interval. Same (symbol, time) => same candle, always -- so restarts and
 * replays are exactly reproducible. Prices are a pure function of time (no wall clock inside).
 */
export class SyntheticData implements MarketData {
  readonly name = 'synthetic';
  private closes = new Map<string, Float64Array>();
  private clock: Clock;
  constructor(clock: Clock) { this.clock = clock; }

  private path(symbol: string): Float64Array {
    let p = this.closes.get(symbol);
    if (p) return p;
    const seed = hashStr(symbol), n = DAYS * 1440;
    p = new Float64Array(n + 1);
    p[0] = BASE[symbol] ?? 100;
    let drift = 0, vol = 0.0006;
    for (let m = 1; m <= n; m++) {
      if (m % 1440 === 1) vol = 0.0003 + 0.0009 * rnd01(seed, 5_000_000 + m / 1440 | 0);          // per-day vol regime
      if (m % 2880 === 1) drift = (rnd01(seed, 6_000_000 + (m / 2880 | 0)) - 0.5) * 0.00006;         // ~2-day drift regime
      p[m] = p[m - 1] * Math.exp(drift + vol * normal(seed, m));
    }
    this.closes.set(symbol, p);
    return p;
  }
  private minuteHL(symbol: string, m: number, o: number, c: number): [number, number] {
    const seed = hashStr(symbol) + 99, wig = Math.abs(c - o) / o + 0.0002;
    return [Math.max(o, c) * (1 + rnd01(seed, m * 2) * wig), Math.min(o, c) * (1 - rnd01(seed, m * 2 + 1) * wig)];
  }
  async getKlines(symbol: string, interval: string, startMs: number, endMs: number, limit: number): Promise<Candle[]> {
    const ms = INTERVAL_MS[interval], p = this.path(symbol), k = ms / MIN;
    const first = Math.ceil(Math.max(startMs, SYNTH_EPOCH) / ms) * ms;
    const out: Candle[] = [];
    for (let t = first; t <= endMs && out.length < limit; t += ms) {
      const m0 = Math.floor((t - SYNTH_EPOCH) / MIN);
      if (m0 + k >= p.length) break;
      let hi = -Infinity, lo = Infinity, vol = 0;
      for (let m = m0 + 1; m <= m0 + k; m++) { const [h, l] = this.minuteHL(symbol, m, p[m - 1], p[m]); hi = Math.max(hi, h); lo = Math.min(lo, l); vol += 1 + rnd01(7, m); }
      out.push({ openTime: t, open: p[m0], high: hi, low: lo, close: p[m0 + k], volume: vol, closeTime: t + ms - 1 });
    }
    // like a real exchange: the still-forming candle is returned too (the tick filters on closeTime)
    return out;
  }
  async getBook(symbol: string): Promise<Book> {
    const p = this.path(symbol);
    const m = Math.floor((this.clock.now() - SYNTH_EPOCH) / MIN);
    const mid = p[Math.max(0, Math.min(m, p.length - 1))];
    return { bid: mid * (1 - 0.00005), ask: mid * (1 + 0.00005) };
  }
}
