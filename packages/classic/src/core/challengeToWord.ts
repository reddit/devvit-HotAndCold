import { z } from 'zod';
import { zoddy } from '@hotandcold/shared/utils/zoddy';
import { RedisClient } from '@devvit/public-api';
import { GameMode } from '@hotandcold/classic-shared';

export class ChallengeToWordService {
  private redisKey: string;
  private static readonly BASE_KEY = 'challenge_to_word';

  constructor(
    private redis: RedisClient,
    mode: GameMode
  ) {
    this.redisKey =
      mode === 'regular'
        ? ChallengeToWordService.BASE_KEY
        : `hc:${ChallengeToWordService.BASE_KEY}`;
  }

  setChallengeNumberForWord = zoddy(
    z.object({
      challenge: z.number().gt(0),
      word: z.string().trim(),
    }),
    async ({ challenge, word }) => {
      await this.redis.zAdd(this.redisKey, {
        member: word,
        score: challenge,
      });
    }
  );

  getAllUsedWords = zoddy(z.object({}), async () => {
    const words = await this.redis.zRange(this.redisKey, 0, -1);

    return words.map((word) => word.member);
  });
}
