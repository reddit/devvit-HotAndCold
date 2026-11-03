import { createTRPCClient, httpBatchStreamLink } from '@trpc/client';
import type { AppRouter } from '../server/index';
import { transformer } from '../shared/transformer';

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchStreamLink({
      url: '/api',
      transformer,
    }),
  ],
});
