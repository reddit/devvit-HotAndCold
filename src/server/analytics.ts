import express from 'express';
import { redis } from '@devvit/web/server';

const hopByHopHeaderNames = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  // Let fetch/express compute these appropriately
  'host',
  'content-length',
  'accept-encoding',
]);

const allowedForwardHeaderNames = new Set([
  'accept',
  'content-type',
  'user-agent',
  'accept-language',
  'cache-control',
  'content-length',
  'content-encoding',
]);

type CacheResponseConfig = {
  endpoint: string;
  ignoreQueryParams?: string[];
  ttlSeconds?: number;
};

// Build a quick-lookup map once so we don't parse/loop on every request
type CacheRule = { ignoreQueryParams?: string[]; ttlSeconds?: number };

function buildCacheKeyFromRule(url: URL, cfg: CacheRule): string {
  const params = new URLSearchParams(url.search);
  for (const p of cfg.ignoreQueryParams || []) params.delete(p);
  // Sort keys for a stable cache key; values order per key is preserved
  params.sort();
  const qs = params.toString();
  return `cache:${url.hostname}${url.pathname}${qs ? '?' + qs : ''}`;
}

function getCacheInfoForRequest(
  method: string | undefined,
  url: URL,
  cacheRulesByKey: Map<string, CacheRule>
): { key: string; ttlSeconds: number } | null {
  const upper = (method || 'GET').toUpperCase();
  if (upper !== 'GET') return null;
  const rule = cacheRulesByKey.get(`${url.hostname}${url.pathname}`);
  if (!rule) return null;
  const key = buildCacheKeyFromRule(url, rule);
  const ttlSeconds = rule.ttlSeconds ?? 300;
  return { key, ttlSeconds };
}

type CachedEntry = {
  status: number;
  headers: Record<string, string>;
  bodyB64: string;
};

async function getCachedResponse(cacheKey: string): Promise<CachedEntry | null> {
  const cached = await redis.get(cacheKey);
  if (!cached) return null;
  try {
    const parsed = JSON.parse(cached) as CachedEntry;
    if (!parsed || typeof parsed.status !== 'number' || !parsed.bodyB64) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function setCachedResponse(
  cacheKey: string,
  status: number,
  headers: Headers,
  bodyBuffer: Buffer,
  ttlSeconds: number
): Promise<void> {
  const headersToStore: Record<string, string> = {};
  headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (hopByHopHeaderNames.has(lower)) return;
    if (lower === 'content-length') return;
    headersToStore[name] = value;
  });
  const toStore: CachedEntry = {
    status,
    headers: headersToStore,
    bodyB64: bodyBuffer.toString('base64'),
  };
  await redis.set(cacheKey, JSON.stringify(toStore));
  await redis.expire(cacheKey, Math.max(1, Math.floor(ttlSeconds || 300)));
}

// end cache helpers

function filterOutgoingRequestHeaders(req: express.Request): Headers {
  const method = (req.method || 'GET').toUpperCase();
  const headers = new Headers();

  // Copy only allowlisted headers
  for (const [name, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lower = name.toLowerCase();
    if (!allowedForwardHeaderNames.has(lower)) continue;
    if ((method === 'GET' || method === 'HEAD') && lower === 'content-type') continue;
    headers.set(lower, String(value));
  }

  // Ensure a reasonable Accept header if not provided
  if (!headers.has('accept')) headers.set('accept', '*/*');

  return headers;
}

async function readRequestBody(req: express.Request): Promise<Uint8Array | undefined> {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return undefined;
  return await new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export type AnalyticsRouterOptions = {
  posthogKey: string;
  ingestBase?: string;
  assetsBase?: string;
};

export default function makeAnalyticsRouter(options: AnalyticsRouterOptions) {
  const ingestBase = options.ingestBase ?? 'https://us.i.posthog.com';
  const assetsBase = options.assetsBase ?? 'https://us-assets.i.posthog.com/static';
  const router = express.Router();

  const cacheResponses: CacheResponseConfig[] = [
    {
      endpoint: `${ingestBase}/array/${options.posthogKey}/config.js`,
      ignoreQueryParams: [],
      ttlSeconds: 300,
    },
    {
      endpoint: `${ingestBase}/array/${options.posthogKey}/config`,
      ignoreQueryParams: ['_'],
      ttlSeconds: 300,
    },
  ];

  const cacheRulesByKey: Map<string, CacheRule> = new Map<string, CacheRule>();
  for (const cfg of cacheResponses) {
    try {
      const u = new URL(cfg.endpoint);
      const rule: CacheRule = {};
      if (cfg.ignoreQueryParams !== undefined) rule.ignoreQueryParams = cfg.ignoreQueryParams;
      if (cfg.ttlSeconds !== undefined) rule.ttlSeconds = cfg.ttlSeconds;
      cacheRulesByKey.set(`${u.hostname}${u.pathname}`, rule);
    } catch {
      // ignore bad config entries
    }
  }

  function makeFetchProxyHandler(opts: {
    targetBase: string;
    stripPrefix: string;
  }): express.RequestHandler {
    const { targetBase, stripPrefix } = opts;
    return async (req, res) => {
      try {
        const originalUrl = req.originalUrl || req.url;
        const idx = originalUrl.indexOf(stripPrefix);
        const suffix = idx >= 0 ? originalUrl.slice(idx + stripPrefix.length) : '';

        const targetUrl = new URL(targetBase + (suffix || '/'));
        // Ensure auth token is not forwarded upstream
        targetUrl.searchParams.delete('webbit_token');

        const headers = filterOutgoingRequestHeaders(req);
        const body = await readRequestBody(req);
        const endpoint = targetUrl.toString();

        // One last check!
        if (
          (endpoint.includes('t2_') && !endpoint.includes('t2_xxx')) ||
          endpoint.includes('webbit_token') ||
          endpoint.includes('webbitToken')
        ) {
          throw new Error('Malformed URL to proxy: ' + endpoint);
        }

        // Attempt Redis cache for configured endpoints
        const endpointUrl = new URL(endpoint);
        const cacheInfo = getCacheInfoForRequest(req.method, endpointUrl, cacheRulesByKey);
        if (cacheInfo) {
          const cached = await getCachedResponse(cacheInfo.key);
          if (cached) {
            res.status(cached.status || 200);
            for (const [name, value] of Object.entries(cached.headers || {})) {
              const lower = name.toLowerCase();
              if (hopByHopHeaderNames.has(lower)) continue;
              if (lower === 'content-length') continue;
              res.setHeader(name, value);
            }
            res.send(Buffer.from(cached.bodyB64, 'base64'));
            return;
          }
        }

        const upstream = await fetch(endpoint, {
          method: req.method,
          headers,
          // Passing undefined for GET/HEAD ensures no body is sent
          body: body as any,
          redirect: 'follow',
        });

        // Forward status and headers
        res.status(upstream.status);
        upstream.headers.forEach((value, name) => {
          const lower = name.toLowerCase();
          if (hopByHopHeaderNames.has(lower)) return;
          // Let express compute content-length after .send()
          if (lower === 'content-length') return;
          res.setHeader(name, value);
        });

        const arrayBuffer = await upstream.arrayBuffer();
        const buf = Buffer.from(arrayBuffer);
        res.send(buf);

        // Store successful responses in Redis for configured endpoints
        if (cacheInfo && upstream.status === 200) {
          await setCachedResponse(
            cacheInfo.key,
            upstream.status,
            upstream.headers,
            buf,
            cacheInfo.ttlSeconds
          );
        }
      } catch (error) {
        console.error('Proxy error:', error);
        res.status(502).json({ error: 'Bad Gateway' });
      }
    };
  }

  const posthogStatic = makeFetchProxyHandler({
    // Note: expect requests to match /collect/static/* and map to /static/* on the asset host
    targetBase: assetsBase,
    stripPrefix: '/collect/static',
  });

  const posthogIngest = makeFetchProxyHandler({
    // Generic ingest proxy: /collect/* → https://us.i.posthog.com/*
    targetBase: ingestBase,
    stripPrefix: '/collect',
  });

  router.use('/collect/static', posthogStatic);
  router.use('/collect', posthogIngest);

  return router;
}
