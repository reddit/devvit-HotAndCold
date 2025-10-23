import type * as http from 'node:http';
import { uuidv7 } from '@posthog/core';
import { PostHog, ErrorTracking } from 'posthog-node';
import { ErrorTracking as CoreErrorTracking } from '@posthog/core';
import { context } from '@devvit/web/server';
import { makeClientConfig } from '../shared/makeClientConfig';
import { hash } from '../shared/hash';
import { beforeSend } from '../shared/posthogUtils';

type ExpressMiddleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse & { locals: { posthog?: PostHog } },
  next: () => void
) => void;

type ExpressErrorMiddleware = (
  error: MiddlewareError,
  req: http.IncomingMessage,
  res: http.ServerResponse & { locals: { posthog?: PostHog } },
  next: (error: MiddlewareError) => void
) => void;

interface MiddlewareError extends Error {
  status?: number | string;
  statusCode?: number | string;
  status_code?: number | string;
  output?: {
    statusCode?: number | string;
  };
}

export const usePosthog: ExpressMiddleware = async (_req, res, next) => {
  const IS_PROD = context.subredditName === 'HotAndCold';
  const config = makeClientConfig(IS_PROD);

  const posthog = new PostHog(config.POSTHOG_KEY, {
    // flush immediately in serverless environment
    flushAt: 1,
    flushInterval: 0,
    // posthog-node supports before_send via core options passthrough
    before_send: beforeSend(IS_PROD),
  });

  res.locals.posthog = posthog;
  // We don't identify on every request to avoid event spam
  next();
};

// Error tracking middleware: annotate with user and trace context
export const usePosthogErrorTracking: ExpressErrorMiddleware = async (
  error: MiddlewareError,
  req,
  res,
  next
): Promise<void> => {
  try {
    const hint: CoreErrorTracking.EventHint = {
      mechanism: { type: 'middleware', handled: false },
    };

    const distinctId = context.userId ? await hash(context.userId) : uuidv7();
    const msg = await ErrorTracking.buildEventMessage(error, hint, distinctId, {
      traceId: (req.headers as any)?.['traceparent'] ?? '',
      postId: context.postId ?? '',
      appVersion: context.appVersion,
      appName: context.appName,
    });
    const ph = res.locals.posthog;
    if (ph) ph.capture(msg as any);
  } catch {
    // best effort only
  }
  next(error);
};
