import { z } from 'zod';
import { zoddy, zodRedditUsername } from '@hotandcold/shared/utils/zoddy';
import { ChallengeService } from './challenge.js';
import { GameMode } from '@hotandcold/classic-shared';
import { RedisClient } from '@devvit/public-api';

export * as ChallengePlayers from './challengePlayers.js';

const playersSchema = z.record(
  z.string(),
  z.object({
    avatar: z.string().nullable(),
  })
);

export class ChallengePlayersService {
  readonly #challengeService: ChallengeService;

  constructor(
    private readonly redis: RedisClient,
    mode: GameMode
  ) {
    this.#challengeService = new ChallengeService(redis, mode);
  }

  getChallengePlayersKey(challenge: number) {
    return `${this.#challengeService.getChallengeKey(challenge)}:players` as const;
  }

  setPlayer = zoddy(
    z.object({
      username: zodRedditUsername,
      avatar: z.string().nullable(),
      challenge: z.number().gt(0),
    }),
    async ({ username, avatar, challenge }) => {
      return await this.redis.hSet(this.getChallengePlayersKey(challenge), {
        [username]: JSON.stringify({ avatar }),
      });
    }
  );

  getSome = zoddy(
    z.object({
      challenge: z.number().gt(0),
      usernames: z.array(z.string()),
    }),
    async ({ challenge, usernames }) => {
      if (usernames.length === 0) return {};

      const items = await this.redis.hMGet(this.getChallengePlayersKey(challenge), usernames);

      const players: Record<string, string | null> = {};

      items.forEach((raw, index) => {
        players[usernames[index]] = JSON.parse(raw ?? '{}') as (typeof players)['string'];
      });

      return playersSchema.parse(players);
    }
  );
}
