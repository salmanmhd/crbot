import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname, normalize } from 'node:path';
import { loadConfig } from './config.ts';
import { buildBots, summarizePlan } from './bots.ts';
import { Store } from './db.ts';
import { initRun, tick } from './live.ts';
import { FakeClock, makeProvider, systemClock } from './runtime.ts';
import { loadHistory, runBacktest, backtestMarkdown } from './backtest.ts';
import { writeSite } from './report.ts';
import { simulate } from './sim.ts';
import { SYNTH_EPOCH } from './data/synthetic.ts';

const ROOT = join(import.meta.dirname, '..');
const DASH = join(ROOT, 'dashboard', 'index.html');
const SYNTH_NOW = Date.UTC(2026, 5, 1);

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {}; const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1]; if (v !== undefined && !v.startsWith('--')) { flags[k] = v; i++; } else flags[k] = true; }
    else pos.push(a);
  }
  return { flags, pos };
}
const log = (s: string) => console.log(s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { flags, pos } = parseArgs(process.argv.slice(2));
  const cmd = pos[0] ?? 'help';
  const cfg = loadConfig();
  const out = String(flags.out ?? 'out');
  const synthetic = Boolean(flags.synthetic);
  const clock = synthetic ? new FakeClock(flags.now ? Date.parse(String(flags.now)) : SYNTH_NOW) : systemClock;
  const dbPath = join(out, 'state', 'paper.db');
  const open = () => { mkdirSync(join(out, 'state'), { recursive: true }); return new Store(dbPath); };

  switch (cmd) {
    case 'check': { // connectivity smoke test against the REAL data source (no state touched)
      const md = makeProvider(cfg, synthetic, clock);
      let bad = 0;
      for (const symbol of cfg.symbols) {
        try {
          const b = await md.getBook(symbol);
          const k = await md.getKlines(symbol, cfg.intervals[0], Date.now() - 3_600_000, Date.now(), 20);
          log(`OK   ${md.name} ${symbol}: bid ${b.bid} ask ${b.ask} (spread ${(((b.ask - b.bid) / b.bid) * 100).toFixed(4)}%), ${k.length} recent ${cfg.intervals[0]} candles`);
        } catch (e) { bad++; log(`FAIL ${md.name} ${symbol}: ${e instanceof Error ? e.message : e}`); }
      }
      if (bad) { log('\nData source unreachable. If this is GitHub Actions and you see HTTP 451, set repo variable PAPER_PROVIDER=coinbase.'); process.exitCode = 1; }
      break;
    }
    case 'plan': {
      const plan = buildBots(cfg);
      log(summarizePlan(plan));
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'bots.json'), JSON.stringify(plan.bots, null, 1));
      log(`\nFull list written to ${join(out, 'bots.json')}`);
      if (flags.list) for (const b of plan.bots) log('  ' + b.id);
      break;
    }
    case 'backtest': {
      const md = makeProvider(cfg, synthetic, clock);
      const plan = buildBots(cfg);
      log(summarizePlan(plan));
      log(`Fetching ${cfg.backtestDays}d of candles from ${md.name}…`);
      const days = Number(flags.days ?? cfg.backtestDays);
      const { hist, end, gaps } = await loadHistory(md, cfg, synthetic ? clock : { now: () => Math.floor(Date.now() / 3_600_000) * 3_600_000 }, days, log);
      log('Running backtest…');
      const t0 = Date.now();
      const res = runBacktest(hist, end, cfg, plan.bots, md.name, days, gaps);
      log(`Backtest done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      mkdirSync(join(out, 'data'), { recursive: true });
      writeFileSync(join(out, 'data', 'backtest.json'), JSON.stringify(res));
      writeFileSync(join(out, 'BACKTEST.md'), backtestMarkdown(res));
      log(`Wrote ${join(out, 'data', 'backtest.json')} and BACKTEST.md`);
      break;
    }
    case 'init': {
      if (flags.force) rmSync(join(out, 'state'), { recursive: true, force: true });
      const store = open();
      const md = makeProvider(cfg, synthetic, clock);
      const r = await initRun(store, md, clock, cfg);
      log(`Run initialised: ${r.bots} bots, ends in ${cfg.runHours}h.`);
      writeSite(store, cfg, out, clock.now(), { dashboardHtml: DASH });
      store.close();
      break;
    }
    case 'tick': {
      if (!existsSync(dbPath)) { log('not initialised (run `init` first) — nothing to do'); writeFileSync(join(out, '.status'), 'not_initialized'); break; }
      const store = open();
      const md = makeProvider(cfg, synthetic, clock);
      const loopSec = Number(flags['loop-seconds'] ?? 0), everySec = Number(flags['every-seconds'] ?? cfg.daemonTickSec);
      const t0 = Date.now();
      let status = 'ok';
      do {
        const r = await tick(store, md, clock, cfg);
        log(`tick: ${r.status} processed=${r.processed} errors=${r.errors}${r.justFinished ? ' FINISHED' : ''}`);
        if (r.status === 'finished') { status = 'finished'; break; }                 // already done earlier: nothing to publish
        writeSite(store, cfg, out, clock.now(), { dashboardHtml: DASH });
        status = r.justFinished ? 'just_finished' : r.status;
        if (r.justFinished || !loopSec) break;
        await sleep(everySec * 1000);
      } while (Date.now() - t0 < loopSec * 1000);
      writeFileSync(join(out, '.status'), status);
      store.close();
      break;
    }
    case 'run': { // long-running daemon for Docker / pm2
      const store = open();
      const md = makeProvider(cfg, synthetic, clock);
      if (!store.getRun()) { const r = await initRun(store, md, clock, cfg); log(`Run initialised: ${r.bots} bots.`); }
      for (;;) {
        try {
          const r = await tick(store, md, clock, cfg);
          writeSite(store, cfg, out, clock.now(), { dashboardHtml: DASH });
          log(`${new Date().toISOString()} tick ${r.status} processed=${r.processed} errors=${r.errors}`);
          if (store.getRun()?.status === 'finished') { log('48h run finished — final report in report/final.md'); break; }
        } catch (e) { log(`tick failed: ${e instanceof Error ? e.message : e}`); }
        await sleep(cfg.daemonTickSec * 1000);
      }
      store.close();
      break;
    }
    case 'report': {
      const store = open();
      writeSite(store, cfg, out, clock.now(), { dashboardHtml: DASH });
      log('reports written'); store.close();
      break;
    }
    case 'sim': {
      const hours = Number(flags.hours ?? cfg.runHours);
      const days = Number(flags.days ?? 30);
      const start = SYNTH_NOW;
      // 1) synthetic backtest ending at the sim start, 2) accelerated 48h live run
      const clk = new FakeClock(start);
      const md = makeProvider(cfg, true, clk);
      const plan = buildBots(cfg);
      log(summarizePlan(plan));
      const { hist, end, gaps } = await loadHistory(md, cfg, clk, days, () => {});
      const res = runBacktest(hist, end, cfg, plan.bots, 'synthetic', days, gaps);
      mkdirSync(join(out, 'data'), { recursive: true });
      writeFileSync(join(out, 'data', 'backtest.json'), JSON.stringify(res));
      writeFileSync(join(out, 'BACKTEST.md'), backtestMarkdown(res));
      log(`synthetic backtest (${days}d) written`);
      const sim = await simulate({ out, cfg, start, hours, tickMin: 5, jitterMin: Number(flags.jitter ?? 4), outageEvery: Number(flags.outageEvery ?? 97), outageMin: 70,
        restartEvery: Number(flags.restartEvery ?? 7), dashboardHtml: DASH, log, reset: false });
      sim.store.close();
      break;
    }
    case 'serve': {
      const port = Number(flags.port ?? 8080);
      const types: Record<string, string> = { '.html': 'text/html', '.json': 'application/json', '.md': 'text/markdown', '.js': 'text/javascript', '.css': 'text/css' };
      createServer((req, res) => {
        let p = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
        if (p === '/' || p === '\\') p = '/index.html';
        const f = join(out, p);
        if (!f.startsWith(join(out)) || !existsSync(f) || !statSync(f).isFile() || f.includes(`${join(out, 'state')}`)) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
        createReadStream(f).pipe(res);
      }).listen(port, () => log(`dashboard on http://localhost:${port}  (serving ${out})`));
      break;
    }
    default:
      log(`paper-lab commands:
  check                              verify the data source is reachable (klines + bookTicker)
  plan [--list]                      show the bot matrix and count
  backtest [--synthetic] [--out dir] 90-day walk-forward backtest -> <out>/data/backtest.json
  init [--synthetic] [--force]       create the 48h run (warm-up candles, wallets)
  tick [--loop-seconds N]            one catch-up tick (+ site files); optional in-process loop
  run                                daemon: init if needed, tick every minute until the 48h ends
  report                             rebuild leaderboard/site files from the DB
  serve [--port 8080]                serve <out>/ (dashboard) locally
  sim [--hours 48] [--days 30]       accelerated synthetic backtest + live run with delays/outages/restarts
common: --out <dir> (default ./out)  --synthetic (offline generated prices)`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
void SYNTH_EPOCH;
