import test from 'node:test';
import assert from 'node:assert/strict';
import { Portfolio, emptyState, quoteFromMid } from '../src/portfolio.ts';
import type { CostCfg } from '../src/portfolio.ts';
import { near } from './helpers.ts';

const cost = (taxed: boolean, over: Partial<CostCfg> = {}): CostCfg =>
  ({ feePct: 0.001, slipPct: 0.0005, taxed, tdsRate: 0.01, taxRate: 0.3, cessRate: 0.04, feesDeductible: false, ...over });

test('buy: fee is inside the spend, fills at ask*(1+slip)', () => {
  const p = new Portfolio(cost(true), emptyState(10000));
  assert.ok(p.buy(10000, quoteFromMid(100, 0.0002), 1));       // bid 99.99 / ask 100.01
  const fill = 100.01 * 1.0005;
  const notional = 10000 / 1.001;
  assert.ok(near(p.s.lots[0].price, fill));
  assert.ok(near(p.s.lots[0].qty, notional / fill));
  assert.ok(near(p.s.totals.fees, 10000 - notional));
  assert.ok(Math.abs(p.s.cash) < 1e-9);
  assert.ok(near(p.s.totals.slippage, (fill - 100) * (notional / fill)));   // measured against the MID
});

test('profitable round trip: fee, slippage, 1% TDS locked, 30%+4% cess on gain only', () => {
  const p = new Portfolio(cost(true), emptyState(10000));
  p.buy(10000, quoteFromMid(100, 0), 1);
  const entry = 100 * 1.0005, qty = (10000 / 1.001) / entry, entryFee = 10000 - 10000 / 1.001;
  const [t] = p.sellAll(quoteFromMid(110, 0), 2, 'signal', 'model');
  const exit = 110 * (1 - 0.0005), value = qty * exit, fee = value * 0.001, tds = value * 0.01;
  const gain = qty * (exit - entry);                                  // fees NOT deductible
  const tax = gain * 0.3 * 1.04;
  assert.ok(near(t.exitPrice, exit));
  assert.ok(near(t.tds, tds)); assert.ok(near(p.s.tdsLocked, tds));
  assert.ok(near(t.tax, tax)); assert.ok(near(t.taxableGain, gain));
  assert.ok(near(t.netPnl, gain - entryFee - fee));
  assert.ok(near(p.s.cash, value - fee - tds - tax));
  assert.ok(near(p.equity(110, 0) , p.s.cash + p.s.tdsLocked));       // flat: equity = cash + refundable TDS
  assert.equal(p.s.stats.wins, 1);
});

test('losing trade: no tax, TDS still withheld; losses never offset later gains', () => {
  const p = new Portfolio(cost(true), emptyState(10000));
  p.buy(p.s.cash, quoteFromMid(100, 0), 1);
  const [lose] = p.sellAll(quoteFromMid(90, 0), 2, 'signal', 'model');
  assert.equal(lose.tax, 0); assert.ok(lose.tds > 0); assert.ok(lose.netPnl < 0);
  p.buy(p.s.cash, quoteFromMid(100, 0), 3);
  const [win] = p.sellAll(quoteFromMid(120, 0), 4, 'signal', 'model');
  // tax equals 31.2% of the winner's own gain, untouched by the earlier loss
  assert.ok(near(win.tax, win.taxableGain * 0.312));
  assert.ok(near(p.s.totals.tax, win.tax));
});

test('fees-deductible toggle changes the taxable gain', () => {
  const run = (fd: boolean) => { const p = new Portfolio(cost(true, { feesDeductible: fd }), emptyState(10000)); p.buy(10000, quoteFromMid(100, 0), 1); return p.sellAll(quoteFromMid(110, 0), 2, 's', 'm')[0]; };
  assert.ok(run(true).taxableGain < run(false).taxableGain);
});

test('untaxed ledger: same fills, no TDS, no tax', () => {
  const t = new Portfolio(cost(true), emptyState(10000)), u = new Portfolio(cost(false), emptyState(10000));
  for (const p of [t, u]) { p.buy(10000, quoteFromMid(100, 0), 1); p.sellAll(quoteFromMid(110, 0), 2, 's', 'm'); }
  assert.equal(u.s.tdsLocked, 0); assert.equal(u.s.totals.tax, 0);
  assert.ok(u.s.cash > t.s.cash);
  assert.ok(near(u.s.totals.fees, t.s.totals.fees));
});

test('limit sell (take-profit) pays the fee but no slippage; market sell pays both', () => {
  const a = new Portfolio(cost(false), emptyState(10000)), b = new Portfolio(cost(false), emptyState(10000));
  a.buy(10000, quoteFromMid(100, 0), 1); b.buy(10000, quoteFromMid(100, 0), 1);
  const [lim] = a.sellAll({ bid: 104, ask: 104 }, 2, 'tp', 'm', 'limit');
  const [mkt] = b.sellAll({ bid: 104, ask: 104 }, 2, 'sl', 'm', 'market');
  assert.equal(lim.exitPrice, 104); assert.ok(near(mkt.exitPrice, 104 * 0.9995));
});

test('buy with no cash does nothing; FIFO lots; liquidation equity taxes unrealised gains', () => {
  const p = new Portfolio(cost(true), emptyState(1000));
  assert.ok(p.buy(1000, quoteFromMid(100, 0), 1));
  assert.equal(p.buy(1000, quoteFromMid(100, 0), 2), false);
  const eqUp = p.equity(150, 0), eqPre = p.s.lots[0].qty * 150;
  assert.ok(eqUp < eqPre);                                            // fee + slippage + hypothetical tax
  const taxFree = new Portfolio(cost(false), emptyState(1000)); taxFree.buy(1000, quoteFromMid(100, 0), 1);
  assert.ok(eqUp < taxFree.equity(150, 0));
});
