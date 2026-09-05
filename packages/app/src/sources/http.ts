/**
 * Thin undici-based HTTP client wrapper for source adapters:
 * JSON requests with timeout, one retry on transient errors, and
 * envelope-aware error handling.
 */

export interface JsonRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
}

export class SourceHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
  ) {
    super(message);
    this.name = 'SourceHttpError';
  }
}

export interface HttpClient {
  requestJson<T>(url: string, options?: JsonRequestOptions): Promise<T>;
  /** Fetch a page as raw text (SSR HTML sources). */
  requestText(url: string, options?: JsonRequestOptions): Promise<string>;
}

export class UndiciHttpClient implements HttpClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(opts: { baseUrl: string; headers?: Record<string, string>; timeoutMs?: number }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.defaultHeaders = {
      accept: 'application/json, text/html',
      'user-agent': 'JobHunter/0.1 (+https://github.com/jobhunter)',
      ...opts.headers,
    };
    this.timeoutMs = opts.timeoutMs ?? 15000;
  }

  async requestText(url: string, options: JsonRequestOptions = {}): Promise<string> {
    const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const retries = options.retries ?? 1;

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const { request } = await import('undici');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await request(fullUrl, {
            method: 'GET',
            headers: { ...this.defaultHeaders, ...options.headers },
            signal: controller.signal,
          });
          const text = await res.body.text();
          if (res.statusCode >= 400) {
            throw new SourceHttpError(
              `HTTP ${res.statusCode} for ${fullUrl}`,
              res.statusCode,
              fullUrl,
            );
          }
          return text;
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        lastError = err;
        if (err instanceof SourceHttpError && err.status >= 400 && err.status < 500) throw err;
        if (attempt === retries) break;
        await sleep(500 * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async requestJson<T>(url: string, options: JsonRequestOptions = {}): Promise<T> {
    const fullUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const retries = options.retries ?? 1;

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.attempt<T>(fullUrl, options, timeoutMs);
      } catch (err) {
        lastError = err;
        // Only retry transient errors (timeouts, 5xx, network) — never 4xx.
        if (err instanceof SourceHttpError && err.status >= 400 && err.status < 500) throw err;
        if (attempt === retries) break;
        await sleep(500 * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async attempt<T>(
    url: string,
    options: JsonRequestOptions,
    timeoutMs: number,
  ): Promise<T> {
    const { request } = await import('undici');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await request(url, {
        method: options.method ?? 'GET',
        headers: {
          ...this.defaultHeaders,
          ...(options.body != null ? { 'content-type': 'application/json' } : {}),
          ...options.headers,
        },
        body: options.body != null ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const text = await res.body.text();
      if (res.statusCode >= 400) {
        throw new SourceHttpError(`HTTP ${res.statusCode} for ${url}`, res.statusCode, url);
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new SourceHttpError(`Invalid JSON from ${url}`, res.statusCode, url);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Adapter-friendly fetcher injection: adapters never import undici directly,
 * they receive an HttpClient (real or fake) — keeping them unit-testable.
 */
export type { HttpClient as FetchLike };
