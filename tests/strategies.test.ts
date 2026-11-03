import test from 'node:test';
import assert from 'node:assert/strict';
import { STRATEGIES, rnd01 } from '../src/strategies.ts';
import type { Candle } from '../src/types.ts';
import { candle } from './helpers.ts';

const H = 3_600_000;
const mk = (closes: number[]): Candle[] => closes.map((c, i) => candle(i * H, c, c * 1.001, c * 0.999, c));
const run = (name: string, closes: number[], p: Record<string, number>) => STRATEGIES[name].fn(mk(closes), { startTime: 0, intervalMs: H, refPrice: closes[0], ...p });

test('SMA cross: BUY only on the candle where fast crosses above slow, SELL on cross down', () => {
  const down = Array.from({ length: 30 }, (_, i) => 100 - i);
  const up = [...down, 71, 73, 76, 80, 85, 91, 98, 106];
  let firstBuy = -1;
  for (let n = 25; n <= up.length; n++) if (run('sma', up.slice(0, n), { fast: 3, slow: 8 }) === 'BUY') { firstBuy = n; break; }
  assert.ok(firstBuy > 0);
  assert.equal(run('sma', up.slice(0, firstBuy + 1), { fast: 3, slow: 8 }), 'HOLD'); // event, not a state
  const rev = [...up, 100, 90, 80, 70, 60, 50];
  assert.ok(Array.from({ length: 6 }, (_, k) => run('sma', rev.slice(0, up.length + k + 1), { fast: 3, slow: 8 })).includes('SELL'));
});

test('RSI mean reversion: oversold BUY, overbought SELL', () => {
  assert.equal(run('rsi', Array.from({ length: 40 }, (_, i) => 100 - i), { period: 14, lo: 30, hi: 70 }), 'BUY');
  assert.equal(run('rsi', Array.from({ length: 40 }, (_, i) => 100 + i), { period: 14, lo: 30, hi: 70 }), 'SELL');
});

test('Bollinger: close below lower band BUY; above middle SELL', () => {
  const flat = new Array(25).fill(100);
  assert.equal(run('bollinger', [...flat, 90], { period: 20, k: 2 }), 'BUY');
  assert.equal(run('bollinger', [...flat, 105], { period: 20, k: 2 }), 'SELL');
});

test('Donchian: close above prior N-bar high BUY; below exit-channel low SELL', () => {
  const base = Array.from({ length: 30 }, (_, i) => 100 + (i % 3));
  assert.equal(run('donchian', [...base, 120], { period: 20 }), 'BUY');
  assert.equal(run('donchian', [...base, 80], { period: 20 }), 'SELL');
  assert.equal(run('donchian', [...base, 101], { period: 20 }), 'HOLD');
});

test('MACD: ramp then reversal produces a SELL cross', () => {
  const s = [...Array.from({ length: 60 }, (_, i) => 100 + i), ...Array.from({ length: 20 }, (_, i) => 160 - i * 2)];
  const sigs = []; for (let n = 50; n <= s.length; n++) sigs.push(run('macd', s.slice(0, n), { fast: 12, slow: 26, signal: 9 }));
  assert.ok(sigs.includes('SELL'));
});

test('grid: crossing a line down => BUY, up => SELL, inside a cell => HOLD', () => {
  const p = { step: 0.02 };
  assert.equal(run('grid', [100, 100.5, 97.5], p), 'BUY');
  assert.equal(run('grid', [100, 100.5, 102.5], p), 'SELL');
  assert.equal(run('grid', [100, 100.5, 101], p), 'HOLD');
});

test('DCA: BUY exactly every N candles from the bot start, never SELL', () => {
  const sig = Array.from({ length: 25 }, (_, i) => run('dca', new Array(i + 1).fill(100), { every: 12 }));
  assert.deepEqual(sig.map((s, i) => (s === 'BUY' ? i : -1)).filter((i) => i >= 0), [0, 12, 24]);
  assert.ok(!sig.includes('SELL'));
});

test('random baseline: deterministic per (seed, time), differs across seeds, roughly the configured rate', () => {
  assert.equal(rnd01(11, 1234), rnd01(11, 1234));
  assert.notEqual(rnd01(11, 1234), rnd01(22, 1234));
  let buys = 0, sells = 0;
  for (let i = 0; i < 20000; i++) { const s = STRATEGIES.random.fn(mk([100]).map((c) => ({ ...c, openTime: i * 300000 })), { seed: 11, prob: 0.04 }); if (s === 'BUY') buys++; if (s === 'SELL') sells++; }
  assert.ok(Math.abs(buys / 20000 - 0.04) < 0.01 && Math.abs(sells / 20000 - 0.04) < 0.01);
});

test('buy&hold always says BUY (bot ignores it once invested)', () => assert.equal(run('buyAndHold', [1, 2, 3], {}), 'BUY'));
