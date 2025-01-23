import { zoddy, zodRedditUsername, zodRedis } from '@hotandcold/shared/utils/zoddy';
import { z } from 'zod';
import { guessSchema } from '../utils/guessSchema.js';

export namespace ChallengeGuesses {
  // Enforces the uniqueness of the guess
  export const challengeGuessesUniqueKey = (challenge: number) =>
    `challenge:${challenge}:unique_guesses` as const;

  // Used for display of the closest guesses
  export const challengeGuessesKey = (challenge: number) =>
    `challenge:${challenge}:guesses` as const;

  const makeUserGuessKey = (username: string, guess: z.infer<typeof guessSchema>) =>
    `${username}:${JSON.stringify(guess)}` as const;

  export const addGuess = zoddy(
    z.object({
      redis: zodRedis,
      challenge: z.number().gt(0),
      username: zodRedditUsername,
      guess: guessSchema,
    }),
    async ({ redis, challenge, username, guess }) => {
      const score = await redis.zScore(challengeGuessesUniqueKey(challenge), guess.word);

      if (!score) {
        await redis.zAdd(challengeGuessesUniqueKey(challenge), { member: guess.word, score: 1 });
        await redis.zAdd(challengeGuessesKey(challenge), {
          member: makeUserGuessKey(username, guess),
          // Raw similarity because it has the highest precision. We only use it for ranking
          score: guess.similarity,
        });
      } else {
        await redis.zIncrBy(challengeGuessesUniqueKey(challenge), guess.word, 1);
      }
    }
  );

  export const mostCommonlyGuessedWords = zoddy(
    z.object({
      redis: zodRedis,
      challenge: z.number().gt(0),
    }),
    async ({ redis, challenge }) => {
      // All words start a 1
      // I'm saying start at two to try to slim up the response
      return await redis.zRange(challengeGuessesUniqueKey(challenge), 0, 24, {
        by: 'rank',
      });
    }
  );

  export const getTopGuessesForChallenge = zoddy(
    z.object({
      redis: zodRedis,
      challenge: z.number().gt(0),
    }),
    async ({ redis, challenge }) => {
      const guesses = await redis.zRange(challengeGuessesKey(challenge), 0, 300, {
        by: 'rank',
      });

      return guesses.map((guess) => {
        const [username, ...guessJSONParts] = guess.member.split(':');

        return {
          ...guessSchema.parse(JSON.parse(guessJSONParts.join(':'))),
          username,
        };
      });
    }
  );
}
