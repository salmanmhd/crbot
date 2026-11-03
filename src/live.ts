import type { Candle, Clock, MarketData, Book } from './types.ts';
import { INTERVAL_MS } from './types.ts';
import type { Config } from './config.ts';
import { Bot } from './bot.ts';
import type { BotDef, FillCtx } from './bot.ts';
import { buildBots } from './bots.ts';
import { Store } from './db.ts';
import { quoteFromMid } from './portfolio.ts';

const key = (s: string, i: string) => `${s}|${i}`;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function seriesList(cfg: Config) {
  return cfg.symbols.flatMap((symbol) => cfg.intervals.map((interval) => ({ symbol, interval })));
}

/** Fetch every CLOSED candle after `cursor` (paging), strictly in order, deduplicated. */
export async function fetchClosedSince(md: MarketData, symbol: string, interval: string, cursor: number, now: number, endAt: number): Promise<Candle[]> {
  const ms = INTERVAL_MS[interval];
  let from = cursor + ms;
  const out = new Map<number, Candle>();
  for (let page = 0; page < 300 && from < Math.min(now, endAt); page++) {
    const rows = await md.getKlines(symbol, interval, from, now, 1000);
    if (!rows.length) break;
    for (const r of rows) if (r.openTime >= from && r.closeTime < now && r.closeTime <= endAt) out.set(r.openTime, r);
    const next = rows[rows.length - 1].openTime + ms;
    if (next <= from) break;
    from = next;
  }
  return [...out.values()].sort((a, b) => a.openTime - b.openTime);
}

/** Create the run: warm-up candles, cursors, bots. Refuses to overwrite an existing run. */
export async function initRun(store: Store, md: MarketData, clock: Clock, cfg: Config): Promise<{ bots: number }> {
  if (store.getRun()) throw new Error('run already initialised (delete the state dir, or pass --force, to start over)');
  const now = clock.now();
  const plan = buildBots(cfg);
  const books = new Map<string, Book>();
  for (const symbol of cfg.symbols) books.set(symbol, await md.getBook(symbol));
  const warm = new Map<string, Candle[]>();
  for (const { symbol, interval } of seriesList(cfg)) {
    const ms = INTERVAL_MS[interval];
    const rows = (await md.getKlines(symbol, interval, now - (cfg.warmupBars + 3) * ms, now, 1000)).filter((c) => c.closeTime < now);
    if (rows.length < cfg.warmupBars) throw new Error(`warm-up for ${symbol} ${interval}: got ${rows.length} candles, need ${cfg.warmupBars}`);
    warm.set(key(symbol, interval), rows.slice(-cfg.warmupBars));
  }
  store.tx(() => {
    for (const [k, rows] of warm) {
      const [symbol, interval] = k.split('|');
      for (const c of rows) store.insertCandle(symbol, interval, c, now);
      store.setCursor(symbol, interval, rows[rows.length - 1].openTime);
    }
    for (const [symbol, b] of books) store.setSpread(symbol, now, b.bid, b.ask);
    for (const def of plan.bots) {
      const b = books.get(def.symbol)!;
      const cur = warm.get(key(def.symbol, def.interval))!;
      const anchor = cur[cur.length - 1].openTime + INTERVAL_MS[def.interval];
      const bot = new Bot(def, cfg, undefined, { startTime: anchor, refPrice: (b.bid + b.ask) / 2 });
      if (def.strategy === 'buyAndHold') bot.enterNow({ bid: b.bid, ask: b.ask }, now);
      store.saveBot(def, bot.toState());
    }
    store.setRun({ startAt: now, endAt: now + cfg.runHours * 3_600_000, status: 'running', source: md.name, initialCash: cfg.initialCash, createdAt: now });
    store.setMeta('plan', JSON.stringify({ count: plan.bots.length, uncapped: plan.uncapped, capped: plan.capped }));
  });
  return { bots: plan.bots.length };
}

export interface TickResult { status: 'not_initialized' | 'finished' | 'ok'; processed: number; errors: number; justFinished: boolean }

/**
 * One catch-up tick. Safe to run late, twice, or after a crash: each (symbol, interval) has a cursor,
 * and candles + cursor + bot states + trades are committed in ONE transaction per series.
 */
export async function tick(store: Store, md: MarketData, clock: Clock, cfg: Config): Promise<TickResult> {
  const t0 = Date.now();
  const run = store.getRun();
  if (!run) return { status: 'not_initialized', processed: 0, errors: 0, justFinished: false };
  if (run.status === 'finished') return { status: 'finished', processed: 0, errors: 0, justFinished: false };
  const now = clock.now();
  const endAt = run.endAt;
  const finishing = now >= endAt;
  let errors = 0, processed = 0;
  const err = (scope: string, e: unknown) => { errors++; store.logError(now, scope, msg(e)); };

  const books = new Map<string, Book>();
  for (const symbol of cfg.symbols) {
    try { const b = await md.getBook(symbol); books.set(symbol, b); store.setSpread(symbol, now, b.bid, b.ask); }
    catch (e) { err(`book:${symbol}`, e); }
  }

  const bots = store.loadBots().map(({ def, state }) => new Bot(def, cfg, state));
  const bySeries = new Map<string, Bot[]>();
  for (const b of bots) { const k = key(b.def.symbol, b.def.interval); (bySeries.get(k) ?? bySeries.set(k, []).get(k)!).push(b); }

  for (const { symbol, interval } of seriesList(cfg)) {
    const ms = INTERVAL_MS[interval];
    try {
      const cursor = store.getCursor(symbol, interval);
      if (cursor === undefined) throw new Error('no cursor (corrupt state)');
      const fresh = await fetchClosedSince(md, symbol, interval, cursor, now, endAt);
      if (!fresh.length) continue;
      const seriesBots = bySeries.get(key(symbol, interval)) ?? [];
      const book = books.get(symbol);
      const obs = store.getSpread(symbol);
      const lastSpread = obs ? (obs.ask - obs.bid) / ((obs.ask + obs.bid) / 2) : cfg.modelSpreadPct;
      store.tx(() => {
        const window = store.lastCandles(symbol, interval, cfg.warmupBars, cursor);
        let expected = cursor + ms;
        for (const c of fresh) {
          if (c.openTime !== expected) {                                   // gaps are LOGGED, never silent
            const missing = Math.round((c.openTime - expected) / ms);
            store.logGap(symbol, interval, expected, missing, now);
            store.logError(now, `gap:${symbol}:${interval}`, `${missing} missing candle(s) from ${new Date(expected).toISOString()}`);
          }
          expected = c.openTime + ms;
          store.insertCandle(symbol, interval, c, now);
          window.push(c); if (window.length > cfg.warmupBars) window.shift();
          const onTime = book && !finishing && now - c.closeTime <= cfg.liveFillMaxLagSec * 1000;
          const fill: FillCtx = onTime
            ? { quote: { bid: book!.bid, ask: book!.ask }, spreadPct: (book!.ask - book!.bid) / ((book!.ask + book!.bid) / 2), source: 'book' }
            : { quote: quoteFromMid(c.close, lastSpread), spreadPct: lastSpread, source: 'model' };
          for (const bot of seriesBots) {
            const trades = bot.step(c, window, fill);
            if (trades.length) store.insertTrades(bot.def.id, trades);
          }
          processed++;
        }
        for (const bot of seriesBots) if (bot.dirty) { store.saveBot(bot.def, bot.toState()); bot.dirty = false; }
        store.setCursor(symbol, interval, fresh[fresh.length - 1].openTime);
      });
    } catch (e) { err(`series:${symbol}:${interval}`, e); }
  }

  // ---- equity sampling (marks: live mid; at the very end, the last close at/before endAt)
  const smallest = [...cfg.intervals].sort((a, b) => INTERVAL_MS[a] - INTERVAL_MS[b])[0];
  const lastTs = store.lastEquityTs();
  if (finishing || lastTs === 0 || now - lastTs >= cfg.equityEveryMin * 60_000) {
    const ts = finishing ? endAt : now;
    store.tx(() => {
      for (const bot of bots) {
        const sym = bot.def.symbol;
        const obs = store.getSpread(sym);
        const sp = obs ? (obs.ask - obs.bid) / ((obs.ask + obs.bid) / 2) : cfg.modelSpreadPct;
        let mid: number | undefined;
        const bk = books.get(sym);
        if (!finishing && bk) mid = (bk.ask + bk.bid) / 2;
        if (mid === undefined) mid = store.lastCandles(sym, smallest, 1)[0]?.close;
        if (mid === undefined) continue;
        const e = bot.equity(mid, sp);
        store.insertEquity(bot.def.id, ts, e.after, e.before);
      }
    });
  }
  const prevTick = store.health().lastTick as number | null;
  store.logTick(now, Date.now() - t0, processed, errors, prevTick ? now - prevTick : 0);
  let justFinished = false;
  if (finishing) {
    // only finish once every series has been processed up to the end
    const behind = seriesList(cfg).some(({ symbol, interval }) => {
      const ms = INTERVAL_MS[interval]; const c = store.getCursor(symbol, interval) ?? 0;
      return c + 2 * ms - 1 <= endAt;   // another candle closing <= endAt still pending
    });
    // (safety valve: if the exchange never serves a tail candle, stop waiting 2h after the deadline)
    const forced = behind && now > endAt + 2 * 3_600_000;
    if (forced) store.logError(now, 'finish', 'FORCED FINISH: some series were still missing their last candle(s) 2h after the deadline');
    if (!behind || forced) { store.setRun({ ...run, status: 'finished' }); justFinished = true; }
  }
  return { status: 'ok', processed, errors, justFinished };
}
