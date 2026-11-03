import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBots } from '../src/bots.ts';
import { testCfg } from './helpers.ts';

test('default matrix: 366 unique bots, baselines present for every symbol x fee', () => {
  const p = buildBots(testCfg());
  assert.equal(p.bots.length, 366); assert.equal(p.capped, false);
  assert.equal(new Set(p.bots.map((b) => b.id)).size, 366);
  for (const s of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']) for (const f of ['default', 'indian'])
    assert.ok(p.bots.some((b) => b.strategy === 'buyAndHold' && b.symbol === s && b.fee === f));
  assert.ok(p.bots.filter((b) => b.strategy === 'random').length >= 18);
  assert.ok(p.bots.filter((b) => b.fee === 'indian').every((b) => b.interval === '1h'));
  assert.ok(p.bots.filter((b) => ['grid', 'dca', 'random', 'buyAndHold'].includes(b.strategy)).every((b) => b.sltp === 'none'));
});

test('cap keeps all baselines and samples the rest deterministically (not by performance)', () => {
  const a = buildBots(testCfg({ maxBots: 100 })), b = buildBots(testCfg({ maxBots: 100 }));
  assert.equal(a.bots.length, 100); assert.ok(a.capped);
  assert.deepEqual(a.bots.map((x) => x.id), b.bots.map((x) => x.id));
  assert.equal(a.bots.filter((x) => x.baseline).length, 30);
});
