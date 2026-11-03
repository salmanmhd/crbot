import test from 'node:test';
import assert from 'node:assert/strict';
import { BinanceData, parseKlines } from '../src/data/binance.ts';
import { parseCandles, toProduct } from '../src/data/coinbase.ts';
import { getJson } from '../src/data/http.ts';
import { fetchClosedSince } from '../src/live.ts';
import { SyntheticData } from '../src/data/synthetic.ts';
import { FakeClock } from '../src/runtime.ts';
import type { MarketData } from '../src/types.ts';

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const nosleep = async () => {};

test('binance klines parsing', () => {
  const [c] = parseKlines([[1700000000000, '1.5', '2', '1', '1.8', '10', 1700000299999, 'x']]);
  assert.deepEqual(c, { openTime: 1700000000000, open: 1.5, high: 2, low: 1, close: 1.8, volume: 10, closeTime: 1700000299999 });
});

test('geo-block (451) on api.binance.com falls back to data-api.binance.vision', async () => {
  const seen: string[] = [];
  const f = (async (u: string) => { seen.push(u); return u.includes('api.binance.com') ? res(451, 'restricted') : res(200, { bidPrice: '99', askPrice: '101' }); }) as any;
  const b = new BinanceData(['https://api.binance.com', 'https://data-api.binance.vision'], { fetchFn: f, sleepFn: nosleep });
  assert.deepEqual(await b.getBook('BTCUSDT'), { bid: 99, ask: 101 });
  assert.equal(seen.length, 2); assert.ok(seen[1].startsWith('https://data-api.binance.vision'));
});

test('429 is retried honoring Retry-After; 5xx retried with backoff; persistent failure throws', async () => {
  let n = 0; const naps: number[] = [];
  const f = (async () => (++n === 1 ? res(429, 'slow down', { 'retry-after': '3' }) : n === 2 ? res(503, 'x') : res(200, { ok: 1 }))) as any;
  assert.deepEqual(await getJson('http://x', { fetchFn: f, sleepFn: async (ms) => { naps.push(ms); } }), { ok: 1 });
  assert.equal(naps[0], 3000); assert.ok(naps[1] >= 500);
  const always = (async () => res(500, 'x')) as any;
  await assert.rejects(() => getJson('http://x', { fetchFn: always, sleepFn: nosleep, retries: 2 }), /HTTP 500/);
});

test('bad bookTicker payload is rejected (crossed / zero)', async () => {
  const f = (async () => res(200, { bidPrice: '0', askPrice: '0' })) as any;
  await assert.rejects(() => new BinanceData(['https://h'], { fetchFn: f, sleepFn: nosleep, retries: 0 }).getBook('X'), /bad bookTicker/);
});

test('coinbase candles: sorted oldest-first, product mapping', () => {
  const c = parseCandles([[1700000300, 1, 3, 2, 2.5, 9], [1700000000, 0.5, 2, 1, 1.5, 8]], '5m');
  assert.equal(c[0].openTime, 1700000000000); assert.equal(c[0].open, 1); assert.equal(c[0].low, 0.5); assert.equal(c[1].closeTime, 1700000300000 + 299999);
  assert.equal(toProduct('SOLUSDT'), 'SOL-USD');
});

test('fetchClosedSince: pages through limited responses, drops the still-open candle, keeps order, no duplicates', async () => {
  const START = Date.UTC(2026, 5, 1), clock = new FakeClock(START + 10 * 3_600_000 + 123_456);
  const base = new SyntheticData(clock);
  const paged: MarketData = { name: 'paged', getBook: (s) => base.getBook(s), getKlines: (s, i, a, z) => base.getKlines(s, i, a, z, 50) }; // server caps at 50
  const out = await fetchClosedSince(paged, 'BTCUSDT', '5m', START - 300_000, clock.now(), Infinity);
  // candles whose close is strictly before `now`: opens at START-0 ... 10h of 5m candles = 120 closed + the 9 min-fraction not yet closed
  assert.equal(out.length, 120);
  assert.equal(out[0].openTime, START);
  for (let i = 1; i < out.length; i++) assert.equal(out[i].openTime - out[i - 1].openTime, 300_000);
  assert.ok(out.every((c) => c.closeTime < clock.now()));
  assert.equal(new Set(out.map((c) => c.openTime)).size, out.length);
});

test('synthetic market is deterministic and internally consistent across intervals', async () => {
  const clock = new FakeClock(Date.UTC(2026, 5, 1)), m = new SyntheticData(clock);
  const t = Date.UTC(2026, 4, 20);
  const h = (await m.getKlines('ETHUSDT', '1h', t, t, 1))[0];
  const f = await m.getKlines('ETHUSDT', '5m', t, t + 3_600_000 - 1, 12);
  assert.equal(f.length, 12);
  assert.equal(h.open, f[0].open); assert.equal(h.close, f[11].close);
  assert.equal(h.high, Math.max(...f.map((x) => x.high))); assert.equal(h.low, Math.min(...f.map((x) => x.low)));
  assert.deepEqual(await m.getKlines('ETHUSDT', '1h', t, t, 1), [h]);
  assert.ok(h.high >= Math.max(h.open, h.close) && h.low <= Math.min(h.open, h.close));
});
