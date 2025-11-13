import { createTRPCClient, httpBatchStreamLink } from '@trpc/client';
import type { AppRouter } from '../server/index';
import { transformer } from '../shared/transformer';
import posthog from 'posthog-js';
import { sanitizeUrlLikeString } from '../shared/sanitize';

const nativeFetch: typeof fetch | undefined =
  typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined;

const ERROR_HTML_SNIPPET_LIMIT = 4096;

type InstrumentedRequestInit =
  | RequestInit
  | {
      body?: FormData | string | null | Uint8Array | Blob | File;
      headers?: HeadersInit;
      method?: string;
      signal?: AbortSignal | undefined;
    };
type InstrumentedFetchInput = RequestInfo | URL | string;

const toHeaders = (headers: HeadersInit | undefined): Headers | undefined => {
  if (!headers || typeof Headers === 'undefined') {
    return undefined;
  }
  if (headers instanceof Headers) {
    return headers;
  }
  try {
    return new Headers(headers);
  } catch {
    return undefined;
  }
};

const extractTraceparent = (headers: HeadersInit | undefined): string | undefined => {
  const normalized = toHeaders(headers);
  return normalized?.get('traceparent') ?? undefined;
};

const getTraceparentForFetch = (
  input: InstrumentedFetchInput,
  init?: InstrumentedRequestInit
): string | undefined => {
  const initTraceparent = extractTraceparent(init?.headers as HeadersInit | undefined);
  if (initTraceparent) {
    return initTraceparent;
  }
  if (typeof Request !== 'undefined' && input instanceof Request && input.headers) {
    return extractTraceparent(input.headers);
  }
  return undefined;
};

const getRequestUrlFromInput = (input: InstrumentedFetchInput): string | undefined => {
  if (typeof input === 'string') {
    return input;
  }
  if (typeof URL !== 'undefined' && input instanceof URL) {
    return input.toString();
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.url;
  }
  return undefined;
};

const instrumentedFetch = async (
  input: InstrumentedFetchInput,
  init?: InstrumentedRequestInit
): Promise<Response> => {
  if (!nativeFetch) {
    throw new Error('Fetch is not available in this environment.');
  }
  const traceparent = getTraceparentForFetch(input, init);
  const requestUrl = getRequestUrlFromInput(input);

  const response = await nativeFetch(input as any, init as RequestInit);
  if (!response.ok) {
    const responseTraceparent = response.headers.get('traceparent') ?? null;
    const contentType = response.headers.get('content-type') ?? null;
    let responseBodySnippet: string | null = null;
    let responseBodyWasTruncated: boolean | null = null;

    try {
      const rawBody = await response.clone().text();
      if (rawBody) {
        const trimmed = rawBody.trim();
        const contentTypeLower = contentType?.toLowerCase() ?? '';
        const isHtml = contentTypeLower.includes('text/html') || trimmed.startsWith('<');
        const isPlainText =
          contentTypeLower.startsWith('text/') || contentTypeLower.includes('plain');
        const isJson =
          contentTypeLower.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[');
        const isXml = contentTypeLower.includes('xml') || contentTypeLower.includes('svg+xml');
        const isJavascript = contentTypeLower.includes('javascript');
        const isLikelyText = isHtml || isPlainText || isJson || isXml || isJavascript;
        if (isLikelyText) {
          responseBodyWasTruncated = rawBody.length > ERROR_HTML_SNIPPET_LIMIT;
          responseBodySnippet = responseBodyWasTruncated
            ? rawBody.slice(0, ERROR_HTML_SNIPPET_LIMIT)
            : rawBody;
        }
      }
    } catch {
      // Ignore body read errors
    }

    try {
      const errorString = `[tRPC httpBatch error] ${response.status} ${response.statusText} ${responseBodySnippet}`;
      posthog.captureException(new Error(errorString), {
        source: 'trpc-http-batch',
        errorKind: 'response-not-ok',
        traceparent: responseTraceparent ?? traceparent ?? null,
        requestTraceparent: traceparent ?? null,
        requestUrl: requestUrl ? sanitizeUrlLikeString(requestUrl) : null,
        status: response.status,
        statusText: response.statusText,
        responseContentType: contentType,
        responseBodySnippet,
        responseBodyWasTruncated,
        // We need to add a fingerprint manually because posthog incorrectly
        // groups these errors by its fingerprint mechanism since app errors
        // are captured on the same line.
        $exception_fingerprint: errorString.slice(0, 250),
      });
    } catch {
      // Never throw from telemetry
    }
  }
  return response;
};

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchStreamLink({
      url: '/api',
      transformer,
      fetch: instrumentedFetch,
    }),
  ],
});
