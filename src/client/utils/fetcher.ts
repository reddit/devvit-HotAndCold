/**
 * Production-grade fetcher built on top of the browser `fetch` API.
 *
 * Features
 * --------
 * • **First-class JSON support** – automatic JSON parsing & strong typings.
 * • **Multi-format responses** – transparently handles **JSON**, **text/CSV**, **blob**, **arrayBuffer**, or **formData** via an ergonomic `responseType` option (with smart defaults & extension-based inference).
 * • **Timeouts & AbortController** – each request is cancelled after the configured timeout or an external signal.
 * • **Configurable retries** – exponential back-off + jitter retry for network/5xx errors.
 * • **Helpful error objects** – throws `FetcherError` containing status code, body, and request meta.
 * • **Strict-mode ready** – compiles cleanly with `"exactOptionalPropertyTypes": true` & without `dom.iterable` in `tsconfig`.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type ResponseType = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'formData';

/** Base configuration for the Fetcher instance. */
export interface FetcherConfig {
  baseUrl?: string;
  timeout?: number; // ms (default 30 000)
  maxAttempts?: number; // Including first (default 3)
  backoff?: (attempt: number) => number;
  retryCondition?: (error: unknown, response?: Response) => boolean;
}

/** Options for a single request. */
export interface RequestOptions extends Omit<RequestInit, 'signal' | 'body' | 'headers'> {
  responseType?: ResponseType; // default inferred
  timeout?: number; // ms
  signal?: AbortSignal;
  maxAttempts?: number;
  body?: unknown; // JSON by default
  headers?: HeadersInit;
}

/** Error thrown by the fetcher. */
export class FetcherError extends Error {
  readonly status?: number | undefined;
  readonly body?: unknown;
  readonly url: string;
  readonly attempt: number;

  constructor(
    message: string,
    meta: { status?: number; body?: unknown; url: string; attempt: number }
  ) {
    super(message);
    this.name = 'FetcherError';
    this.status = meta.status;
    this.body = meta.body;
    this.url = meta.url;
    this.attempt = meta.attempt;
  }
}

/* -------------------------------------------------------------------------- */
/* Implementation                                                             */
/* -------------------------------------------------------------------------- */

export class Fetcher {
  private readonly cfg: Required<FetcherConfig>;

  constructor(cfg: FetcherConfig = {}) {
    this.cfg = {
      baseUrl: cfg.baseUrl ?? '',
      timeout: cfg.timeout ?? 30_000,
      maxAttempts: cfg.maxAttempts ?? 3,
      backoff: cfg.backoff ?? ((a) => 2 ** (a - 1) * 500 + Math.random() * 100),
      retryCondition:
        cfg.retryCondition ??
        ((err, res) => {
          // Retry on network errors or 5xx
          if (err) return true;
          return !!res && res.status >= 500 && res.status < 600;
        }),
    } as Required<FetcherConfig>;
  }

  /* -------------------------------- Helpers ------------------------------- */

  private mergeSignals(
    userSignal: AbortSignal | undefined,
    timeout: number
  ): { signal: AbortSignal; cancel: () => void } {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);

    const forwardAbort = () => ctrl.abort();
    if (userSignal) {
      if (userSignal.aborted) ctrl.abort();
      else userSignal.addEventListener('abort', forwardAbort);
    }

    return {
      signal: ctrl.signal,
      cancel: () => {
        clearTimeout(timer);
        if (userSignal) userSignal.removeEventListener('abort', forwardAbort);
      },
    };
  }

  private async parse<T>(res: Response, rt: ResponseType): Promise<T> {
    switch (rt) {
      case 'json': {
        if (res.status === 204 || res.headers.get('content-length') === '0')
          return undefined as unknown as T;
        try {
          return (await res.json()) as T;
        } catch {
          throw new FetcherError('Failed to parse JSON response', {
            status: res.status,
            body: await res.text().catch(() => undefined),
            url: res.url,
            attempt: 0,
          });
        }
      }
      case 'text':
        return (await res.text()) as unknown as T;
      case 'blob':
        return (await res.blob()) as unknown as T;
      case 'arrayBuffer':
        return (await res.arrayBuffer()) as unknown as T;
      case 'formData':
        return (await res.formData()) as unknown as T;
      default:
        return (await res.text()) as unknown as T;
    }
  }

  private delay(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  /* ----------------------------- Public API ------------------------------- */

  async request<T>(input: string | URL, opts: RequestOptions = {}): Promise<T> {
    let url: string;
    if (input instanceof URL) {
      url = input.toString();
    } else if (this.cfg.baseUrl && this.cfg.baseUrl.length > 0) {
      url = new URL(input, this.cfg.baseUrl).toString();
    } else if (typeof window !== 'undefined' && window.location) {
      url = new URL(input, window.location.origin).toString();
    } else {
      // As a final fallback, allow passing relative URL straight to fetch
      // (some runtimes support it). This avoids throwing "Invalid base URL".
      url = input;
    }

    /* -------- figure out response type (inference + override) ------------- */
    const rt: ResponseType = opts.responseType ?? (/\.(csv|txt|log)$/i.test(url) ? 'text' : 'json');

    /* ---------------- extract custom props; the rest is RequestInit -------- */
    const {
      responseType: _rt, // extracted above
      timeout: reqTimeout,
      maxAttempts: reqAttempts,
      signal: userSignal,
      body: userBody,
      headers: userHeaders,
      ...restInit
    } = opts;

    const timeout = reqTimeout ?? this.cfg.timeout;
    const maxAttempts = reqAttempts ?? this.cfg.maxAttempts;

    let attempt = 0;
    let lastErr: unknown;
    let lastRes: Response | undefined;

    while (attempt < maxAttempts) {
      attempt += 1;

      /* -------------------------- abort/timeout wiring ------------------- */
      const { signal, cancel } = this.mergeSignals(userSignal, timeout);

      /* --------------------------- headers build ------------------------- */
      const headers = new Headers(userHeaders);
      headers.set('accept', rt === 'json' ? 'application/json' : '*/*');

      // payload handling
      let payload: BodyInit | null | undefined;
      if (userBody !== undefined) {
        if (rt === 'json') {
          payload = typeof userBody === 'string' ? userBody : JSON.stringify(userBody);
          headers.set('content-type', 'application/json');
        } else {
          payload = userBody as BodyInit; // caller responsibility
        }
      }

      const init: RequestInit = {
        ...restInit,
        headers,
        signal,
        ...(payload !== undefined ? { body: payload } : {}),
      };

      try {
        lastRes = await fetch(url, init);
        cancel();

        if (!lastRes.ok) {
          let errPayload: unknown;
          try {
            errPayload = await this.parse<unknown>(lastRes, rt);
          } catch {
            /* ignore */
          }

          const error = new FetcherError(`Request failed with status ${lastRes.status}`, {
            status: lastRes.status,
            body: errPayload,
            url,
            attempt,
          });

          if (attempt < maxAttempts && this.cfg.retryCondition(error, lastRes)) {
            await this.delay(this.cfg.backoff(attempt));
            continue;
          }
          throw error;
        }

        // success – parse & return
        return this.parse<T>(lastRes, rt);
      } catch (err) {
        cancel();
        lastErr = err;

        const abort = err instanceof DOMException && err.name === 'AbortError';
        if (abort || attempt >= maxAttempts || !this.cfg.retryCondition(err, lastRes)) {
          throw err instanceof FetcherError
            ? err
            : new FetcherError('Network request failed', { url, attempt });
        }
        await this.delay(this.cfg.backoff(attempt));
      }
    }

    throw lastErr as Error; // unreachable, but TS-happy
  }
}

/* -------------------------------------------------------------------------- */
/* Default singleton                                                          */
/* -------------------------------------------------------------------------- */

export const fetcher = new Fetcher();

/* -------------------------------------------------------------------------- */
/* Example                                                                    */
/* -------------------------------------------------------------------------- */

/*
(async () => {
  // JSON
  interface Todo { id: number; title: string; completed: boolean; }
  const todo = await fetcher.request<Todo>("https://jsonplaceholder.typicode.com/todos/1");
  console.log(todo);

  // CSV (auto-inferred responseType)
  const csv = await fetcher.request<string>("/42/A.csv");
  console.log(csv);
})();
*/
