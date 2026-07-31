import { createDevvitTest } from '@devvit/test/server/vitest';

export const test = createDevvitTest({
  settings: {
    flairId: 'foo',
    GOOGLE_API_KEY: 'foo',
  },
});
