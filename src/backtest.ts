import type { Candle, Clock, MarketData } from './types.ts';
import { INTERVAL_MS } from './types.ts';
import type { Config } from './config.ts';
import { Bot } from './bot.ts';
import type { BotDef } from './bot.ts';
import { quoteFromMid } from './portfolio.ts';
import { seriesList } from './live.ts';
import { maxDrawdown, resampleHourly, rollingWindowStats, sharpeHourly, valueAt } from './metrics.ts';

const DAY = 86_400_000;
const k = (s: string, i: string) => `${s}|${i}`;

/** Fetch [from, to] closed candles for one series, paging 1000 at a time. */
export async function fetchRange(md: MarketData, symbol: string, interval: string, from: number, to: number): Promise<Candle[]> {
  const ms = INTERVAL_MS[interval];
  const out = new Map<number, Candle>();
  let cur = Math.ceil(from / ms) * ms;
  for (let page = 0; page < 2000 && cur < to; page++) {
    const rows = await md.getKlines(symbol, interval, cur, to, 1000);
    if (!rows.length) break;
    for (const r of rows) if (r.closeTime < to) out.set(r.openTime, r);
    const next = rows[rows.length - 1].openTime + ms;
    if (next <= cur) break;
    cur = next;
  }
  return [...out.values()].sort((a, b) => a.openTime - b.openTime);
}

export async function loadHistory(md: MarketData, cfg: Config, clock: Clock, days: number, log: (s: string) => void = () => {}) {
  const end = clock.now();
  const hist = new Map<string, Candle[]>();
  const gaps: { series: string; missing: number }[] = [];
  for (const { symbol, interval } of seriesList(cfg)) {
    const ms = INTERVAL_MS[interval];
    const c = await fetchRange(md, symbol, interval, end - days * DAY - (cfg.warmupBars + 2) * ms, end);
    let missing = 0;
    for (let i = 1; i < c.length; i++) missing += Math.round((c[i].openTime - c[i - 1].openTime) / ms) - 1;
    if (missing) gaps.push({ series: k(symbol, interval), missing });
    log(`  ${symbol} ${interval}: ${c.length} candles${missing ? `, ${missing} MISSING` : ''}`);
    hist.set(k(symbol, interval), c);
  }
  return { hist, end, gaps };
}

export interface BtRow {
  id: string; strategy: string; label: string; symbol: string; interval: string; fee: string; sltp: string; baseline: boolean;
  retAfter: number; retBefore: number; bhAfter: number; vsBH: number;
  trades: number; winRate: number | null; avgWin: number | null; avgLoss: number | null; profitFactor: number | null;
  maxDD: number; sharpe: number; fees: number; slippage: number; tax: number; tdsLocked: number;
  seg1: { after: number; before: number; vsBH: number }; seg2: { after: number; before: number; vsBH: number };
  overfit: boolean;
  w48: { n: number; mean: number; std: number; p10: number; p90: number };
  curve: [number, number][];
}
export interface BtResult {
  generatedAt: number; source: string; days: number; splitDay: number; evalStart: number; evalEnd: number;
  gaps: { series: string; missing: number }[]; rows: BtRow[];
}

const num = (x: number) => (Number.isFinite(x) ? x : 0);

export function runBacktest(hist: Map<string, Candle[]>, end: number, cfg: Config, defs: BotDef[], source: string, days = cfg.backtestDays, gaps: BtResult['gaps'] = []): BtResult {
  const evalStart = end - days * DAY;
  const splitDay = days >= 90 ? cfg.splitDay : Math.max(1, Math.round((days * 2) / 3)); // short test runs keep the 2/3 : 1/3 shape
  const splitAt = evalStart + splitDay * DAY;
  const init = cfg.initialCash;
  const raw = new Map<string, { bot: Bot; ts: number[]; after: number[]; before: number[] }>();
  const bySeries = new Map<string, BotDef[]>();
  for (const d of defs) (bySeries.get(k(d.symbol, d.interval)) ?? bySeries.set(k(d.symbol, d.interval), []).get(k(d.symbol, d.interval))!).push(d);

  for (const [key, ds] of bySeries) {
    const C = hist.get(key);
    if (!C) throw new Error(`no history for ${key}`);
    const i0 = C.findIndex((c) => c.openTime >= evalStart);
    if (i0 < 1) throw new Error(`not enough history for ${key}`);
    const bots = ds.map((d) => {
      const bot = new Bot(d, cfg, undefined, { startTime: C[i0].openTime, refPrice: C[i0 - 1].close });
      if (d.strategy === 'buyAndHold') bot.enterNow(quoteFromMid(C[i0].open, cfg.modelSpreadPct), C[i0].openTime);
      raw.set(d.id, { bot, ts: [], after: [], before: [] });
      return bot;
    });
    for (let i = i0; i < C.length; i++) {
      const c = C[i];
      const window = C.slice(Math.max(0, i - cfg.warmupBars + 1), i + 1);
      const fill = { quote: quoteFromMid(c.close, cfg.modelSpreadPct), spreadPct: cfg.modelSpreadPct, source: 'model' as const };
      for (const bot of bots) {
        bot.step(c, window, fill);
        const e = bot.equity(c.close, cfg.modelSpreadPct), r = raw.get(bot.def.id)!;
        r.ts.push(c.closeTime); r.after.push(e.after); r.before.push(e.before);
      }
    }
  }

  const bh = new Map<string, number[]>(); // symbol|fee -> [full, seg1, seg2] after-tax returns of buy & hold
  const segs = (r: { ts: number[]; after: number[]; before: number[] }, arr: 'after' | 'before') => {
    const a = valueAt(r.ts, r[arr], evalStart, init), b = valueAt(r.ts, r[arr], splitAt, init), c = valueAt(r.ts, r[arr], end, init);
    return [c / init - 1, b / a - 1, c / b - 1];
  };
  for (const [id, r] of raw) if (r.bot.def.strategy === 'buyAndHold') bh.set(`${r.bot.def.symbol}|${r.bot.def.fee}`, segs(r, 'after'));

  const rows: BtRow[] = [];
  for (const [, r] of raw) {
    const d = r.bot.def, p = r.bot.taxed.s;
    const a = segs(r, 'after'), b = segs(r, 'before');
    const ref = bh.get(`${d.symbol}|${d.fee}`) ?? [0, 0, 0];
    const hourly = resampleHourly(r.ts, r.after, evalStart, end, init);
    const st = p.stats;
    const curve: [number, number][] = [];
    for (let t = evalStart; t <= end; t += 12 * 3_600_000) curve.push([t, Math.round(valueAt(r.ts, r.after, t, init) * 100) / 100]);
    rows.push({
      id: d.id, strategy: d.strategy, label: d.label, symbol: d.symbol, interval: d.interval, fee: d.fee, sltp: d.sltp, baseline: d.baseline,
      retAfter: a[0], retBefore: b[0], bhAfter: ref[0], vsBH: a[0] - ref[0],
      trades: st.n, winRate: st.n ? st.wins / st.n : null,
      avgWin: st.wins ? st.sumWin / st.wins : null, avgLoss: st.losses ? st.sumLoss / st.losses : null,
      profitFactor: st.sumLoss < 0 ? st.sumWin / -st.sumLoss : null,
      maxDD: maxDrawdown(hourly), sharpe: num(sharpeHourly(hourly)),
      fees: p.totals.fees, slippage: p.totals.slippage, tax: p.totals.tax, tdsLocked: p.tdsLocked,
      seg1: { after: a[1], before: b[1], vsBH: a[1] - ref[1] }, seg2: { after: a[2], before: b[2], vsBH: a[2] - ref[2] },
      overfit: false, w48: rollingWindowStats(hourly, cfg.runHours), curve,
    });
  }
  // overfitting flag: top 30% of (non-baseline) bots on days 1-60 but bottom 30% on days 61-90
  const real = rows.filter((x) => !x.baseline);
  const pct = (sel: (x: BtRow) => number) => {
    const sorted = [...real].sort((x, y) => sel(x) - sel(y)); const m = new Map<string, number>();
    sorted.forEach((x, i) => m.set(x.id, real.length > 1 ? i / (real.length - 1) : 0.5)); return m;
  };
  const p1 = pct((x) => x.seg1.after), p2 = pct((x) => x.seg2.after);
  for (const x of real) x.overfit = (p1.get(x.id) ?? 0) >= cfg.overfitHighPct && (p2.get(x.id) ?? 1) <= cfg.overfitLowPct;
  return { generatedAt: end, source, days, splitDay, evalStart, evalEnd: end, gaps, rows };
}

export function backtestMarkdown(r: BtResult): string {
  const pc = (x: number) => `${(x * 100).toFixed(2)}%`;
  const real = r.rows.filter((x) => !x.baseline);
  const sorted = [...r.rows].sort((a, b) => b.retAfter - a.retAfter);
  const L: string[] = [];
  L.push(`# Backtest — ${r.days} days (${r.source})`, '',
    `Window ${new Date(r.evalStart).toISOString()} → ${new Date(r.evalEnd).toISOString()}. Days 1–${r.splitDay} vs ${r.splitDay + 1}–${r.days} reported separately; **no parameter was tuned on the last ${r.days - r.splitDay} days** (all params are fixed up-front in \`src/strategies.ts\`).`, '');
  if (r.gaps.length) L.push(`⚠️ Missing candles: ${r.gaps.map((g) => `${g.series}=${g.missing}`).join(', ')}`, '');
  L.push(`Bots: ${r.rows.length}. Beat buy-and-hold (after tax): ${real.filter((x) => x.vsBH > 0).length}/${real.length}. Flagged as likely overfit: ${real.filter((x) => x.overfit).length}.`, '',
    '## Top 10 / Bottom 10 by after-tax return', '', '| # | bot | after tax | before tax | vs B&H | days 1–60 | days 61–90 | trades | maxDD | overfit |', '|---|---|---|---|---|---|---|---|---|---|');
  const row = (x: BtRow, i: number) => `| ${i + 1} | ${x.id} | ${pc(x.retAfter)} | ${pc(x.retBefore)} | ${pc(x.vsBH)} | ${pc(x.seg1.after)} | ${pc(x.seg2.after)} | ${x.trades} | ${pc(x.maxDD)} | ${x.overfit ? '⚠️' : ''} |`;
  sorted.slice(0, 10).forEach((x, i) => L.push(row(x, i)));
  L.push('| … | | | | | | | | | |');
  sorted.slice(-10).forEach((x, i) => L.push(row(x, sorted.length - 10 + i)));
  return L.join('\n') + '\n';
}
