import { z } from 'zod';
import { zoddy, zodRedis } from '@hotandcold/shared/utils/zoddy';
import { RedisClient } from '@devvit/public-api';
import { GameMode } from '@hotandcold/classic-shared';

export * as ChallengeToPost from './challengeToPost.js';

// Original to make it super explicit since we might let people play the archive on any postId
const getChallengeToOriginalPostKey = () => `challenge_to_original_post` as const;

// TODO: this should also be returning whether the post is hardcore or not.
export const getChallengeNumberForPost = zoddy(
  z.object({
    redis: zodRedis,
    postId: z.string().trim(),
  }),
  async ({ redis, postId }) => {
    const challengeNumber = await redis.zScore(getChallengeToOriginalPostKey(), postId);

    if (!challengeNumber) {
      throw new Error('No challenge number found for post. Did you mean to create one?');
    }
    return challengeNumber;
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

  setChallengeNumberForPost = zoddy(
    z.object({
      challenge: z.number().gt(0),
      postId: z.string().trim(),
    }),
    async ({ challenge, postId }) => {
      await this.redis.zAdd(getChallengeToOriginalPostKey(), {
        member: postId,
        score: challenge,
      });
    }
  );
}
