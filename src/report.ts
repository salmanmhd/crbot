import { mkdirSync, writeFileSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Config } from './config.ts';
import { Store } from './db.ts';
import { Bot } from './bot.ts';
import { maxDrawdown, mean, median, resampleHourly, sharpeHourly, spearman, std } from './metrics.ts';
import type { BtResult } from './backtest.ts';

export interface LeaderRow {
  id: string; strategy: string; label: string; symbol: string; interval: string; fee: string; sltp: string; baseline: boolean;
  retAfter: number; retBefore: number; bhAfter: number; vsBH: number; randomRef: number | null; vsRandom: number | null;
  trades: number; winRate: number | null; avgWin: number | null; avgLoss: number | null; profitFactor: number | null;
  maxDD: number; sharpe: number; fees: number; slippage: number; tax: number; tdsLocked: number;
  equityAfter: number; equityBefore: number; open: boolean; rankAfter: number; rankBefore: number;
  cash: number;                                   // tradable cash (after-tax ledger; excludes locked TDS)
  pos: { qty: number; avgEntry: number; mark: number; value: number; unrealized: number; since: number } | null;
  lots: [number, number, number][];               // open lots: [openTime, qty, entryPrice]
}
export interface Leaderboard {
  generatedAt: number;
  run: { startAt: number; endAt: number; status: string; source: string; elapsedH: number; initialCash: number };
  plan: any; rows: LeaderRow[];
}

export function buildLeaderboard(store: Store, cfg: Config, now: number): Leaderboard {
  const run = store.getRun();
  if (!run) throw new Error('no run');
  const finished = run.status === 'finished';
  const t1 = finished ? run.endAt : now;
  const init = run.initialCash;
  const raw = store.loadBots().map(({ def, state }) => {
    const bot = new Bot(def, cfg, state);
    const curve = store.equityCurve(def.id);
    const spk = store.getSpread(def.symbol);
    const mark = spk ? (spk.bid + spk.ask) / 2 : bot.refPrice;
    let after: number, before: number;
    if (finished && curve.length) { const l = curve[curve.length - 1]; after = l.after; before = l.before; }
    else {
      const sp = store.getSpread(def.symbol);
      const mid = sp ? (sp.bid + sp.ask) / 2 : bot.refPrice;
      const e = bot.equity(mid, sp ? (sp.ask - sp.bid) / mid : cfg.modelSpreadPct);
      after = e.after; before = e.before;
    }
    const ts = curve.map((c) => c.ts), eq = curve.map((c) => c.after);
    ts.push(t1); eq.push(after);
    const hourly = resampleHourly(ts, eq, run.startAt, t1, init);
    return { def, bot, after, before, hourly, mark };
  });
  const bh = new Map<string, number>();
  for (const r of raw) if (r.def.strategy === 'buyAndHold') bh.set(`${r.def.symbol}|${r.def.fee}`, r.after / init - 1);
  const rnd = new Map<string, number[]>();
  for (const r of raw) if (r.def.strategy === 'random') { const k = `${r.def.symbol}|${r.def.interval}|${r.def.fee}`; (rnd.get(k) ?? rnd.set(k, []).get(k)!).push(r.after / init - 1); }

  const rows: LeaderRow[] = raw.map(({ def, bot, after, before, hourly, mark }) => {
    const st = bot.taxed.s.stats, tot = bot.taxed.s.totals;
    const ra = after / init - 1, ref = bh.get(`${def.symbol}|${def.fee}`) ?? 0;
    const rr = rnd.get(`${def.symbol}|${def.interval}|${def.fee}`);
    const randomRef = rr?.length ? mean(rr) : null;
    return {
      id: def.id, strategy: def.strategy, label: def.label, symbol: def.symbol, interval: def.interval, fee: def.fee, sltp: def.sltp, baseline: def.baseline,
      retAfter: ra, retBefore: before / init - 1, bhAfter: ref, vsBH: ra - ref, randomRef, vsRandom: randomRef === null ? null : ra - randomRef,
      trades: st.n, winRate: st.n ? st.wins / st.n : null, avgWin: st.wins ? st.sumWin / st.wins : null, avgLoss: st.losses ? st.sumLoss / st.losses : null,
      profitFactor: st.sumLoss < 0 ? st.sumWin / -st.sumLoss : null,
      maxDD: maxDrawdown(hourly), sharpe: sharpeHourly(hourly),
      fees: tot.fees, slippage: tot.slippage, tax: tot.tax, tdsLocked: bot.taxed.s.tdsLocked,
      equityAfter: after, equityBefore: before, open: bot.taxed.hasPosition, rankAfter: 0, rankBefore: 0,
      cash: bot.taxed.s.cash,
      pos: bot.taxed.hasPosition ? { qty: bot.taxed.qty, avgEntry: bot.taxed.avgEntry, mark, value: bot.taxed.qty * mark,
        unrealized: bot.taxed.qty * (mark - bot.taxed.avgEntry), since: Math.min(...bot.taxed.s.lots.map((l) => l.time)) } : null,
      lots: bot.taxed.s.lots.map((l) => [l.time, l.qty, l.price] as [number, number, number]),
    };
  });
  [...rows].sort((a, b) => b.retAfter - a.retAfter).forEach((r, i) => (r.rankAfter = i + 1));
  [...rows].sort((a, b) => b.retBefore - a.retBefore).forEach((r, i) => (r.rankBefore = i + 1));
  rows.sort((a, b) => a.rankAfter - b.rankAfter);
  return { generatedAt: now, run: { startAt: run.startAt, endAt: run.endAt, status: run.status, source: run.source, elapsedH: (t1 - run.startAt) / 3_600_000, initialCash: init },
    plan: JSON.parse(store.getMeta('plan') ?? 'null'), rows };
}

const pc = (x: number | null | undefined, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);
const f2 = (x: number | null) => (x === null || !Number.isFinite(x) ? '—' : x.toFixed(2));
const ist = (t: number) => new Date(t + 19_800_000).toISOString().replace('T', ' ').slice(0, 16) + ' IST';
const iso = (t: number) => new Date(t).toISOString().replace('.000Z', 'Z');

export function leaderboardMarkdown(lb: Leaderboard, top = 25): string {
  const L = [`# Leaderboard — ${ist(lb.generatedAt)}`, '',
    `Run: ${ist(lb.run.startAt)} → ${ist(lb.run.endAt)} · status **${lb.run.status}** · elapsed ${lb.run.elapsedH.toFixed(1)}h · data: ${lb.run.source} · ${lb.rows.length} bots`, '',
    '| # | bot | after tax | before tax | vs B&H | vs random | trades | win% | maxDD | fees | tax | TDS locked |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  const show = lb.rows.slice(0, top);
  for (const r of show) L.push(`| ${r.rankAfter} | ${r.baseline ? '**' + r.id + '**' : r.id} | ${pc(r.retAfter)} | ${pc(r.retBefore)} | ${pc(r.vsBH)} | ${pc(r.vsRandom)} | ${r.trades} | ${pc(r.winRate, 0)} | ${pc(r.maxDD)} | ${f2(r.fees)} | ${f2(r.tax)} | ${f2(r.tdsLocked)} |`);
  L.push('', `Baselines (bold): buyAndHold, random. Top ${show.length} of ${lb.rows.length} shown.`);
  return L.join('\n') + '\n';
}

// ----------------------------------------------------------------------------------------------
// Final report
// ----------------------------------------------------------------------------------------------
function groupTable(rows: LeaderRow[], by: (r: LeaderRow) => string, title: string): string[] {
  const g = new Map<string, LeaderRow[]>();
  for (const r of rows) (g.get(by(r)) ?? g.set(by(r), []).get(by(r))!).push(r);
  const out = [`**${title}**`, '', '| group | bots | mean after tax | median after tax | % beat B&H | mean trades |', '|---|---|---|---|---|---|'];
  const arr = [...g.entries()].map(([k, v]) => ({ k, v, m: mean(v.map((x) => x.retAfter)) })).sort((a, b) => b.m - a.m);
  for (const { k, v, m } of arr) out.push(`| ${k} | ${v.length} | ${pc(m)} | ${pc(median(v.map((x) => x.retAfter)))} | ${pc(v.filter((x) => x.vsBH > 0).length / v.length, 0)} | ${mean(v.map((x) => x.trades)).toFixed(1)} |`);
  return [...out, ''];
}

export function finalReportMarkdown(lb: Leaderboard, health: ReturnType<Store['health']>, bt: BtResult | null, fills: { book: number; model: number }): string {
  const rows = lb.rows, strat = rows.filter((r) => !r.baseline), rand = rows.filter((r) => r.strategy === 'random'), hold = rows.filter((r) => r.strategy === 'buyAndHold');
  const L: string[] = [];
  const hours = lb.run.elapsedH;
  L.push(`# Final report — ${rows.length}-bot paper-trading experiment`, '',
    `Window: **${ist(lb.run.startAt)} → ${ist(lb.run.endAt)}** (${hours.toFixed(1)}h; UTC ${iso(lb.run.startAt)}) · data: ${lb.run.source} · wallet per bot: ${lb.run.initialCash.toLocaleString()} · all numbers are PAPER results after fees, slippage, spread and Indian tax (liquidation basis — open positions are valued as if sold now, including the tax that sale would trigger).`, '');

  // ---- verdict
  const beatBH = strat.filter((r) => r.vsBH > 0), beatRand = strat.filter((r) => r.vsRandom !== null && r.vsRandom > 0);
  const randBeatBH = rand.filter((r) => r.vsBH > 0);
  const randSd = std(rand.map((r) => r.retAfter));
  const bestStrat = [...strat].sort((a, b) => b.retAfter - a.retAfter)[0];
  const bestRand = [...rand].sort((a, b) => b.retAfter - a.retAfter)[0];
  const profitable = strat.filter((r) => r.retAfter > 0).length;
  L.push('## Plain-language conclusion', '');
  if (!strat.length) L.push('No strategy bots were run.');
  else {
    if (beatBH.length === 0) L.push(`**Nothing beat holding.** None of the ${strat.length} strategy bots finished ahead of buy-and-hold on the same coin and fee profile, after tax.`);
    else L.push(`**${beatBH.length} of ${strat.length} strategy bots (${pc(beatBH.length / strat.length, 0)}) beat buy-and-hold after tax.** For reference, ${randBeatBH.length} of ${rand.length} purely random bots (${pc(rand.length ? randBeatBH.length / rand.length : 0, 0)}) also did. ${beatBH.length / strat.length <= (rand.length ? randBeatBH.length / rand.length : 0) + 0.1 ? 'That is **not meaningfully better than chance**.' : 'That is higher than the random baseline, but see the noise section before reading anything into it.'}`);
    const shareRand = beatRand.length / strat.length;
    L.push('', `${beatRand.length} of ${strat.length} strategy bots (${pc(shareRand, 0)}) beat the random baseline for their own coin/interval/fee. ${shareRand < 0.6 ? 'Around 50% is what a coin flip gives, so **the strategies as a group showed no reliable edge over random in this window.**' : 'That is above the ~50% a coin flip would give, but read it together with the noise section below.'}`);
    L.push('', `${profitable} of ${strat.length} strategy bots had a positive after-tax return; the market itself (buy-and-hold, 0.1% fee) returned ${hold.filter((h) => h.fee === 'default').map((h) => `${h.symbol.replace('USDT', '')} ${pc(h.retAfter)}`).join(', ')}.`);
    if (bestStrat) L.push('', `Best strategy bot: **${bestStrat.id}** at ${pc(bestStrat.retAfter)}${bestRand ? ` — but the best *random* bot got ${pc(bestRand.retAfter)}` : ''}. With ${strat.length} bots, one of them topping the table is expected by luck alone.`);
  }
  L.push('', '### How much of this is noise?', '',
    `- The window is only **${hours.toFixed(0)} hours**. That is a tiny sample: a handful of trades per bot, and one market regime.`,
    `- Random bots (no skill by construction) ended with an after-tax standard deviation of **${pc(randSd)}** between them. Differences between bots smaller than roughly **±${pc(2 * randSd)}** are indistinguishable from noise.`,
    `- The bots are **not independent**: they trade only ${new Set(rows.map((r) => r.symbol)).size} coins, so they share the same few price paths. Counting ${rows.length} bots as ${rows.length} experiments overstates the evidence.`,
    '- You tested many bots; the best one looking good is the *expected* result of selection, not evidence of skill. Re-running the same bots on a fresh 48h window is the only honest confirmation.', '');

  // ---- top / bottom
  const t = (r: LeaderRow) => `| ${r.rankAfter} | ${r.baseline ? '**' + r.id + '**' : r.id} | ${pc(r.retAfter)} | ${pc(r.retBefore)} | ${pc(r.vsBH)} | ${r.trades} |`;
  const hdr = ['| # | bot | after tax | before tax | vs B&H | trades |', '|---|---|---|---|---|---|'];
  L.push('## Top 10 bots (after tax)', '', ...hdr, ...rows.slice(0, 10).map(t), '', '## Bottom 10 bots (after tax)', '', ...hdr, ...rows.slice(-10).map(t), '');
  L.push(`Baselines are in **bold** where they appear. Buy-and-hold rows: ${hold.map((h) => `${h.symbol} ${h.fee} ${pc(h.retAfter)}`).join(' · ')}.`, '');

  // ---- breakdowns
  L.push('## What did best / worst?', '', 'Strategy bots only (baselines excluded). Means over a handful of correlated bots — read as descriptive, not predictive.', '',
    ...groupTable(strat, (r) => r.strategy, 'By strategy family'),
    ...groupTable(strat, (r) => r.interval, 'By interval'),
    ...groupTable(strat, (r) => r.symbol, 'By symbol'),
    ...groupTable(strat, (r) => r.fee, 'By fee profile (default 0.1% vs Indian 0.4%; indian ran on 1h only)'),
    ...groupTable(strat, (r) => r.sltp, 'By SL/TP variant'));
  const h1 = strat.filter((r) => r.interval === '1h' && r.sltp === 'none');
  const dd = h1.filter((r) => r.fee === 'default'), ind = h1.filter((r) => r.fee === 'indian');
  const matched = dd.map((a) => ({ a, b: ind.find((x) => x.id === a.id.replace(':default:', ':indian:')) })).filter((x) => x.b);
  if (matched.length) L.push(`**Fee effect (matched pairs, 1h, no SL/TP, ${matched.length} pairs):** moving from 0.1% to 0.4% per side cost on average ${pc(mean(matched.map((m) => m.a.retAfter - m.b!.retAfter)))} of the wallet.`, '');

  // ---- tax
  const tauAll = spearman(rows.map((r) => r.retBefore), rows.map((r) => r.retAfter));
  const movers = [...rows].map((r) => ({ r, d: r.rankAfter - r.rankBefore })).sort((a, b) => b.d - a.d);
  const totalTax = rows.reduce((a, r) => a + r.tax, 0), totalTds = rows.reduce((a, r) => a + r.tdsLocked, 0);
  L.push('## Effect of Indian tax', '',
    `- Total tax charged across all bots: **${totalTax.toFixed(2)}**; TDS locked (refundable via ITR, counted in equity but unavailable for trading): **${totalTds.toFixed(2)}** — both summed over all ${rows.length} wallets.`,
    `- Mean return drag from tax on strategy bots: **${pc(mean(strat.map((r) => r.retBefore - r.retAfter)))}** of the wallet.`,
    `- Rank correlation before vs after tax (Spearman): **${Number.isFinite(tauAll) ? tauAll.toFixed(3) : 'n/a'}** (1.0 = tax never changes the ordering).`,
    `- **Why after-tax can beat before-tax for some losers:** 1% TDS is withheld on every sell and locked, so a high-turnover bot runs out of *tradable* cash and stops paying fees. ${rows.filter((r) => r.retAfter > r.retBefore).length} of ${rows.length} bots finished with a better after-tax than before-tax number for this reason (locked TDS is counted at full value because it is refundable). Treat that as a cost-of-capital effect, not as tax being good.`,
    `- Tax does **not** allow losses to offset gains and fees are not deductible (section 115BBH reading, toggle in config). Frequent traders therefore pay tax on winners and get nothing back on losers — compare each bot's *before* and *after* column.`, '',
    '**Biggest rank drops after tax** (rank before → after):', '',
    ...movers.slice(0, 5).map((m) => `- ${m.r.id}: ${m.r.rankBefore} → ${m.r.rankAfter} (${pc(m.r.retBefore)} → ${pc(m.r.retAfter)})`), '',
    '**Biggest rank gains after tax** (they gained because others were taxed more, e.g. holders that never realised a gain):', '',
    ...movers.slice(-5).reverse().map((m) => `- ${m.r.id}: ${m.r.rankBefore} → ${m.r.rankAfter} (${pc(m.r.retBefore)} → ${pc(m.r.retAfter)})`), '');

  // ---- backtest vs live
  if (bt) {
    L.push('## Backtest vs live', '',
      `Backtest: ${bt.days} days (${bt.source}), same bots, same cost model. "Backtest 48h" is the average return over every rolling 48h window inside the backtest; the band is its 10th–90th percentile. Gap = live − backtest mean.`, '',
      '| strategy | bots | backtest 48h mean | backtest p10…p90 (avg) | live (mean) | gap | live outside band |', '|---|---|---|---|---|---|---|');
    const btMap = new Map(bt.rows.map((r) => [r.id, r]));
    const fam = new Map<string, LeaderRow[]>();
    for (const r of rows) (fam.get(r.strategy) ?? fam.set(r.strategy, []).get(r.strategy)!).push(r);
    for (const [name, rs] of [...fam.entries()].sort()) {
      const pairs = rs.map((r) => ({ r, b: btMap.get(r.id) })).filter((x) => x.b);
      if (!pairs.length) continue;
      const bm = mean(pairs.map((p) => p.b!.w48.mean)), lm = mean(pairs.map((p) => p.r.retAfter));
      const out = pairs.filter((p) => p.r.retAfter < p.b!.w48.p10 || p.r.retAfter > p.b!.w48.p90).length;
      L.push(`| ${name} | ${pairs.length} | ${pc(bm)} | ${pc(mean(pairs.map((p) => p.b!.w48.p10)))} … ${pc(mean(pairs.map((p) => p.b!.w48.p90)))} | ${pc(lm)} | ${pc(lm - bm)} | ${out}/${pairs.length} |`);
    }
    const flagged = strat.filter((r) => btMap.get(r.id)?.overfit);
    L.push('', `Bots flagged as likely overfit in the backtest (good days 1–60, bad days 61–90): ${flagged.length}. Their live mean: ${pc(mean(flagged.map((r) => r.retAfter)))} vs ${pc(mean(strat.filter((r) => !btMap.get(r.id)?.overfit).map((r) => r.retAfter)))} for the rest.`, '');
  } else L.push('## Backtest vs live', '', '_No backtest file was found; run the backtest phase first to enable this comparison._', '');

  // ---- health
  L.push('## Run health & data quality', '',
    `- Ticks: ${health.ticks} · candles processed: ${health.candlesProcessed} · **missed candles (gaps): ${health.missedCandles}** · errors logged: ${health.errorCount} · longest gap between ticks: ${(health.maxBehindMs / 60000).toFixed(1)} min.`,
    `- Fill pricing: ${fills.book} trades filled at the real live bid/ask, ${fills.model} at modelled prices (candle close ± observed spread, used when a tick ran late). Both include the extra 0.05% slippage.`,
    `- Assumptions worth remembering: signals act at the candle close; SL/TP are checked on closed candles using high/low (stop wins if both are touched); take-profit fills as a limit (fee, no slippage); stop-loss fills as a market order.`);
  return L.join('\n') + '\n';
}

function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/_(.+?)_/g, '<i>$1</i>');
  const out: string[] = []; const lines = md.split('\n'); let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.startsWith('|')) {
      const blk: string[] = []; while (i < lines.length && lines[i].startsWith('|')) blk.push(lines[i++]);
      const cells = (l: string) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      out.push('<div class="tw"><table><thead><tr>' + cells(blk[0]).map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
        blk.slice(2).map((l) => '<tr>' + cells(l).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    if (/^#{1,3} /.test(ln)) { const n = ln.match(/^#+/)![0].length; out.push(`<h${n}>${inline(ln.slice(n + 1))}</h${n}>`); }
    else if (ln.startsWith('- ')) { const items: string[] = []; while (i < lines.length && lines[i].startsWith('- ')) items.push(`<li>${inline(lines[i++].slice(2))}</li>`); out.push(`<ul>${items.join('')}</ul>`); continue; }
    else if (ln.trim()) out.push(`<p>${inline(ln)}</p>`);
    i++;
  }
  return out.join('\n');
}
export function wrapHtml(title: string, md: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>:root{--bg:#fff;--fg:#1a1d21;--mut:#5b6573;--bd:#d9dee5;--hd:#f1f4f8}@media(prefers-color-scheme:dark){:root{--bg:#14171b;--fg:#e6e9ee;--mut:#9aa5b4;--bd:#2d333b;--hd:#1c2128}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif}main{max-width:900px;margin:0 auto;padding:16px}
h1{font-size:1.5rem}h2{margin-top:2rem;border-bottom:1px solid var(--bd);padding-bottom:4px}.tw{overflow-x:auto}table{border-collapse:collapse;font-size:.85rem;margin:8px 0}
th,td{border:1px solid var(--bd);padding:4px 8px;text-align:left;white-space:nowrap}th{background:var(--hd)}code{background:var(--hd);padding:0 4px;border-radius:3px}</style></head><body><main>${mdToHtml(md)}</main></body></html>`;
}

// ----------------------------------------------------------------------------------------------
// Write everything the dashboard / workflow publishes
// ----------------------------------------------------------------------------------------------
function write(path: string, data: string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); }

export function writeSite(store: Store, cfg: Config, outDir: string, now: number, opts: { dashboardHtml?: string } = {}) {
  const lb = buildLeaderboard(store, cfg, now);
  const health = store.health();
  const data = join(outDir, 'data');
  write(join(data, 'leaderboard.json'), JSON.stringify(lb));
  const eq: Record<string, [number, number][]> = {};
  for (const r of lb.rows) {
    const c = store.equityCurve(r.id).map((p) => [p.ts, p.after] as [number, number]);
    if (!c.length || c[c.length - 1][0] < lb.generatedAt) c.push([lb.run.status === 'finished' ? lb.run.endAt : now, Math.round(r.equityAfter * 100) / 100]);
    eq[r.id] = c;
  }
  write(join(data, 'equity.json'), JSON.stringify(eq));
  const trades: Record<string, any[]> = {};
  for (const t of store.trades()) (trades[t.bot_id] ??= []).push([t.open_time, t.close_time, +t.qty.toPrecision(8), +t.entry_price.toPrecision(8), +t.exit_price.toPrecision(8), +t.net_pnl.toFixed(2), +t.tax.toFixed(2), +t.tds.toFixed(2), t.reason, t.fill_source]);
  write(join(data, 'trades.json'), JSON.stringify(trades));
  write(join(data, 'health.json'), JSON.stringify({ ...health, generatedAt: now, run: lb.run, plan: lb.plan }));

  // hourly snapshot
  const last = Number(store.getMeta('lastSnapshot') ?? 0);
  if (now - last >= cfg.snapshotEveryMin * 60_000 || lb.run.status === 'finished') {
    const stamp = iso(now).slice(0, 13).replace(/[-:]/g, '') ;
    write(join(data, 'snapshots', `leaderboard-${stamp}.json`), JSON.stringify({ generatedAt: now, run: lb.run, rows: lb.rows.map((r) => ({ id: r.id, retAfter: r.retAfter, retBefore: r.retBefore, vsBH: r.vsBH, trades: r.trades, rank: r.rankAfter })) }));
    write(join(data, 'snapshots', `leaderboard-${stamp}.md`), leaderboardMarkdown(lb));
    store.setMeta('lastSnapshot', String(now));
  }
  write(join(outDir, 'LEADERBOARD.md'), leaderboardMarkdown(lb));

  if (opts.dashboardHtml && existsSync(opts.dashboardHtml)) { copyFileSync(opts.dashboardHtml, join(outDir, 'index.html')); write(join(outDir, '.nojekyll'), ''); }

  if (lb.run.status === 'finished') {
    let bt: BtResult | null = null;
    const bp = join(data, 'backtest.json');
    if (existsSync(bp)) bt = JSON.parse(readFileSync(bp, 'utf8'));
    const f = store.db.prepare('SELECT fill_source s, COUNT(*) n FROM trades GROUP BY fill_source').all() as any[];
    const fills = { book: f.find((x) => x.s === 'book')?.n ?? 0, model: f.find((x) => x.s === 'model')?.n ?? 0 };
    const md = finalReportMarkdown(lb, health, bt, fills);
    write(join(outDir, 'report', 'final.md'), md);
    write(join(outDir, 'report', 'final.html'), wrapHtml('Final report', md));
  }
  return lb;
}
