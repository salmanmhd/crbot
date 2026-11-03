import test from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, bollinger, macd, donchianHigh, donchianLow } from '../src/indicators.ts';

const close = (a: number, b: number, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

test('SMA known values', () => {
  const s = sma([1, 2, 3, 4, 5, 6], 3);
  assert.ok(Number.isNaN(s[0]) && Number.isNaN(s[1]));
  assert.deepEqual(s.slice(2), [2, 3, 4, 5]);
});

test('EMA: StockCharts 10-period example (SMA seed 22.221, then 22.2081, 22.2412)', () => {
  const p = [22.27, 22.19, 22.08, 22.17, 22.18, 22.13, 22.23, 22.43, 22.24, 22.29, 22.15, 22.39];
  const e = ema(p, 10);
  close(e[9], 22.221);
  close(e[10], 22.2081, 5e-4);
  close(e[11], 22.2412, 5e-4);
});

test('RSI: Wilder smoothing, hand-computed from the classic 14-period example data (2-dp prices)', () => {
  const p = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
  const r = rsi(p, 14);
  assert.ok(Number.isNaN(r[13]));
  // first 14 changes: gains 0.06+0.72+0.50+0.27+0.32+0.42+0.24+0.14+0.67 = 3.34, losses 0.25+0.54+0.19+0.42 = 1.40
  const g0 = 3.34 / 14, l0 = 1.4 / 14;
  close(r[14], 100 - 100 / (1 + g0 / l0));        // 70.464 (textbook shows 70.53 using unrounded 4-dp prices)
  close(r[14], 70.464, 0.01);
  // next change is -0.28 => Wilder smoothing
  const g1 = (g0 * 13) / 14, l1 = (l0 * 13 + 0.28) / 14;
  close(r[15], 100 - 100 / (1 + g1 / l1));
});

test('RSI extremes: monotone up = 100, monotone down = 0, flat = 50', () => {
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => i + 1), 14).at(-1), 100);
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => 100 - i), 14).at(-1), 0);
  assert.equal(rsi(new Array(30).fill(5), 14).at(-1), 50);
});

test('Bollinger: [1..5], n=5, k=2 => mid 3, population sd sqrt(2)', () => {
  const b = bollinger([1, 2, 3, 4, 5], 5, 2);
  close(b.mid[4], 3);
  close(b.upper[4], 3 + 2 * Math.SQRT2);
  close(b.lower[4], 3 - 2 * Math.SQRT2);
});

test('MACD: constant series => 0; linear ramp converges to (26-1)/2-(12-1)/2 = 7', () => {
  const flat = macd(new Array(120).fill(10), 12, 26, 9);
  close(flat.line.at(-1)!, 0); close(flat.hist.at(-1)!, 0);
  const ramp = macd(Array.from({ length: 400 }, (_, i) => i), 12, 26, 9);
  close(ramp.line.at(-1)!, 7, 1e-3);
  close(ramp.signal.at(-1)!, 7, 1e-3);
  close(ramp.hist.at(-1)!, 0, 1e-3);
});

test('Donchian uses the PREVIOUS n bars (current bar excluded)', () => {
  const h = [1, 5, 3, 4, 2, 9];
  const hi = donchianHigh(h, 3);
  assert.ok(Number.isNaN(hi[2]));
  assert.equal(hi[3], 5); assert.equal(hi[5], 4);
  const lo = donchianLow([5, 3, 4, 2, 6, 1], 3);
  assert.equal(lo[3], 3); assert.equal(lo[5], 2);
});
