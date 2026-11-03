import { loadConfig } from '../src/config.ts';
import type { Config } from '../src/config.ts';
import type { Candle } from '../src/types.ts';

export function testCfg(over: Partial<Config> = {}): Config {
  return { ...loadConfig({}), ...over };
}
export function candle(openTime: number, o: number, h: number, l: number, c: number, ms = 3_600_000): Candle {
  return { openTime, open: o, high: h, low: l, close: c, volume: 1, closeTime: openTime + ms - 1 };
}
export const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
