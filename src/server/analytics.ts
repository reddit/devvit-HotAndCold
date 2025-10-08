import express from 'express';

const router = express.Router();

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

function makeFetchProxyHandler(options: {
  targetBase: string;
  stripPrefix: string;
}): express.RequestHandler {
  const { targetBase, stripPrefix } = options;
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

      // console.log("proxy →", req.method, endpoint);
      // One last check!
      if (
        (endpoint.includes('t2_') && !endpoint.includes('t2_xxx')) ||
        endpoint.includes('webbit_token') ||
        endpoint.includes('webbitToken')
      ) {
        throw new Error('Malformed URL to proxy: ' + endpoint);
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
      res.send(Buffer.from(arrayBuffer));
    } catch (error) {
      console.error('Proxy error:', error);
      res.status(502).json({ error: 'Bad Gateway' });
    }
  };
}

// Handlers
const posthogStatic = makeFetchProxyHandler({
  // Note: expect requests to match /collect/static/* and map to /static/* on the asset host
  targetBase: 'https://us-assets.i.posthog.com/static',
  stripPrefix: '/collect/static',
});

const posthogIngest = makeFetchProxyHandler({
  // Generic ingest proxy: /collect/* → https://us.i.posthog.com/*
  targetBase: 'https://us.i.posthog.com',
  stripPrefix: '/collect',
});

router.use('/collect/static', posthogStatic);
router.use('/collect', posthogIngest);

export default router;
