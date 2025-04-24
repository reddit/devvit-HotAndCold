import { z } from 'zod';
import { ChallengeService } from './challenge.js';
import { zodRedditUsername, zoddy } from '@hotandcold/shared/utils/zoddy';
import { ChallengePlayers } from './challengePlayers.js';
import { RedditApiCache } from './redditApiCache.js';
import { GameMode } from '@hotandcold/classic-shared';
import { Context, RedisClient } from '@devvit/public-api';

// Define the shape of the player progress data returned by getPlayerProgress
export type PlayerProgressData = {
  avatar: string | null;
  username: string;
  isPlayer: boolean;
  progress: number;
};

export class ChallengeProgressService {
  readonly #context: Context;
  readonly #redis: RedisClient;
  readonly #challengeService: ChallengeService;

  constructor(context: Context, mode: GameMode) {
    this.#context = context;
    this.#redis = context.redis;
    this.#challengeService = new ChallengeService(this.#redis, mode);
  }

  private getChallengePlayerProgressKey(challenge: number): string {
    // Use the instance method from challengeService
    return `${this.#challengeService.getChallengeKey(challenge)}:players:progress`;
  }

  getPlayerProgress = zoddy(
    z.object({
      // context removed, use this.#context
      challenge: z.number().gt(0),
      username: zodRedditUsername,
      start: z.number().gte(0).optional().default(0),
      stop: z.number().gte(-1).optional().default(10),
      sort: z.enum(['ASC', 'DESC']).optional().default('ASC'),
    }),
    async ({
      challenge,
      sort,
      start,
      stop,
      username,
    }: {
      challenge: number;
      sort: 'ASC' | 'DESC';
      start: number;
      stop: number;
      username: string;
    }): Promise<PlayerProgressData[]> => {
      const key = this.getChallengePlayerProgressKey(challenge);
      const result = await this.#redis.zRange(key, start, stop, {
        by: 'score',
        reverse: sort === 'DESC',
      });

      if (!result) {
        throw new Error(`No leaderboard found challenge ${challenge}`);
      }

      const players = await ChallengePlayers.getSome({
        redis: this.#redis,
        challenge,
        usernames: result.map((x) => x.member),
      });

      // Filter out people who give up and people who haven't started
      const results: PlayerProgressData[] = result
        .filter((x) => x.score > 1)
        .map((x) => {
          const player = players[x.member];

          return {
            avatar: player?.avatar ?? null,
            username: x.member,
            isPlayer: x.member === username,
            progress: x.score,
          };
        });

      // If the user hasn't guessed yet, append it so they see themselves on the
      // meter. Don't save it because that will happen when they save and we
      // only want to see it in the UI.
      if (results.some((x) => x.isPlayer) === false) {
        // Sometimes users won't be in the returned sample so we do a check here to see if they have a score
        const score = await this.#redis.zScore(key, username);

        const avatar = await RedditApiCache.getSnoovatarCached({
          context: this.#context,
          username,
        });

        results.push({
          avatar: avatar ?? null,
          username: username,
          isPlayer: true,
          // Default to 0 (this means they have not started)
          progress: score ?? 0,
        });
      }

      return results;
    }
  );

  upsertEntry = zoddy(
    z.object({
      // redis removed, use this.#redis
      challenge: z.number().gt(0),
      username: zodRedditUsername,
      // -1 means gave up
      progress: z.number().gte(-1).lte(100),
    }),
    async ({
      challenge,
      username,
      progress,
    }: {
      challenge: number;
      username: string;
      progress: number;
    }) => {
      await this.#redis.zAdd(this.getChallengePlayerProgressKey(challenge), {
        member: username,
        score: progress,
      });
    }
  );
}
