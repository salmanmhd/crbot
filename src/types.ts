export interface Candle {
  openTime: number; // ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number; // ms (openTime + interval - 1)
}
export type Signal = 'BUY' | 'SELL' | 'HOLD';
export interface Quote { bid: number; ask: number }
export const INTERVAL_MS: Record<string, number> = {
  '1m': 60_000, '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '4h': 14_400_000,
};
export interface Clock { now(): number }
export interface Book { bid: number; ask: number }
export interface MarketData {
  readonly name: string;
  /** Candles with openTime in [startMs, endMs], oldest first, at most `limit`. May include the still-open candle. */
  getKlines(symbol: string, interval: string, startMs: number, endMs: number, limit: number): Promise<Candle[]>;
  getBook(symbol: string): Promise<Book>;
}
