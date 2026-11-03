import type { Book, Candle, MarketData } from '../types.ts';
import { getJson } from './http.ts';
import type { FetchFn } from './http.ts';

export function parseKlines(rows: any[]): Candle[] {
  return rows.map((r) => ({
    openTime: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]),
    close: Number(r[4]), volume: Number(r[5]), closeTime: Number(r[6]),
  }));
}

/** Binance public REST. Tries each host in order (api.binance.com, then data-api.binance.vision). */
export class BinanceData implements MarketData {
  readonly name = 'binance';
  hosts: string[]; fetchFn?: FetchFn; sleepFn?: (ms: number) => Promise<void>; retries: number; timeoutMs: number;
  constructor(hosts: string[], o: { fetchFn?: FetchFn; sleepFn?: (ms: number) => Promise<void>; retries?: number; timeoutMs?: number } = {}) {
    this.hosts = hosts; this.fetchFn = o.fetchFn; this.sleepFn = o.sleepFn; this.retries = o.retries ?? 4; this.timeoutMs = o.timeoutMs ?? 15_000;
  }
  private async get(path: string): Promise<any> {
    let last: unknown;
    for (const h of this.hosts) {
      try { return await getJson(h + path, { fetchFn: this.fetchFn, sleepFn: this.sleepFn, retries: this.retries, timeoutMs: this.timeoutMs }); }
      catch (e) { last = e; }
    }
    throw last instanceof Error ? last : new Error(String(last));
  }
  async getKlines(symbol: string, interval: string, startMs: number, endMs: number, limit: number): Promise<Candle[]> {
    const rows = await this.get(`/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startMs}&endTime=${endMs}&limit=${Math.min(limit, 1000)}`);
    return parseKlines(rows);
  }
  async getBook(symbol: string): Promise<Book> {
    const r = await this.get(`/api/v3/ticker/bookTicker?symbol=${symbol}`);
    const bid = Number(r.bidPrice), ask = Number(r.askPrice);
    if (!(bid > 0 && ask >= bid)) throw new Error(`bad bookTicker for ${symbol}: ${JSON.stringify(r)}`);
    return { bid, ask };
  }
}
