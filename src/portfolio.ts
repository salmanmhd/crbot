import type { Quote } from './types.ts';

export interface Lot { id: number; qty: number; price: number; fee: number; time: number }
export interface PortfolioState {
  cash: number;
  tdsLocked: number;
  lots: Lot[];
  nextLotId: number;
  totals: { fees: number; slippage: number; tax: number; tds: number };
  stats: { n: number; wins: number; losses: number; sumWin: number; sumLoss: number; net: number };
}
export interface Trade {
  openTime: number; closeTime: number; qty: number;
  entryPrice: number; exitPrice: number; entryFee: number; exitFee: number;
  grossPnl: number; netPnl: number; taxableGain: number; tax: number; tds: number;
  reason: string; fillSource: string;
}
export interface CostCfg {
  feePct: number; slipPct: number; taxed: boolean;
  tdsRate: number; taxRate: number; cessRate: number; feesDeductible: boolean;
}

export function emptyState(cash: number): PortfolioState {
  return { cash, tdsLocked: 0, lots: [], nextLotId: 1,
    totals: { fees: 0, slippage: 0, tax: 0, tds: 0 },
    stats: { n: 0, wins: 0, losses: 0, sumWin: 0, sumLoss: 0, net: 0 } };
}
export const quoteFromMid = (mid: number, spreadPct: number): Quote =>
  ({ bid: mid * (1 - spreadPct / 2), ask: mid * (1 + spreadPct / 2) });

/**
 * Long-only spot wallet with FIFO lots. One instance = one ledger.
 * `taxed=true`  : India rules (TDS locked on sells, 30%+4% cess on each profitable closed lot, no loss offset).
 * `taxed=false` : same trades/fees/slippage, no TDS and no tax ("before tax").
 */
export class Portfolio {
  s: PortfolioState;
  c: CostCfg;
  constructor(cost: CostCfg, state: PortfolioState) { this.c = cost; this.s = state; }

  get qty(): number { return this.s.lots.reduce((a, l) => a + l.qty, 0); }
  get hasPosition(): boolean { return this.s.lots.length > 0; }
  get avgEntry(): number {
    const q = this.qty;
    return q > 0 ? this.s.lots.reduce((a, l) => a + l.qty * l.price, 0) / q : 0;
  }

  /** Spend `spend` of cash INCLUDING the fee. Buys at ask*(1+slip). Returns false if nothing bought. */
  buy(spend: number, q: Quote, time: number): boolean {
    spend = Math.min(spend, this.s.cash);
    if (!(spend >= 1)) return false;
    const fill = q.ask * (1 + this.c.slipPct);
    const mid = (q.bid + q.ask) / 2;
    const notional = spend / (1 + this.c.feePct);
    const fee = spend - notional;
    const qty = notional / fill;
    this.s.cash -= spend;
    this.s.lots.push({ id: this.s.nextLotId++, qty, price: fill, fee, time });
    this.s.totals.fees += fee;
    this.s.totals.slippage += (fill - mid) * qty;
    return true;
  }

  /** Sell one whole lot. market => bid*(1-slip); limit => exactly at q.bid (no slippage). */
  sellLot(lot: Lot, q: Quote, time: number, reason: string, source: string, kind: 'market' | 'limit' = 'market'): Trade {
    const fill = kind === 'market' ? q.bid * (1 - this.c.slipPct) : q.bid;
    const mid = (q.bid + q.ask) / 2;
    const value = lot.qty * fill;
    const fee = value * this.c.feePct;
    const tds = this.c.taxed ? value * this.c.tdsRate : 0;
    const grossPnl = lot.qty * (fill - lot.price);
    const taxableGain = this.c.feesDeductible ? grossPnl - lot.fee - fee : grossPnl;
    const tax = this.c.taxed && taxableGain > 0 ? taxableGain * this.c.taxRate * (1 + this.c.cessRate) : 0;
    const netPnl = grossPnl - lot.fee - fee;
    this.s.cash += value - fee - tds - tax;
    this.s.tdsLocked += tds;
    this.s.totals.fees += fee;
    this.s.totals.tax += tax;
    this.s.totals.tds += tds;
    if (kind === 'market') this.s.totals.slippage += (mid - fill) * lot.qty;
    const st = this.s.stats;
    st.n++; st.net += netPnl;
    if (netPnl > 0) { st.wins++; st.sumWin += netPnl; } else { st.losses++; st.sumLoss += netPnl; }
    this.s.lots = this.s.lots.filter((l) => l.id !== lot.id);
    return { openTime: lot.time, closeTime: time, qty: lot.qty, entryPrice: lot.price, exitPrice: fill,
      entryFee: lot.fee, exitFee: fee, grossPnl, netPnl, taxableGain, tax, tds, reason, fillSource: source };
  }

  sellAll(q: Quote, time: number, reason: string, source: string, kind: 'market' | 'limit' = 'market'): Trade[] {
    return [...this.s.lots].map((l) => this.sellLot(l, q, time, reason, source, kind));
  }

  /**
   * Liquidation-basis equity: cash + refundable TDS + open lots valued as if sold now at bid*(1-slip),
   * minus the sell fee and (taxed ledger) the tax that closing profitable lots would trigger.
   * Using the same basis for every bot stops buy-and-hold looking tax-free just because it never sold.
   */
  equity(mid: number, spreadPct: number): number {
    const liq = mid * (1 - spreadPct / 2) * (1 - this.c.slipPct);
    let v = this.s.cash + this.s.tdsLocked;
    for (const l of this.s.lots) {
      const value = l.qty * liq;
      const fee = value * this.c.feePct;
      v += value - fee;
      if (this.c.taxed) {
        const gross = l.qty * (liq - l.price);
        const gain = this.c.feesDeductible ? gross - l.fee - fee : gross;
        if (gain > 0) v -= gain * this.c.taxRate * (1 + this.c.cessRate);
      }
    }
    return v;
  }
}
