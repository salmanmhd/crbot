import type { Config } from './config.ts';
import { STRATEGIES } from './strategies.ts';
import type { BotDef } from './bot.ts';

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

export interface BotPlan { bots: BotDef[]; uncapped: number; capped: boolean }

/**
 * Build the bot list: strategy x params x symbol x interval x fee-profile x SL/TP.
 * - buy&hold is interval-independent: one per symbol x fee profile (run on 1h bookkeeping).
 * - SL/TP variants only apply to signal strategies (not baselines / grid / DCA).
 * - Fee profiles only run on the intervals listed in cfg.feeProfileIntervals.
 * - Over the cap: baselines always kept, the rest are sampled by a stable hash of the id
 *   (NOT by performance), so the selection can never be cherry-picked.
 */
export function buildBots(cfg: Config): BotPlan {
  const all: BotDef[] = [];
  const mk = (strategy: string, label: string, params: Record<string, number>, symbol: string, interval: string,
    fee: string, sltp: string): BotDef => {
    const v = cfg.sltpVariants[sltp];
    return {
      id: `${strategy}:${label}:${symbol}:${interval}:${fee}:${sltp}`,
      strategy, label, params, symbol, interval, fee, feePct: cfg.feeProfiles[fee],
      sltp, sl: v?.sl ?? null, tp: v?.tp ?? null, baseline: STRATEGIES[strategy].baseline,
    };
  };
  for (const fee of Object.keys(cfg.feeProfiles)) {
    const itvs = (cfg.feeProfileIntervals[fee] ?? cfg.intervals).filter((i) => cfg.intervals.includes(i));
    for (const symbol of cfg.symbols) {
      all.push(mk('buyAndHold', 'hold', {}, symbol, cfg.intervals.includes('1h') ? '1h' : cfg.intervals[0], fee, 'none'));
      for (const interval of itvs) {
        for (const seed of cfg.randomSeeds)
          all.push(mk('random', `seed${seed}`, { seed, prob: cfg.randomProb }, symbol, interval, fee, 'none'));
        for (const [name, def] of Object.entries(STRATEGIES)) {
          if (name === 'buyAndHold' || name === 'random') continue;
          for (const v of def.variants) {
            const variants = def.allowSltp ? Object.keys(cfg.sltpVariants) : ['none'];
            for (const sltp of variants) all.push(mk(name, v.label, v.params, symbol, interval, fee, sltp));
          }
        }
      }
    }
  }
  const uncapped = all.length;
  if (uncapped <= cfg.maxBots) return { bots: all, uncapped, capped: false };
  const base = all.filter((b) => b.baseline);
  const rest = all.filter((b) => !b.baseline).sort((a, b) => fnv(a.id) - fnv(b.id)).slice(0, Math.max(0, cfg.maxBots - base.length));
  const keep = new Set([...base, ...rest].map((b) => b.id));
  return { bots: all.filter((b) => keep.has(b.id)), uncapped, capped: true };
}

export function summarizePlan(plan: BotPlan): string {
  const by = (f: (b: BotDef) => string) => {
    const m = new Map<string, number>();
    for (const b of plan.bots) m.set(f(b), (m.get(f(b)) ?? 0) + 1);
    return [...m.entries()].sort().map(([k, v]) => `${k}=${v}`).join('  ');
  };
  return [
    `Bots: ${plan.bots.length}${plan.capped ? ` (capped from ${plan.uncapped})` : ''}`,
    `By strategy : ${by((b) => b.strategy)}`,
    `By interval : ${by((b) => b.interval)}`,
    `By symbol   : ${by((b) => b.symbol)}`,
    `By fee      : ${by((b) => b.fee)}`,
    `By SL/TP    : ${by((b) => b.sltp)}`,
  ].join('\n');
}
