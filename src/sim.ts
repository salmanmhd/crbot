import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.ts';
import type { MarketData } from './types.ts';
import { Store } from './db.ts';
import { initRun, tick } from './live.ts';
import { FakeClock, makeProvider } from './runtime.ts';
import { writeSite } from './report.ts';
import { rnd01 } from './strategies.ts';

export interface SimOpts {
  out: string; cfg: Config; start: number; hours?: number;
  tickMin?: number;        // nominal tick spacing
  jitterMin?: number;      // each tick is randomly late by 0..jitterMin (GitHub cron delays)
  outageEvery?: number;    // every N ticks skip a long outage of outageMin
  outageMin?: number;
  restartEvery?: number;   // close + reopen the DB / rebuild everything every N ticks
  dashboardHtml?: string;
  log?: (s: string) => void;
  reset?: boolean;
  wrapProvider?: (md: MarketData) => MarketData; // tests: inject failures / dropped candles
}

/** Accelerated synthetic live run on a fake clock. Exercises catch-up, delays, outages and restarts. */
export async function simulate(o: SimOpts) {
  const log = o.log ?? (() => {});
  const hours = o.hours ?? o.cfg.runHours;
  const dbPath = join(o.out, 'state', 'paper.db');
  if (o.reset) rmSync(o.out, { recursive: true, force: true });
  mkdirSync(join(o.out, 'state'), { recursive: true });
  const clock = new FakeClock(o.start);
  const base = makeProvider(o.cfg, true, clock);
  const md = o.wrapProvider ? o.wrapProvider(base) : base;
  let store = new Store(dbPath);
  if (!store.getRun()) { const r = await initRun(store, md, clock, o.cfg); log(`init: ${r.bots} bots`); }
  const run = store.getRun()!;
  const tickMs = (o.tickMin ?? 5) * 60_000;
  let n = 0, next = run.startAt;
  while (true) {
    n++;
    const late = Math.floor(rnd01(4242, n) * (o.jitterMin ?? 0) * 60_000);
    next += tickMs;
    if (o.outageEvery && n % o.outageEvery === 0) next += (o.outageMin ?? 90) * 60_000;
    clock.t = next + late;
    const res = await tick(store, md, clock, o.cfg);
    if (n % 12 === 0 || res.justFinished) { writeSite(store, o.cfg, o.out, clock.now(), { dashboardHtml: o.dashboardHtml }); }
    if (res.justFinished || res.status === 'finished') break;
    if (o.restartEvery && n % o.restartEvery === 0) { store.close(); store = new Store(dbPath); }
    if (n > 100000) throw new Error('simulation did not finish');
  }
  writeSite(store, o.cfg, o.out, clock.now(), { dashboardHtml: o.dashboardHtml });
  log(`sim finished after ${n} ticks`);
  return { store, ticks: n, clock };
}
