// Plain-array indicators. Every function returns an array the same length as the input,
// with NaN where the value is not yet defined.

export function sma(v: number[], n: number): number[] {
  const out = new Array<number>(v.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    sum += v[i];
    if (i >= n) sum -= v[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** EMA seeded with the SMA of the first n values (the textbook / StockCharts convention). */
export function ema(v: number[], n: number): number[] {
  const out = new Array<number>(v.length).fill(NaN);
  if (v.length < n) return out;
  const k = 2 / (n + 1);
  let prev = 0;
  for (let i = 0; i < n; i++) prev += v[i];
  prev /= n;
  out[n - 1] = prev;
  for (let i = n; i < v.length; i++) {
    prev = (v[i] - prev) * k + prev;
    out[i] = prev;
  }
  return out;
}

/** Wilder's RSI. First value at index n. */
export function rsi(v: number[], n: number): number[] {
  const out = new Array<number>(v.length).fill(NaN);
  if (v.length <= n) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) {
    const d = v[i] - v[i - 1];
    if (d >= 0) g += d; else l -= d;
  }
  g /= n; l /= n;
  const val = () => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
  out[n] = val();
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (n - 1) + (d > 0 ? d : 0)) / n;
    l = (l * (n - 1) + (d < 0 ? -d : 0)) / n;
    out[i] = val();
  }
  return out;
}

/** Bollinger bands using the POPULATION standard deviation (as most charting packages do). */
export function bollinger(v: number[], n: number, k: number) {
  const mid = sma(v, n);
  const upper = new Array<number>(v.length).fill(NaN);
  const lower = new Array<number>(v.length).fill(NaN);
  for (let i = n - 1; i < v.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (v[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n);
    upper[i] = mid[i] + k * sd;
    lower[i] = mid[i] - k * sd;
  }
  return { mid, upper, lower };
}

export function macd(v: number[], fast: number, slow: number, signalN: number) {
  const ef = ema(v, fast), es = ema(v, slow);
  const line = v.map((_, i) => (Number.isNaN(ef[i]) || Number.isNaN(es[i]) ? NaN : ef[i] - es[i]));
  const first = line.findIndex((x) => !Number.isNaN(x));
  const signal = new Array<number>(v.length).fill(NaN);
  if (first >= 0) {
    const s = ema(line.slice(first), signalN);
    for (let i = 0; i < s.length; i++) signal[first + i] = s[i];
  }
  const hist = line.map((x, i) => x - signal[i]);
  return { line, signal, hist };
}

/** Highest high of the n bars BEFORE each index (current bar excluded). */
export function donchianHigh(highs: number[], n: number): number[] {
  const out = new Array<number>(highs.length).fill(NaN);
  for (let i = n; i < highs.length; i++) {
    let m = -Infinity;
    for (let j = i - n; j < i; j++) if (highs[j] > m) m = highs[j];
    out[i] = m;
  }
  return out;
}
export function donchianLow(lows: number[], n: number): number[] {
  const out = new Array<number>(lows.length).fill(NaN);
  for (let i = n; i < lows.length; i++) {
    let m = Infinity;
    for (let j = i - n; j < i; j++) if (lows[j] < m) m = lows[j];
    out[i] = m;
  }
  return out;
}
