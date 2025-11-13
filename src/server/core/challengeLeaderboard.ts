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
      const hasRangeLimit = stop >= 0;
      const normalizedStop = hasRangeLimit ? stop : -1;

      const initialEntries = await redis.zRange(ScoreKey(challengeNumber), 0, normalizedStop, {
        by: 'rank',
        reverse: sort === 'DESC',
      });

      if (!initialEntries || initialEntries.length === 0) {
        throw new Error(`No leaderboard found challenge ${challengeNumber}`);
      }

      let entries = initialEntries;

      if (hasRangeLimit && initialEntries.length > 0) {
        const boundaryIndex = sort === 'DESC' ? initialEntries.length - 1 : 0;
        const boundaryScore = initialEntries[boundaryIndex]?.score;

        if (typeof boundaryScore === 'number') {
          const tieGroup = await redis.zRange(
            ScoreKey(challengeNumber),
            boundaryScore,
            boundaryScore,
            {
              by: 'score',
            }
          );

          if (tieGroup.length > 0) {
            const entryMap = new Map(entries.map((entry) => [entry.member, entry]));
            for (const tie of tieGroup) {
              if (!entryMap.has(tie.member)) {
                entryMap.set(tie.member, tie);
              }
            }
            entries = Array.from(entryMap.values());
          }
        }
      }

      const entriesWithTimes = await Promise.all(
        entries.map(async (entry) => {
          const timeScore = await redis.zScore(FastestKey(challengeNumber), entry.member);
          return {
            ...entry,
            timeToCompleteMs: typeof timeScore === 'number' ? timeScore : null,
          };
        })
      );

      entriesWithTimes.sort((a, b) => {
        if (a.score === b.score) {
          const aTime = a.timeToCompleteMs ?? Number.POSITIVE_INFINITY;
          const bTime = b.timeToCompleteMs ?? Number.POSITIVE_INFINITY;
          if (aTime !== bTime) {
            return sort === 'DESC' ? aTime - bTime : bTime - aTime;
          }
          return a.member.localeCompare(b.member);
        }
        return sort === 'DESC' ? b.score - a.score : a.score - b.score;
      });

      const sliceStart = Math.max(start, 0);
      const sliceEnd = hasRangeLimit ? stop + 1 : undefined;
      const sliced =
        sliceEnd != null
          ? entriesWithTimes.slice(sliceStart, sliceEnd)
          : entriesWithTimes.slice(sliceStart);

      if (sliced.length === 0) {
        throw new Error(`No leaderboard found challenge ${challengeNumber}`);
      }

      return sliced;
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

      const [scoreRankAscending, fastestRank] = await Promise.all([
        redis.zRank(ScoreKey(challengeNumber), username),
        redis.zRank(FastestKey(challengeNumber), username),
      ]);

      if (scoreRankAscending == null) {
        return {
          score: totalPlayersOnLeaderboard,
          timeToSolve: fastestRank == null ? totalPlayersOnLeaderboard : fastestRank,
        };
      }

      const playerScore = await redis.zScore(ScoreKey(challengeNumber), username);
      if (playerScore == null) {
        return {
          score: totalPlayersOnLeaderboard,
          timeToSolve: fastestRank == null ? totalPlayersOnLeaderboard : fastestRank,
        };
      }

      const sameScoreGroup = await redis.zRange(
        ScoreKey(challengeNumber),
        playerScore,
        playerScore,
        {
          by: 'score',
        }
      );

      if (sameScoreGroup.length === 0) {
        return {
          score: totalPlayersOnLeaderboard,
          timeToSolve: fastestRank == null ? totalPlayersOnLeaderboard : fastestRank,
        };
      }

      const lexIndex = sameScoreGroup.findIndex((entry) => entry.member === username);
      const normalizedLexIndex = lexIndex >= 0 ? lexIndex : 0;

      const lowerScoreCount = Math.max(0, scoreRankAscending - normalizedLexIndex);
      const higherScoreCount = Math.max(
        0,
        totalPlayersOnLeaderboard - lowerScoreCount - sameScoreGroup.length
      );

      const groupWithTimes = await Promise.all(
        sameScoreGroup.map(async (entry) => {
          const timeScore = await redis.zScore(FastestKey(challengeNumber), entry.member);
          return {
            member: entry.member,
            timeToCompleteMs: typeof timeScore === 'number' ? timeScore : Number.POSITIVE_INFINITY,
          };
        })
      );

      groupWithTimes.sort((a, b) => {
        if (a.timeToCompleteMs === b.timeToCompleteMs) {
          return a.member.localeCompare(b.member);
        }
        return a.timeToCompleteMs - b.timeToCompleteMs;
      });

      const timeIndex = groupWithTimes.findIndex((entry) => entry.member === username);
      const normalizedTimeIndex = timeIndex >= 0 ? timeIndex : groupWithTimes.length - 1;

      const scoreZeroBest = higherScoreCount + Math.max(0, normalizedTimeIndex);
      const timeZeroBest = fastestRank == null ? totalPlayersOnLeaderboard : fastestRank;

      return {
        score: scoreZeroBest,
        timeToSolve: timeZeroBest,
      };
    }
  );
}
