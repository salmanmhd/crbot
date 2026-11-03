export type FetchFn = typeof fetch;

export class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET JSON with timeout, retries and exponential backoff. Honors Retry-After on 429/418.
 * 451/403 (geo / policy block) are NOT retried: the caller should move to the next host.
 */
export async function getJson(url: string, opts: { fetchFn?: FetchFn; timeoutMs?: number; retries?: number; sleepFn?: (ms: number) => Promise<void> } = {}): Promise<any> {
  const f = opts.fetchFn ?? fetch;
  const retries = opts.retries ?? 4;
  const nap = opts.sleepFn ?? sleep;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await f(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000), headers: { accept: 'application/json' } });
      if (res.ok) return await res.json();
      const body = (await res.text().catch(() => '')).slice(0, 200);
      if (res.status === 451 || res.status === 403) throw new HttpError(res.status, `HTTP ${res.status} (blocked) ${url} ${body}`);
      if (res.status === 429 || res.status === 418) {
        const ra = Number(res.headers.get('retry-after'));
        await nap(Math.min(60_000, (Number.isFinite(ra) && ra > 0 ? ra * 1000 : 2000 * 2 ** attempt)));
        lastErr = new HttpError(res.status, `rate limited ${url}`);
        continue;
      }
      if (res.status >= 500) { lastErr = new HttpError(res.status, `HTTP ${res.status} ${url}`); await nap(500 * 2 ** attempt); continue; }
      throw new HttpError(res.status, `HTTP ${res.status} ${url} ${body}`);
    } catch (e) {
      if (e instanceof HttpError && (e.status === 451 || e.status === 403 || (e.status >= 400 && e.status < 500 && e.status !== 429 && e.status !== 418))) throw e;
      lastErr = e;
      if (attempt < retries) await nap(500 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
