import { DatabaseSync } from 'node:sqlite';
import type { Candle } from './types.ts';
import type { Trade } from './portfolio.ts';
import type { BotDef, BotState } from './bot.ts';

export interface RunMeta {
  startAt: number; endAt: number; status: 'running' | 'finished'; source: string; initialCash: number; createdAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS candles (
  symbol TEXT NOT NULL, interval TEXT NOT NULL, open_time INTEGER NOT NULL,
  open REAL, high REAL, low REAL, close REAL, volume REAL, close_time INTEGER, fetched_at INTEGER,
  PRIMARY KEY (symbol, interval, open_time)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS cursors (symbol TEXT NOT NULL, interval TEXT NOT NULL, last_open_time INTEGER NOT NULL, PRIMARY KEY (symbol, interval));
CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, def_json TEXT NOT NULL, state_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL, open_time INTEGER, close_time INTEGER, qty REAL,
  entry_price REAL, exit_price REAL, entry_fee REAL, exit_fee REAL, gross_pnl REAL, net_pnl REAL,
  taxable_gain REAL, tax REAL, tds REAL, reason TEXT, fill_source TEXT);
CREATE INDEX IF NOT EXISTS trades_bot ON trades(bot_id);
CREATE TABLE IF NOT EXISTS equity (bot_id TEXT NOT NULL, ts INTEGER NOT NULL, after REAL, before REAL, PRIMARY KEY (bot_id, ts)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS gaps (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT, interval TEXT, from_open INTEGER, missing INTEGER, detected_at INTEGER);
CREATE TABLE IF NOT EXISTS errors (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, scope TEXT, message TEXT);
CREATE TABLE IF NOT EXISTS ticks (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, duration_ms INTEGER, candles INTEGER, errors INTEGER, behind_ms INTEGER);
CREATE TABLE IF NOT EXISTS spreads (symbol TEXT PRIMARY KEY, ts INTEGER, bid REAL, ask REAL);
`;

export class Store {
  db: DatabaseSync;
  path: string;
  constructor(path: string) {
    this.path = path;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;'); // single-file DB => safe to commit to git
    this.db.exec(SCHEMA);
  }
  close() { this.db.close(); }
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
  }

  // ---- meta / run
  getMeta(key: string): string | undefined { return (this.db.prepare('SELECT value FROM meta WHERE key=?').get(key) as any)?.value; }
  setMeta(key: string, value: string) { this.db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value); }
  getRun(): RunMeta | undefined { const v = this.getMeta('run'); return v ? JSON.parse(v) : undefined; }
  setRun(r: RunMeta) { this.setMeta('run', JSON.stringify(r)); }

  // ---- candles / cursors
  insertCandle(symbol: string, interval: string, c: Candle, fetchedAt: number): boolean {
    const r = this.db.prepare('INSERT OR IGNORE INTO candles VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(symbol, interval, c.openTime, c.open, c.high, c.low, c.close, c.volume, c.closeTime, fetchedAt);
    return Number(r.changes) === 1;
  }
  lastCandles(symbol: string, interval: string, n: number, upToOpen = Infinity): Candle[] {
    const rows = this.db.prepare('SELECT * FROM candles WHERE symbol=? AND interval=? AND open_time<=? ORDER BY open_time DESC LIMIT ?')
      .all(symbol, interval, Number.isFinite(upToOpen) ? upToOpen : 9e15, n) as any[];
    return rows.reverse().map((r) => ({ openTime: r.open_time, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume, closeTime: r.close_time }));
  }
  candleCount(symbol: string, interval: string): number { return (this.db.prepare('SELECT COUNT(*) n FROM candles WHERE symbol=? AND interval=?').get(symbol, interval) as any).n; }
  getCursor(symbol: string, interval: string): number | undefined { return (this.db.prepare('SELECT last_open_time v FROM cursors WHERE symbol=? AND interval=?').get(symbol, interval) as any)?.v; }
  setCursor(symbol: string, interval: string, v: number) {
    this.db.prepare('INSERT INTO cursors VALUES (?,?,?) ON CONFLICT(symbol,interval) DO UPDATE SET last_open_time=excluded.last_open_time').run(symbol, interval, v);
  }

  // ---- bots / trades / equity
  saveBot(def: BotDef, st: BotState) {
    this.db.prepare('INSERT INTO bots VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET state_json=excluded.state_json').run(def.id, JSON.stringify(def), JSON.stringify(st));
  }
  loadBots(): { def: BotDef; state: BotState }[] {
    return (this.db.prepare('SELECT def_json, state_json FROM bots ORDER BY id').all() as any[]).map((r) => ({ def: JSON.parse(r.def_json), state: JSON.parse(r.state_json) }));
  }
  insertTrades(botId: string, ts: Trade[]) {
    const st = this.db.prepare('INSERT INTO trades(bot_id,open_time,close_time,qty,entry_price,exit_price,entry_fee,exit_fee,gross_pnl,net_pnl,taxable_gain,tax,tds,reason,fill_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const t of ts) st.run(botId, t.openTime, t.closeTime, t.qty, t.entryPrice, t.exitPrice, t.entryFee, t.exitFee, t.grossPnl, t.netPnl, t.taxableGain, t.tax, t.tds, t.reason, t.fillSource);
  }
  trades(botId?: string): any[] {
    return (botId ? this.db.prepare('SELECT * FROM trades WHERE bot_id=? ORDER BY id').all(botId) : this.db.prepare('SELECT * FROM trades ORDER BY id').all()) as any[];
  }
  insertEquity(botId: string, ts: number, after: number, before: number) {
    this.db.prepare('INSERT OR REPLACE INTO equity VALUES (?,?,?,?)').run(botId, ts, Math.round(after * 100) / 100, Math.round(before * 100) / 100);
  }
  equityCurve(botId: string): { ts: number; after: number; before: number }[] {
    return this.db.prepare('SELECT ts, after, before FROM equity WHERE bot_id=? ORDER BY ts').all(botId) as any[];
  }
  lastEquityTs(): number { return (this.db.prepare('SELECT MAX(ts) v FROM equity').get() as any).v ?? 0; }

  // ---- health
  logError(ts: number, scope: string, message: string) { this.db.prepare('INSERT INTO errors(ts,scope,message) VALUES (?,?,?)').run(ts, scope, message.slice(0, 500)); }
  logGap(symbol: string, interval: string, fromOpen: number, missing: number, ts: number) { this.db.prepare('INSERT INTO gaps(symbol,interval,from_open,missing,detected_at) VALUES (?,?,?,?,?)').run(symbol, interval, fromOpen, missing, ts); }
  logTick(ts: number, ms: number, candles: number, errors: number, behind: number) { this.db.prepare('INSERT INTO ticks(ts,duration_ms,candles,errors,behind_ms) VALUES (?,?,?,?,?)').run(ts, ms, candles, errors, behind); }
  setSpread(symbol: string, ts: number, bid: number, ask: number) { this.db.prepare('INSERT INTO spreads VALUES (?,?,?,?) ON CONFLICT(symbol) DO UPDATE SET ts=excluded.ts,bid=excluded.bid,ask=excluded.ask').run(symbol, ts, bid, ask); }
  getSpread(symbol: string): { ts: number; bid: number; ask: number } | undefined { return this.db.prepare('SELECT ts,bid,ask FROM spreads WHERE symbol=?').get(symbol) as any; }
  health() {
    const q = (sql: string) => this.db.prepare(sql).get() as any;
    return {
      ticks: q('SELECT COUNT(*) n FROM ticks').n,
      lastTick: q('SELECT MAX(ts) v FROM ticks').v ?? null,
      candlesProcessed: q('SELECT COALESCE(SUM(candles),0) v FROM ticks').v,
      missedCandles: q('SELECT COALESCE(SUM(missing),0) v FROM gaps').v,
      gaps: this.db.prepare('SELECT symbol,interval,from_open fromOpen,missing,detected_at detectedAt FROM gaps ORDER BY id DESC LIMIT 20').all() as any[],
      errorCount: q('SELECT COUNT(*) n FROM errors').n,
      recentErrors: this.db.prepare('SELECT ts,scope,message FROM errors ORDER BY id DESC LIMIT 15').all() as any[],
      maxBehindMs: q('SELECT COALESCE(MAX(behind_ms),0) v FROM ticks').v,
    };
  }
}
