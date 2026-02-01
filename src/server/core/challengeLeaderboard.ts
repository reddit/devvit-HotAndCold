import { z } from 'zod';
import { redis } from '@devvit/web/server';
import { fn } from '../../shared/fn';

export namespace ChallengeLeaderboard {
  export const ScoreKey = (challengeNumber: number) =>
    `challenge:${challengeNumber}:leaderboard:score` as const;

  export const FastestKey = (challengeNumber: number) =>
    `challenge:${challengeNumber}:leaderboard:fastest` as const;

  export const getLeaderboardByScore = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      start: z.number().gte(0).optional().default(0),
      stop: z.number().gte(-1).optional().default(10),
      sort: z.enum(['ASC', 'DESC']).optional().default('DESC'),
    }),
    async ({ challengeNumber, sort, start, stop }) => {
      const result = await redis.zRange(ScoreKey(challengeNumber), start, stop, {
        by: 'rank',
        reverse: sort === 'DESC',
      });

      if (!result || result.length === 0) {
        throw new Error(`No leaderboard found challenge ${challengeNumber}`);
      }
      return result;
    }
  );

  export const getLeaderboardByFastest = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      start: z.number().gte(0).optional().default(0),
      stop: z.number().gte(-1).optional().default(10),
      sort: z.enum(['ASC', 'DESC']).optional().default('DESC'),
    }),
    async ({ challengeNumber, sort, start, stop }) => {
      // For fastest completion time, lower is better.
      // Keep external API consistent where 'DESC' means "best to worst".
      // Therefore, for fastest we should NOT reverse when sort is 'DESC'.
      const result = await redis.zRange(FastestKey(challengeNumber), start, stop, {
        by: 'rank',
        reverse: sort === 'ASC',
      });

      if (!result || result.length === 0) {
        throw new Error(`No leaderboard found challenge ${challengeNumber}`);
      }
      return result;
    }
  );

  export const addEntry = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      username: z.string(),
      score: z.number().gte(0),
      timeToCompleteMs: z.number().gte(0),
    }),
    async ({ challengeNumber, username, score, timeToCompleteMs }) => {
      await redis.zAdd(ScoreKey(challengeNumber), {
        member: username,
        score,
      });
      await redis.zAdd(FastestKey(challengeNumber), {
        member: username,
        score: timeToCompleteMs,
      });
    }
  );

  /**
   * Return 0 based! (0 is the best)
   *
   * I d
   */
  export const getRankingsForMember = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      username: z.string(),
    }),
    async ({ challengeNumber, username }) => {
      const totalPlayersOnLeaderboard = await redis.zCard(ScoreKey(challengeNumber));

      const scoreRank = await redis.zRank(ScoreKey(challengeNumber), username);
      const fastestRank = await redis.zRank(FastestKey(challengeNumber), username);

      // 0-based where 0 is best:
      // - Score leaderboard stores higher score as better, but zRank is ascending by score.
      //   So convert to reverse-rank: (N - 1) - rank.
      // - Fastest leaderboard stores lower time as better; zRank already returns 0 for best.
      const scoreZeroBest =
        scoreRank == null
          ? totalPlayersOnLeaderboard
          : Math.max(0, totalPlayersOnLeaderboard - 1 - scoreRank);
      const timeZeroBest = fastestRank == null ? totalPlayersOnLeaderboard : fastestRank;

      return {
        score: scoreZeroBest,
        timeToSolve: timeZeroBest,
      };
    }
  );
}
