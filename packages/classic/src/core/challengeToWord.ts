import { z } from 'zod';
import { zoddy } from '@hotandcold/shared/utils/zoddy';
import { RedisClient } from '@devvit/public-api';
import { Mode } from '@hotandcold/classic-shared';

// Original to make it super explicit since we might let people play the archive on any postId
const getChallengeToWord = () => `challenge_to_word` as const;

export class ChallengeToWordService {
  constructor(
    private redis: RedisClient,
    private mode: Mode
  ) {}

  setChallengeNumberForWord = zoddy(
    z.object({
      challenge: z.number().gt(0),
      word: z.string().trim(),
    }),
    async ({ challenge, word }) => {
      await this.redis.zAdd(getChallengeToWord(), {
        member: word,
        score: challenge,
      });
    }
  );

  getAllUsedWords = zoddy(z.object({}), async () => {
    const words = await this.redis.zRange(getChallengeToWord(), 0, -1);

    return words.map((word) => word.member);
  });
}
