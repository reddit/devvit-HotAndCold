import { z } from 'zod';
import { fn } from '../../shared/fn';
import { reddit } from '@devvit/web/server';

export namespace SpoilerGuard {
  export const revealsSecret = fn(
    z.object({ text: z.string(), secretWord: z.string().trim().toLowerCase() }),
    async ({ text, secretWord }) => {
      const lower = text.toLowerCase();
      const withoutSpoilers = lower.replace(/>!([\s\S]*?)!</g, ' ');
      const haystack = withoutSpoilers;
      const escaped = secretWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i');
      return re.test(haystack);
    }
  );

  export const checkAndRemoveIfNeeded = fn(
    z.object({
      commentId: z.string(),
      text: z.string(),
      secretWord: z.string().trim().toLowerCase(),
    }),
    async ({ commentId, text, secretWord }) => {
      const isSpoiler = await revealsSecret({ text, secretWord });
      if (isSpoiler) {
        await reddit.remove(commentId as any, false);
        return { removed: true as const };
      }
      return { removed: false as const };
    }
  );
}
