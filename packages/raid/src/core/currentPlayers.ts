import { zodContext, zoddy } from '@hotandcold/shared/utils/zoddy';
import { Challenge } from './challenge.js';
import { z } from 'zod';

export namespace CurrentPlayers {
  const currentPlayersKey = (challenge: number) =>
    `${Challenge.getChallengeKey(challenge)}:currentPlayers`;

  export const incrementPlayers = zoddy(
    z.object({
      challenge: z.number(),
      context: zodContext,
    }),
    async ({ challenge, context }) => context.redis.incrBy(currentPlayersKey(challenge), 1)
  );

  export const decrementPlayers = zoddy(
    z.object({
      challenge: z.number(),
      context: zodContext,
    }),
    async ({ challenge, context }) => context.redis.incrBy(currentPlayersKey(challenge), -1)
  );
}
