import type { Clock, MarketData } from './types.ts';
import type { Config } from './config.ts';
import { BinanceData } from './data/binance.ts';
import { CoinbaseData } from './data/coinbase.ts';
import { SyntheticData } from './data/synthetic.ts';

export const systemClock: Clock = { now: () => Date.now() };
export class FakeClock implements Clock {
  t: number;
  constructor(t: number) { this.t = t; }
  now() { return this.t; }
}
export function makeProvider(cfg: Config, synthetic: boolean, clock: Clock): MarketData {
  if (synthetic) return new SyntheticData(clock);
  if (cfg.provider === 'coinbase') return new CoinbaseData(cfg.coinbaseHost);
  return new BinanceData(cfg.binanceHosts, { retries: cfg.httpRetries, timeoutMs: cfg.httpTimeoutMs });
}
