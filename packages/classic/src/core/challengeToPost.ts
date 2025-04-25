import { z } from 'zod';
import { zoddy, zodRedis } from '@hotandcold/shared/utils/zoddy';
import { RedisClient } from '@devvit/public-api';
import { GameMode } from '@hotandcold/classic-shared';

export * as ChallengeToPost from './challengeToPost.js';

// Original to make it super explicit since we might let people play the archive on any postId
const getChallengeToOriginalPostKey = () => `challenge_to_original_post` as const;

// Uniquely identifies a post.
export type PostIdentifier = {
  challenge: number;
  mode: GameMode;
};

export const getChallengeIdentifierForPost = zoddy(
  z.object({
    redis: zodRedis,
    postId: z.string().trim(),
  }),
  async ({ redis, postId }): Promise<PostIdentifier> => {
    const [challengeNumber, mode] = await Promise.all([
      redis.zScore(getChallengeToOriginalPostKey(), postId),
      redis.get(`mode:${postId}`),
    ]);

    if (!challengeNumber) {
      throw new Error('No challenge number found for post. Did you mean to create one?');
    }

    if (!mode) {
      // Prior to the introduction of mode, all puzzles were regular, so assume that for backwards compatibility.
      return { challenge: challengeNumber, mode: 'regular' };
    }

    if (mode !== 'hardcore' && mode !== 'regular') {
      throw new Error(`Invalid mode found for post. Found ${mode}`);
    }

    return {
      challenge: challengeNumber,
      mode: mode,
    };
  }
);

/**
 * There's some asymmetry here - when we're setting the number, we already know via context
 * whether it's hardcore or not, but when we're getting the number, we don't know.
 *
 * So, we keep the setters here, but the getters are in free functions.
 */
export class ChallengeToPostService {
  constructor(
    private redis: RedisClient,
    private mode: GameMode
  ) {}

  setChallengeIdentifierForPost = zoddy(
    z.object({
      challenge: z.number().gt(0),
      postId: z.string().trim(),
    }),
    async ({ challenge, postId }) => {
      await Promise.all([
        this.redis.zAdd(getChallengeToOriginalPostKey(), {
          member: postId,
          score: challenge,
        }),
        this.redis.set(`mode:${postId}`, this.mode),
      ]);
    }
  );
}
