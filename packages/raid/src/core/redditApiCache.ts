/**
 * We hit a bunch of rate limits when we were making requests to the Reddit API. To avoid this, we cache the responses for a certain amount of time.
 */

import { z } from 'zod';
import { zodContext, zoddy } from '../utils/zoddy.js';
import { toMilliseconds } from '../utils/toMilliseconds.js';

export * as RedditApiCache from './redditApiCache.js';

export const getSnoovatarCached = zoddy(
  z.object({
    username: z.string(),
    context: zodContext,
  }),
  async ({ username, context }) => {
    return await context.cache(
      async () => {
        const snoovatar = await context.reddit.getSnoovatarUrl(username);

        return snoovatar ?? null;
      },
      {
        key: `avatar:${username}`,
        ttl: toMilliseconds({ days: 30 }),
      }
    );
  }
);
