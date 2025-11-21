import { context } from '@devvit/web/client';

export const isLoggedOut = () => {
  return context.userId == null;
};
