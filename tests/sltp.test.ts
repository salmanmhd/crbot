import test from 'node:test';
import assert from 'node:assert/strict';
import { Bot } from '../src/bot.ts';
import type { BotDef, FillCtx } from '../src/bot.ts';
import { quoteFromMid } from '../src/portfolio.ts';
import { candle, near, testCfg } from './helpers.ts';

const cfg = testCfg();
const def = (sl: number | null, tp: number | null): BotDef => ({ id: 't', strategy: 'sma', label: '9-21', params: { fast: 9, slow: 21 }, symbol: 'BTCUSDT', interval: '1h',
  fee: 'default', feePct: 0.001, sltp: 'x', sl, tp, baseline: false });
const fill: FillCtx = { quote: quoteFromMid(100, 0), spreadPct: 0, source: 'model' };
const T = 3_600_000;
function held(sl: number | null, tp: number | null) {
  const b = new Bot(def(sl, tp), cfg, undefined, { startTime: 0, refPrice: 100 });
  for (const L of [b.taxed, b.untaxed]) L.buy(L.s.cash, quoteFromMid(100, 0), 0);
  return b;
}
const entry = 100 * (1 + cfg.extraSlippagePct);
const slip = (x: number) => x * (1 - cfg.extraSlippagePct);

test('no touch => position kept', () => {
  const b = held(0.02, 0.04), c = candle(T, 100, 103, 99, 101);
  assert.equal(b.step(c, [c], fill).length, 0); assert.ok(b.taxed.hasPosition);
});
test('low touches stop => exit at the stop level (market: slippage applies)', () => {
  const b = held(0.02, 0.04), c = candle(T, 100, 101, 97, 98);
  const [t] = b.step(c, [c], fill);
  assert.equal(t.reason, 'sl'); assert.ok(near(t.exitPrice, slip(entry * 0.98))); assert.equal(b.taxed.hasPosition, false);
});
test('high touches target => exit at the target as a limit (no slippage)', () => {
  const b = held(0.02, 0.04), c = candle(T, 100, 106, 99.5, 105);
  const [t] = b.step(c, [c], fill);
  assert.equal(t.reason, 'tp'); assert.ok(near(t.exitPrice, entry * 1.04)); assert.ok(t.tax > 0);
});
test('BOTH touched in the same candle => stop wins (pessimistic)', () => {
  const b = held(0.02, 0.04), c = candle(T, 100, 110, 90, 100);
  const [t] = b.step(c, [c], fill);
  assert.equal(t.reason, 'sl');
});
test('gap down through the stop => filled at the open, not the stop', () => {
  const b = held(0.02, 0.04), c = candle(T, 90, 91, 89, 90);
  const [t] = b.step(c, [c], fill);
  assert.ok(near(t.exitPrice, slip(90)));
});
test('gap up through the target => limit filled at the (better) open', () => {
  const b = held(0.02, 0.04), c = candle(T, 108, 109, 107, 108);
  const [t] = b.step(c, [c], fill);
  assert.ok(near(t.exitPrice, 108));
});
test('no SL/TP configured => never exits intrabar', () => {
  const b = held(null, null), c = candle(T, 100, 200, 1, 100);
  assert.equal(b.step(c, [c], fill).length, 0);
});
