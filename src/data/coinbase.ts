import type { Book, Candle, MarketData } from '../types.ts';
import { INTERVAL_MS } from '../types.ts';
import { getJson } from './http.ts';
import type { FetchFn } from './http.ts';

const GRAN: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600 };
/** BTCUSDT -> BTC-USD (Coinbase quotes in USD; price levels differ from Binance USDT by a hair). */
export const toProduct = (s: string) => `${s.replace(/USDT$/, '')}-USD`;

export function parseCandles(rows: any[], interval: string): Candle[] {
  const ms = INTERVAL_MS[interval];
  // Coinbase row: [time(s), low, high, open, close, volume], newest first
  return rows.map((r) => ({ openTime: r[0] * 1000, low: Number(r[1]), high: Number(r[2]), open: Number(r[3]),
    close: Number(r[4]), volume: Number(r[5]), closeTime: r[0] * 1000 + ms - 1 })).sort((a, b) => a.openTime - b.openTime);
}

/** Alternative public data source (no key). Max 300 candles per request. */
export class CoinbaseData implements MarketData {
  readonly name = 'coinbase';
  host: string; fetchFn?: FetchFn; sleepFn?: (ms: number) => Promise<void>;
  constructor(host: string, o: { fetchFn?: FetchFn; sleepFn?: (ms: number) => Promise<void> } = {}) { this.host = host; this.fetchFn = o.fetchFn; this.sleepFn = o.sleepFn; }
  async getKlines(symbol: string, interval: string, startMs: number, endMs: number, limit: number): Promise<Candle[]> {
    const g = GRAN[interval]; if (!g) throw new Error(`coinbase: unsupported interval ${interval}`);
    const n = Math.min(limit, 300);
    const end = Math.min(endMs, startMs + n * g * 1000 - 1);
    const url = `${this.host}/products/${toProduct(symbol)}/candles?granularity=${g}&start=${new Date(startMs).toISOString()}&end=${new Date(end).toISOString()}`;
    return parseCandles(await getJson(url, { fetchFn: this.fetchFn, sleepFn: this.sleepFn }), interval);
  }
  async getBook(symbol: string): Promise<Book> {
    const r = await getJson(`${this.host}/products/${toProduct(symbol)}/ticker`, { fetchFn: this.fetchFn, sleepFn: this.sleepFn });
    const bid = Number(r.bid), ask = Number(r.ask);
    if (!(bid > 0 && ask >= bid)) throw new Error(`bad ticker for ${symbol}`);
    return { bid, ask };
  }
}
