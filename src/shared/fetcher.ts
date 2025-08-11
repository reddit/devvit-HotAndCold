/*
 * A strongly-typed fetch helper with retries, exponential backoff, timeout via
 * AbortController, and rich error handling.
 *
 * The function can be shared across client, server, and devvit worker code.
 */

export interface FetcherOptions {
  /** Number of retry attempts _in addition_ to the initial request (default 2) */
  retries?: number;
  /** Base delay in milliseconds for exponential backoff (default 300 ms). The
   *  effective delay is `base * 2 ** attempt`.
   */
  backoffBaseMs?: number;
  /** Maximum delay in milliseconds between retries (default 5 s) */
  backoffMaxMs?: number;
  /** Overall request timeout in milliseconds (default 8000 ms) */
  timeoutMs?: number;
  /** Standard `fetch` init options */
  init?: RequestInit;
}

export class FetchError extends Error {
  public readonly response: Response | undefined;
  constructor(message: string, response?: Response) {
    super(message);
    this.name = 'FetchError';
    this.response = response;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Generic helper around `fetch` that adds:
 *  • Automatic retries with exponential backoff
 *  • Timeout using AbortController
 *  • Strong typing via the generic parameter `T`
 *  • Flexible parsing callback to convert a `Response` into `T`
 *
 * @example
 * const text = await fetchWithRetry<string>(
 *   '/path/to/file.csv',
 *   { retries: 3, timeoutMs: 4000 },
 *   (res) => res.text()
 * );
 */
export async function fetchWithRetry<T = unknown>(
  input: RequestInfo | URL,
  options: FetcherOptions = {},
  parse: (response: Response) => Promise<T> = (res) => res.json() as unknown as Promise<T>
): Promise<T> {
  const {
    retries = 2,
    backoffBaseMs = 300,
    backoffMaxMs = 5000,
    timeoutMs = 8000,
    init = {},
  } = options;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      console.time(`[fetchWithRetry] attempt ${attempt}`);
      const response = await fetch(input, { ...init, signal: controller.signal });
      console.timeEnd(`[fetchWithRetry] attempt ${attempt}`);

      clearTimeout(timeout);

      if (!response.ok) {
        // HTTP error — treat as failure eligible for retry
        const message = `Request failed with status ${response.status}`;
        if (attempt >= retries) {
          throw new FetchError(message, response);
        }
      } else {
        // Success — parse and return
        return await parse(response);
      }
    } catch (err) {
      clearTimeout(timeout);
      // AbortError or network failure
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (attempt >= retries) throw new FetchError('Request timed out');
      } else if (attempt >= retries) {
        throw err;
      }
    }

    // Wait before next retry (exponential backoff)
    const delay = Math.min(backoffBaseMs * 2 ** attempt, backoffMaxMs);
    await sleep(delay);
    attempt += 1;
  }
}
