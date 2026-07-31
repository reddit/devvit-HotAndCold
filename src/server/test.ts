import { createDevvitTest } from '@devvit/test/server/vitest';

export const test = createDevvitTest({
  settings: {
    flairId: 'foo',
    OPEN_AI_API_KEY: 'foo',
  },
});
