const HOUR = 3_600_000;

/** Step-resample an equity series to hourly marks in [t0, t1] (forward fill; before first point => `initial`). */
export function resampleHourly(ts: ArrayLike<number>, eq: ArrayLike<number>, t0: number, t1: number, initial: number): number[] {
  const out: number[] = [];
  let j = 0, cur = initial;
  for (let t = t0; t <= t1; t += HOUR) {
    while (j < ts.length && ts[j] <= t) { cur = eq[j]; j++; }
    out.push(cur);
  }
  return out;
}
export function valueAt(ts: ArrayLike<number>, eq: ArrayLike<number>, t: number, initial: number): number {
  let lo = 0, hi = ts.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (ts[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans < 0 ? initial : eq[ans];
}
export function maxDrawdown(eq: ArrayLike<number>): number {
  let peak = -Infinity, dd = 0;
  for (let i = 0; i < eq.length; i++) { peak = Math.max(peak, eq[i]); if (peak > 0) dd = Math.max(dd, (peak - eq[i]) / peak); }
  return dd;
}
/** Annualised Sharpe of HOURLY equity returns (rf = 0, 365d). On a 48h window this is very noisy -- treat as indicative only. */
export function sharpeHourly(eqHourly: number[]): number {
  const r: number[] = [];
  for (let i = 1; i < eqHourly.length; i++) if (eqHourly[i - 1] > 0) r.push(eqHourly[i] / eqHourly[i - 1] - 1);
  if (r.length < 2) return 0;
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
  return sd < 1e-12 ? 0 : (m / sd) * Math.sqrt(8760);
}
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export const median = (a: number[]) => percentile([...a].sort((x, y) => x - y), 0.5);
export function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
}
/** Distribution of returns over every rolling `hours`-long window (step 1h) of an hourly equity series. */
export function rollingWindowStats(eqHourly: number[], hours: number) {
  const rs: number[] = [];
  for (let i = 0; i + hours < eqHourly.length; i++) if (eqHourly[i] > 0) rs.push(eqHourly[i + hours] / eqHourly[i] - 1);
  const s = [...rs].sort((a, b) => a - b);
  return { n: rs.length, mean: mean(rs), std: std(rs), p10: percentile(s, 0.1), p90: percentile(s, 0.9) };
}
export function spearman(a: number[], b: number[]): number {
  const rank = (x: number[]) => { const idx = x.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]); const r = new Array(x.length); idx.forEach(([, i], k) => (r[i] = k)); return r; };
  const ra = rank(a), rb = rank(b), n = a.length;
  if (n < 3) return NaN;
  const ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return num / Math.sqrt(da * db);
}
