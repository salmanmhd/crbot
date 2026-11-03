import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simulate } from '../src/sim.ts';
import { initRun, tick } from '../src/live.ts';
import { Store } from '../src/db.ts';
import { FakeClock, makeProvider } from '../src/runtime.ts';
import { buildLeaderboard } from '../src/report.ts';
import type { MarketData, Candle } from '../src/types.ts';
import { INTERVAL_MS } from '../src/types.ts';
import { rnd01 } from '../src/strategies.ts';
import { testCfg } from './helpers.ts';

const START = Date.UTC(2026, 5, 1);
// All fills modelled (lag limit 0) so results do not depend on WHEN a tick happened -> exact equality is testable.
const cfg = () => testCfg({ symbols: ['BTCUSDT', 'ETHUSDT'], runHours: 12, liveFillMaxLagSec: 0, equityEveryMin: 15 });
const tmp = () => mkdtempSync(join(tmpdir(), 'paperlab-'));

/** Deep equality where numbers match to 1e-9 relative (the modelled spread is read from the book at tick time, so float noise ~1e-13 is expected). */
function approx(a: unknown, b: unknown, path = '$'): void {
  if (typeof a === 'number' && typeof b === 'number') { assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)), `${path}: ${a} vs ${b}`); return; }
  if (typeof a === 'string' && typeof b === 'string' && a.startsWith('{') && b.startsWith('{')) return approx(JSON.parse(a), JSON.parse(b), path);
  if (Array.isArray(a) && Array.isArray(b)) { assert.equal(a.length, b.length, `${path}: length`); a.forEach((x, i) => approx(x, b[i], `${path}[${i}]`)); return; }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${path}: keys`);
    for (const k of Object.keys(a)) approx((a as any)[k], (b as any)[k], `${path}.${k}`); return;
  }
  assert.equal(a, b, path);
}

function fingerprint(s: Store) {
  return {
    bots: s.db.prepare('SELECT id, state_json FROM bots ORDER BY id').all(),
    trades: s.db.prepare('SELECT bot_id, open_time, close_time, qty, entry_price, exit_price, net_pnl, tax, reason FROM trades ORDER BY bot_id, close_time, open_time, qty').all(),
    candles: s.db.prepare('SELECT symbol, interval, COUNT(*) n, MIN(open_time) a, MAX(open_time) b FROM candles GROUP BY symbol, interval ORDER BY 1,2').all(),
    cursors: s.db.prepare('SELECT * FROM cursors ORDER BY 1,2').all(),
  };
}

test('resume: late ticks + 70min outages + DB restarts give the SAME result as a perfectly punctual run', async () => {
  const a = tmp(), b = tmp();
  try {
    const ref = await simulate({ out: a, cfg: cfg(), start: START, tickMin: 5, jitterMin: 0 });
    const rough = await simulate({ out: b, cfg: cfg(), start: START, tickMin: 5, jitterMin: 9, outageEvery: 11, outageMin: 70, restartEvery: 3 });
    assert.equal(ref.store.getRun()!.status, 'finished'); assert.equal(rough.store.getRun()!.status, 'finished');
    const fa = fingerprint(ref.store), fb = fingerprint(rough.store);
    assert.deepEqual(fb.candles, fa.candles);
    assert.deepEqual(fb.cursors, fa.cursors);
    approx(fb.bots, fa.bots);
    approx(fb.trades, fa.trades);
    assert.ok(fa.trades.length > 0, 'the scenario must actually trade');
    // no duplicate candles / trades
    const dup = rough.store.db.prepare('SELECT COUNT(*) n FROM (SELECT bot_id, open_time, close_time, qty, COUNT(*) c FROM trades GROUP BY 1,2,3,4 HAVING c>1)').get() as any;
    assert.equal(dup.n, 0);
    // exactly the expected number of candles: 12h window + 300 warm-up
    for (const row of fb.candles as any[]) {
      const ms = INTERVAL_MS[row.interval];
      assert.equal(row.n, 300 + Math.floor((12 * 3_600_000) / ms), `${row.symbol} ${row.interval}`);
    }
    assert.equal(rough.store.health().missedCandles, 0);
    ref.store.close(); rough.store.close();
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

test('idempotent: ticking twice at the same instant, or re-ticking an old clock, never double-processes', async () => {
  const dir = tmp();
  try {
    const clock = new FakeClock(START), c = cfg(), md = makeProvider(c, true, clock);
    const store = new Store(join(dir, 'p.db'));
    await initRun(store, md, clock, c);
    clock.t = START + 2 * 3_600_000;
    const r1 = await tick(store, md, clock, c), snap = JSON.stringify(fingerprint(store));
    assert.ok(r1.processed > 0);
    const r2 = await tick(store, md, clock, c);
    assert.equal(r2.processed, 0); assert.equal(JSON.stringify(fingerprint(store)), snap);
    clock.t = START + 3_600_000;                       // clock going backwards must not reprocess either
    assert.equal((await tick(store, md, clock, c)).processed, 0);
    // second init is refused
    await assert.rejects(() => initRun(store, md, clock, c), /already initialised/);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('flaky exchange (~1/3 of requests fail randomly): errors are logged, nothing is lost or duplicated', async () => {
  const a = tmp(), b = tmp();
  try {
    const ref = await simulate({ out: a, cfg: cfg(), start: START, tickMin: 5 });
    let calls = 0;
    const fails = () => ++calls > 40 && rnd01(77, calls) < 1 / 3;   // seeded random ~33% failure rate after init
    const flaky = (md: MarketData): MarketData => ({
      name: md.name,
      getKlines: async (...args) => { if (fails()) throw new Error('boom'); return md.getKlines(...args); },
      getBook: async (s) => { if (fails()) throw new Error('boom'); return md.getBook(s); },
    });
    const bad = await simulate({ out: b, cfg: cfg(), start: START, tickMin: 5, wrapProvider: flaky });
    assert.ok(bad.store.health().errorCount > 5);
    approx(fingerprint(bad.store).bots, fingerprint(ref.store).bots);
    approx(fingerprint(bad.store).trades, fingerprint(ref.store).trades);
    assert.deepEqual(fingerprint(bad.store).candles, fingerprint(ref.store).candles);
    ref.store.close(); bad.store.close();
  } finally { rmSync(a, { recursive: true, force: true }); rmSync(b, { recursive: true, force: true }); }
});

test('missing candle: detected, logged as a gap, processing continues past it', async () => {
  const dir = tmp();
  try {
    const dropAt = START + 3 * 3_600_000 + 10 * 300_000;     // one 5m candle on BTCUSDT
    const dropper = (md: MarketData): MarketData => ({
      name: md.name, getBook: (s) => md.getBook(s),
      getKlines: async (s, i, a, z, l) => (await md.getKlines(s, i, a, z, l)).filter((c: Candle) => !(s === 'BTCUSDT' && i === '5m' && c.openTime === dropAt)),
    });
    const sim = await simulate({ out: dir, cfg: cfg(), start: START, tickMin: 5, wrapProvider: dropper });
    const h = sim.store.health();
    assert.equal(h.missedCandles, 1);
    assert.equal(h.gaps[0].symbol, 'BTCUSDT'); assert.equal(h.gaps[0].interval, '5m'); assert.equal(h.gaps[0].fromOpen, dropAt);
    assert.equal(sim.store.candleCount('BTCUSDT', '5m'), 300 + 144 - 1);
    assert.equal(sim.store.getRun()!.status, 'finished');
    sim.store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('run ends at exactly 48h-config: no candle after endAt is processed, leaderboard is built and ranks are consistent', async () => {
  const dir = tmp();
  try {
    const sim = await simulate({ out: dir, cfg: cfg(), start: START, tickMin: 5, jitterMin: 3 });
    const run = sim.store.getRun()!;
    const last = sim.store.db.prepare('SELECT MAX(close_time) m FROM candles').get() as any;
    assert.ok(last.m <= run.endAt);
    const lb = buildLeaderboard(sim.store, cfg(), run.endAt);
    assert.equal(lb.rows.length, sim.store.loadBots().length);
    assert.deepEqual(lb.rows.map((r) => r.rankAfter), lb.rows.map((_, i) => i + 1));
    const bh = lb.rows.find((r) => r.strategy === 'buyAndHold' && r.symbol === 'BTCUSDT' && r.fee === 'default')!;
    assert.ok(Math.abs(bh.vsBH) < 1e-12);
    sim.store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
