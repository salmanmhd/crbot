import type { Candle, Quote } from './types.ts';
import { INTERVAL_MS } from './types.ts';
import type { Config } from './config.ts';
import { STRATEGIES } from './strategies.ts';
import type { StratCtx } from './strategies.ts';
import { Portfolio, emptyState, quoteFromMid } from './portfolio.ts';
import type { PortfolioState, Trade, CostCfg } from './portfolio.ts';

export interface BotDef {
  id: string;
  strategy: string;     // key in STRATEGIES
  label: string;        // params label
  params: Record<string, number>;
  symbol: string;
  interval: string;
  fee: string;          // fee profile name
  feePct: number;
  sltp: string;         // variant name
  sl: number | null;
  tp: number | null;
  baseline: boolean;
}
export interface FillCtx { quote: Quote; spreadPct: number; source: 'book' | 'model' }
export interface BotState {
  taxed: PortfolioState; untaxed: PortfolioState;
  startTime: number; refPrice: number; started: boolean;
}

export function costFor(def: BotDef, cfg: Config, taxed: boolean): CostCfg {
  return { feePct: def.feePct, slipPct: cfg.extraSlippagePct, taxed,
    tdsRate: cfg.tax.tdsRate, taxRate: cfg.tax.taxRate, cessRate: cfg.tax.cessRate, feesDeductible: cfg.tax.feesDeductible };
}

export class Bot {
  def: BotDef;
  cfg: Config;
  taxed: Portfolio;
  untaxed: Portfolio;
  startTime: number;
  refPrice: number;
  started: boolean;
  dirty = false;

  constructor(def: BotDef, cfg: Config, state?: BotState, init?: { startTime: number; refPrice: number }) {
    this.def = def; this.cfg = cfg;
    const st = state ?? { taxed: emptyState(cfg.initialCash), untaxed: emptyState(cfg.initialCash),
      startTime: init?.startTime ?? 0, refPrice: init?.refPrice ?? 0, started: false };
    this.taxed = new Portfolio(costFor(def, cfg, true), st.taxed);
    this.untaxed = new Portfolio(costFor(def, cfg, false), st.untaxed);
    this.startTime = st.startTime; this.refPrice = st.refPrice; this.started = st.started;
  }
  toState(): BotState {
    return { taxed: this.taxed.s, untaxed: this.untaxed.s, startTime: this.startTime, refPrice: this.refPrice, started: this.started };
  }
  get strat() { return STRATEGIES[this.def.strategy]; }

  /** Buy-and-hold enters immediately at run start (not at the first candle close). */
  enterNow(quote: Quote, time: number): void {
    this.started = true;
    for (const L of [this.taxed, this.untaxed]) L.buy(L.s.cash, quote, time);
    this.dirty = true;
  }

  /**
   * Process ONE closed candle. `window` = last N closed candles ending at `candle` (inclusive).
   * Order of events (identical in backtest and live):
   *   1. SL/TP intrabar check on the position carried INTO this candle (stop wins if both touched)
   *   2. strategy signal on the close, executed at the close quote
   * Returns trades of the taxed ledger (the one that is persisted).
   */
  step(candle: Candle, window: Candle[], fill: FillCtx): Trade[] {
    const out: Trade[] = [];
    const d = this.def;
    const ctx: StratCtx = { startTime: this.startTime, intervalMs: INTERVAL_MS[d.interval], refPrice: this.refPrice };
    const signal = this.strat.fn(window, { ...d.params, ...ctx });
    const t = candle.closeTime;
    for (const L of [this.taxed, this.untaxed]) {
      const rec = L === this.taxed;
      if (L.hasPosition && (d.sl || d.tp)) {
        const entry = L.avgEntry;
        const stop = d.sl ? entry * (1 - d.sl) : -Infinity;
        const target = d.tp ? entry * (1 + d.tp) : Infinity;
        let trades: Trade[] = [];
        if (candle.low <= stop) {                                   // stop first (pessimistic when both touched)
          const level = candle.open <= stop ? candle.open : stop;   // gap through the stop => filled at the open
          trades = L.sellAll(quoteFromMid(level, fill.spreadPct), t, 'sl', fill.source, 'market');
        } else if (candle.high >= target) {
          const level = candle.open >= target ? candle.open : target;
          trades = L.sellAll({ bid: level, ask: level }, t, 'tp', fill.source, 'limit'); // resting limit: fee, no slippage
        }
        if (rec) out.push(...trades);
      }
      if (signal === 'BUY') {
        const s = this.strat.sizing;
        if (s.mode === 'all') { if (!L.hasPosition) L.buy(L.s.cash, fill.quote, t); }
        else L.buy(s.fraction * this.cfg.initialCash, fill.quote, t);
      } else if (signal === 'SELL' && L.hasPosition) {
        let trades: Trade[] = [];
        if (this.strat.sellMode === 'all') trades = L.sellAll(fill.quote, t, 'signal', fill.source);
        else if (this.strat.sellMode === 'lowest_profitable') {
          const lot = [...L.s.lots].sort((a, b) => a.price - b.price)[0];
          if (lot && lot.price < candle.close) trades = [L.sellLot(lot, fill.quote, t, 'signal', fill.source)];
        }
        if (rec) out.push(...trades);
      }
    }
    this.dirty = true;
    return out;
  }

  equity(mid: number, spreadPct: number) {
    return { after: this.taxed.equity(mid, spreadPct), before: this.untaxed.equity(mid, spreadPct) };
  }
}
