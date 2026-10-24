import { SDK_VERSION } from './version';

export interface HttpResult<T> {
  status: number;
  body: T | null;
}

export class NetworkError extends Error {}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  credential?: string;
  timeoutMs?: number;
}

/** fetch with a hard AbortController timeout (5 s default) and the SDK version header. */
export async function request<T>(url: string, opts: RequestOptions = {}): Promise<HttpResult<T>> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), opts.timeoutMs ?? 5000);
  // GETs stay CORS-simple (no preflight); POSTs carry the JSON body and SDK version header.
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['X-FirstFive-SDK'] = SDK_VERSION;
  }
  if (opts.credential) headers.Authorization = `Bearer ${opts.credential}`;
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller?.signal,
      credentials: 'omit',
      mode: 'cors',
    });
    let body: T | null = null;
    try {
      body = (await res.json()) as T;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (err) {
    throw new NetworkError(err instanceof Error ? err.message : 'network error');
  } finally {
    clearTimeout(timer);
  }
}

export const RETRY_DELAYS_MS = [1000, 2000, 4000];

export function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * POST with retries on network/429/5xx using the given delays.
 * Returns the last result, or null if every attempt failed at the network level.
 */
export async function postWithRetry<T>(
  url: string,
  body: unknown,
  credential: string,
  delays: number[] = RETRY_DELAYS_MS,
): Promise<HttpResult<T> | null> {
  let last: HttpResult<T> | null = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      last = await request<T>(url, { method: 'POST', body, credential });
      if (!isRetryable(last.status)) return last;
    } catch {
      last = null;
    }
    if (attempt < delays.length) await sleep(delays[attempt]);
  }
  return last;
}
