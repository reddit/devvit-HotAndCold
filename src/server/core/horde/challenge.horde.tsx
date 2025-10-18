import { z } from 'zod';
import { fn } from '../../../shared/fn';
import { redis, reddit, Post, settings, context } from '@devvit/web/server';
import { HordeWordQueue } from './wordQueue.horde';
import { getWordConfigCached } from '../api';
import { HordeGuess } from './guess.horde';
import type { HordeMessage } from '../../../shared/realtime.horde';

const ChallengeStatusSchema = z.enum(['running', 'lost', 'won']);

const WordListSchema = z.array(z.string().min(1)).min(1);

const WaveClearSchema = z.object({
  wave: z.number().int().min(1),
  username: z.string(),
  snoovatar: z.string().url().optional(),
  word: z.string(),
  clearedAtMs: z.number().int().min(0),
});
export type HordeWaveClear = z.infer<typeof WaveClearSchema>;

const RawWaveClearSchema = WaveClearSchema.partial({ wave: true });
const WaveClearListSchema = z
  .array(RawWaveClearSchema)
  .transform((list): HordeWaveClear[] =>
    list
      .map((entry, idx) =>
        WaveClearSchema.parse({
          ...entry,
          wave: entry.wave ?? idx + 1,
        })
      )
      .sort((a, b) => a.wave - b.wave)
  );

const WinnerListValueSchema = z.union([z.string(), z.null()]);
const WinnerListSchema = z
  .array(WinnerListValueSchema)
  .transform((list): Array<string | null> =>
    list.map((value) => (typeof value === 'string' && value.length > 0 ? value : null))
  );
type WinnerList = z.infer<typeof WinnerListSchema>;

const ChallengeFieldSchemas = {
  words: WordListSchema,
  totalPlayers: z.number().int().min(0),
  totalGuesses: z.number().int().min(0),
  currentHordeLevel: z.number().int().min(1),
  timeRemainingMs: z.number().int().min(0),
  lastTickMs: z.number().int().min(0).optional(),
  winners: WinnerListSchema,
  waveClears: WaveClearListSchema,
  status: ChallengeStatusSchema.optional(),
} as const;

const ChallengeRecordSchema = z.object({
  challengeNumber: z.number().int().min(1),
  ...ChallengeFieldSchemas,
});
export type HordeChallengeRecord = z.infer<typeof ChallengeRecordSchema>;

const ChallengeConfigSchema = z.object({
  words: ChallengeFieldSchemas.words,
  totalPlayers: ChallengeFieldSchemas.totalPlayers.optional().default(0),
  totalGuesses: ChallengeFieldSchemas.totalGuesses.optional().default(0),
  currentHordeLevel: ChallengeFieldSchemas.currentHordeLevel.optional().default(1),
  timeRemainingMs: ChallengeFieldSchemas.timeRemainingMs.optional().default(0),
  lastTickMs: ChallengeFieldSchemas.lastTickMs,
  winners: ChallengeFieldSchemas.winners.optional().default([]),
  waveClears: ChallengeFieldSchemas.waveClears.optional().default([]),
  status: ChallengeFieldSchemas.status,
});
type ChallengeConfig = z.infer<typeof ChallengeConfigSchema>;
export type HordeChallengeConfig = ChallengeConfig;

const parseRedisInt = (field: string, min: number) =>
  z
    .union([z.string(), z.number()])
    .transform((value, ctx) => {
      const parsed =
        typeof value === 'number'
          ? value
          : Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid ${field} value: ${String(value)}`,
        });
        return z.NEVER;
      }
      return parsed;
    })
    .pipe(z.number().int().min(min));

const parseOptionalRedisInt = (field: string, min: number, fallback: number) =>
  parseRedisInt(field, min)
    .optional()
    .transform((value) => (value === undefined ? fallback : value));

const parseRedisJson = <Schema extends z.ZodTypeAny>(field: string, schema: Schema) =>
  z
    .union([z.string(), schema])
    .transform((value, ctx) => {
      if (typeof value === 'string') {
        try {
          return JSON.parse(value) as unknown;
        } catch (error) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Failed to parse ${field} JSON: ${(error as Error).message}`,
          });
          return z.NEVER;
        }
      }
      return value;
    })
    .pipe(schema);

const parseOptionalRedisJson = <Schema extends z.ZodTypeAny>(
  field: string,
  schema: Schema,
  fallback: () => z.output<Schema>
) =>
  parseRedisJson(field, schema)
    .optional()
    .transform((value) => (value === undefined ? fallback() : value));

const RedisWinnerListSchema = parseOptionalRedisJson('winners', WinnerListSchema, () => []);
const RedisWaveClearListSchema = parseOptionalRedisJson('waveClears', WaveClearListSchema, () => []);
const RedisWordListSchema = parseRedisJson('words', WordListSchema);

const parseWinnersFromRedis = (raw?: string | null): WinnerList =>
  RedisWinnerListSchema.parse(raw ?? undefined);

const parseWaveClearsFromRedis = (raw?: string | null): HordeWaveClear[] =>
  RedisWaveClearListSchema.parse(raw ?? undefined);

const ChallengeRedisRecordSchema = z
  .object({
    challengeNumber: parseRedisInt('challengeNumber', 1),
    words: RedisWordListSchema,
    totalPlayers: parseOptionalRedisInt('totalPlayers', 0, 0),
    totalGuesses: parseOptionalRedisInt('totalGuesses', 0, 0),
    currentHordeLevel: parseOptionalRedisInt('currentHordeLevel', 1, 1),
    timeRemainingMs: parseOptionalRedisInt('timeRemainingMs', 0, 0),
    lastTickMs: parseRedisInt('lastTickMs', 0).optional(),
    winners: RedisWinnerListSchema,
    waveClears: RedisWaveClearListSchema,
    status: ChallengeStatusSchema.optional(),
  })
  .passthrough()
  .transform((value) =>
    ChallengeRecordSchema.parse({
      challengeNumber: value.challengeNumber,
      words: value.words,
      totalPlayers: value.totalPlayers,
      totalGuesses: value.totalGuesses,
      currentHordeLevel: value.currentHordeLevel,
      timeRemainingMs: value.timeRemainingMs,
      lastTickMs: value.lastTickMs,
      winners: value.winners,
      waveClears: value.waveClears,
      status: value.status,
    })
  );

const normalizeChallengeRecord = (raw: Record<string, unknown>): HordeChallengeRecord =>
  ChallengeRedisRecordSchema.parse(raw);

const serializeWinners = (winners: WinnerList): string =>
  JSON.stringify(WinnerListSchema.parse(winners.map((value) => value ?? null)));

const serializeWaveClears = (waveClears: ReadonlyArray<HordeWaveClear>): string =>
  JSON.stringify(WaveClearListSchema.parse([...waveClears]));

const toRedisPayload = (record: HordeChallengeRecord): Record<string, string> => {
  const payload: Record<string, string> = {
    challengeNumber: String(record.challengeNumber),
    words: JSON.stringify(record.words),
    totalPlayers: String(record.totalPlayers),
    totalGuesses: String(record.totalGuesses),
    currentHordeLevel: String(record.currentHordeLevel),
    timeRemainingMs: String(record.timeRemainingMs),
    winners: serializeWinners(record.winners),
    waveClears: serializeWaveClears(record.waveClears),
  };

  if (record.lastTickMs != null) payload.lastTickMs = String(record.lastTickMs);
  if (record.status) payload.status = record.status;

  return payload;
};

const serializeChallengeConfig = (
  challengeNumber: number,
  config: ChallengeConfig
): Record<string, string> => {
  const parsed = ChallengeConfigSchema.parse(config);
  const record = ChallengeRecordSchema.parse({
    challengeNumber,
    ...parsed,
  });
  return toRedisPayload(record);
};

export namespace Challenge {
  export type Record = HordeChallengeRecord;
  export type Config = HordeChallengeConfig;
  // Compute game status from current counters in a single place (DRY)
  export function computeStatus(args: {
    timeRemainingMs: number;
    currentHordeLevel: number;
    totalWaves: number;
  }): 'running' | 'lost' | 'won' {
    const { timeRemainingMs, currentHordeLevel, totalWaves } = args;
    // If all waves have been cleared, the game is won regardless of timer
    if (currentHordeLevel > totalWaves) return 'won';
    if (timeRemainingMs > 0) return 'running';
    return 'lost';
  }
  // Shared builder to keep postData in sync everywhere it's set (HORDE version)
  export const makePostData = ({
    challengeNumber,
    totalPlayers,
    totalGuesses,
    currentHordeLevel,
    timeRemainingMs,
  }: {
    challengeNumber: number;
    totalPlayers: number;
    totalGuesses: number;
    currentHordeLevel: number;
    timeRemainingMs: number;
  }) => {
    return {
      challengeNumber,
      totalPlayers,
      totalGuesses,
      currentHordeLevel,
      timeRemainingMs,
      mode: 'horde',
    } as const;
  };
  export const CurrentChallengeNumberKey = () => 'horde:current_challenge_number' as const;

  export const ChallengeKey = (challengeNumber: number) =>
    `horde:challenge:${challengeNumber}` as const;
  export const ChallengePostIdKey = (challengeNumber: number) =>
    `horde:challenge:${challengeNumber}:postId` as const;

  export const getCurrentChallengeNumber = fn(z.void(), async () => {
    const currentChallengeNumber = await redis.get(Challenge.CurrentChallengeNumberKey());

    if (!currentChallengeNumber) {
      // Default to 0 if not set
      return 0;
    }

    return parseInt(currentChallengeNumber);
  });

  export const incrementCurrentChallengeNumber = fn(z.void(), async () => {
    await redis.incrBy(Challenge.CurrentChallengeNumberKey(), 1);
  });

  export const setCurrentChallengeNumber = fn(
    z.object({
      number: z.number().gt(0),
    }),
    async ({ number }) => {
      await redis.set(Challenge.CurrentChallengeNumberKey(), number.toString());
    }
  );

  export const getChallenge = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      const result = await redis.hGetAll(Challenge.ChallengeKey(challengeNumber));

      if (!result || Object.keys(result).length === 0) {
        throw new Error('No challenge found');
      }
      return normalizeChallengeRecord(result);
    }
  );

  export const setChallenge = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      config: ChallengeConfigSchema,
    }),
    async ({ challengeNumber, config }) => {
      const payload = serializeChallengeConfig(challengeNumber, config);
      await redis.hSet(Challenge.ChallengeKey(challengeNumber), payload);
    }
  );

  export const setPostIdForChallenge = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      postId: z.string(),
    }),
    async ({ challengeNumber, postId }) => {
      await redis.set(ChallengePostIdKey(challengeNumber), postId);
    }
  );

  export const getPostIdForChallenge = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      const postId = await redis.get(ChallengePostIdKey(challengeNumber));
      return postId ?? null;
    }
  );

  export const initialize = fn(z.void(), async () => {
    const result = await redis.get(Challenge.CurrentChallengeNumberKey());
    if (!result) {
      await redis.set(Challenge.CurrentChallengeNumberKey(), '0');
    } else {
      console.log('Challenge key already initialized');
    }
  });

  export const incrementChallengeTotalPlayers = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      await redis.hIncrBy(Challenge.ChallengeKey(challengeNumber), 'totalPlayers', 1);
    }
  );

  export const incrementChallengeTotalGuesses = fn(
    z.object({
      challengeNumber: z.number().gt(0),
    }),
    async ({ challengeNumber }) => {
      await redis.hIncrBy(Challenge.ChallengeKey(challengeNumber), 'totalGuesses', 1);
    }
  );

  export const setCurrentHordeLevel = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      level: z.number().int().min(1),
    }),
    async ({ challengeNumber, level }) => {
      await redis.hSet(Challenge.ChallengeKey(challengeNumber), {
        currentHordeLevel: String(level),
      });
    }
  );

  export const incrementTimeRemaining = fn(
    z.object({ challengeNumber: z.number().gt(0), deltaMs: z.number().int() }),
    async ({ challengeNumber, deltaMs }) => {
      const key = Challenge.ChallengeKey(challengeNumber);
      const current = await redis.hGet(key, 'timeRemainingMs');
      const now = Number.parseInt(String(current ?? '0'), 10) || 0;
      const next = Math.max(0, now + deltaMs);
      await redis.hSet(key, { timeRemainingMs: String(next) });
      return next;
    }
  );

  export const appendWinner = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      wave: z.number().int().min(1),
      username: z.string(),
    }),
    async ({ challengeNumber, wave, username }) => {
      const key = Challenge.ChallengeKey(challengeNumber);
      const current = parseWinnersFromRedis(await redis.hGet(key, 'winners'));
      const next = [...current];
      const targetIndex = Math.max(0, wave - 1);
      while (next.length <= targetIndex) next.push(null);
      if (!next[targetIndex]) next[targetIndex] = username;
      const normalized = WinnerListSchema.parse(next);
      await redis.hSet(key, { winners: serializeWinners(normalized) });
      return normalized;
    }
  );

  export const appendWaveClear = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      wave: z.number().int().min(1),
      username: z.string(),
      snoovatar: z.string().url().optional(),
      word: z.string(),
      clearedAtMs: z.number().int().min(0),
    }),
    async ({ challengeNumber, wave, username, snoovatar, word, clearedAtMs }) => {
      const key = Challenge.ChallengeKey(challengeNumber);
      const existing = parseWaveClearsFromRedis(await redis.hGet(key, 'waveClears'));
      const next = [...existing];
      const entry = WaveClearSchema.parse({
        wave,
        username,
        snoovatar,
        word,
        clearedAtMs,
      });
      const existingIndex = next.findIndex((item) => item.wave === wave);
      if (existingIndex >= 0) next[existingIndex] = entry;
      else next.push(entry);
      const normalized = next.sort((a, b) => a.wave - b.wave);
      await redis.hSet(key, {
        waveClears: serializeWaveClears(normalized),
      });
      return normalized;
    }
  );

  export const setStatus = fn(
    z.object({ challengeNumber: z.number().gt(0), status: ChallengeStatusSchema }),
    async ({ challengeNumber, status }) => {
      await redis.hSet(Challenge.ChallengeKey(challengeNumber), { status });
      return status;
    }
  );

  export const setTimeRemainingMs = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      timeRemainingMs: z.number().int().min(0),
    }),
    async ({ challengeNumber, timeRemainingMs }) => {
      await redis.hSet(Challenge.ChallengeKey(challengeNumber), {
        timeRemainingMs: String(timeRemainingMs),
      });
    }
  );

  export const tickTimeRemaining = fn(
    z.object({ challengeNumber: z.number().gt(0) }),
    async ({ challengeNumber }) => {
      const key = Challenge.ChallengeKey(challengeNumber);
      const [timeStr, lastStr, status] = await Promise.all([
        redis.hGet(key, 'timeRemainingMs'),
        redis.hGet(key, 'lastTickMs'),
        redis.hGet(key, 'status'),
      ]);
      // Freeze timer once the game is won
      if ((status ?? '') === 'won') {
        const current = Number.parseInt(String(timeStr ?? '0'), 10) || 0;
        return current;
      }
      const now = Date.now();
      const last = Number.parseInt(String(lastStr ?? '0'), 10) || now;
      const delta = Math.max(0, now - last);
      const current = Number.parseInt(String(timeStr ?? '0'), 10) || 0;
      const next = Math.max(0, current - delta);
      await redis.hSet(key, { timeRemainingMs: String(next), lastTickMs: String(now) });
      return next;
    }
  );

  // Build a full game_update message for realtime or initial hydration
  type HordeGameUpdateMessage = Extract<HordeMessage, { type: 'game_update' }>;

  export const buildGameUpdateMessage = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      // Tick time remaining as part of building the message (used by scheduler)
      tick: z.boolean().optional().default(false),
      // Persist transition to 'lost' if detected (used by scheduler)
      persistLost: z.boolean().optional().default(false),
    }),
    async ({ challengeNumber, tick, persistLost }): Promise<HordeGameUpdateMessage> => {
      const challenge = await getChallenge({ challengeNumber });
      const remaining = tick
        ? await tickTimeRemaining({ challengeNumber })
        : challenge.timeRemainingMs;

      const currentWave = challenge.currentHordeLevel;
      const totalWaves = challenge.words.length;
      const topWave = await HordeGuess.getWaveTopByRank({
        challengeNumber,
        wave: currentWave,
        limit: 50,
      });
      const topGuessersRaw = await HordeGuess.topGuessers({ challengeNumber, limit: 20 });
      const topHordeGuessers = topGuessersRaw.map((r) => ({
        username: r.member,
        count: r.score,
        ...(r.snoovatar ? { snoovatar: r.snoovatar } : {}),
      }));

      // Prefer persisted 'won' status to avoid regressions if time hits 0 later
      let status = computeStatus({
        timeRemainingMs: remaining,
        currentHordeLevel: currentWave,
        totalWaves,
      });
      if (challenge.status === 'won') status = 'won';

      if (persistLost && status === 'lost' && challenge.status !== 'lost') {
        try {
          await setStatus({ challengeNumber, status: 'lost' });
        } catch (e) {
          console.error('Failed to persist lost status for horde', e);
        }
      }

      const payload: HordeGameUpdateMessage = {
        type: 'game_update',
        update: {
          challengeNumber,
          totalPlayers: challenge.totalPlayers,
          totalGuesses: challenge.totalGuesses,
          currentHordeWave: currentWave,
          timeRemainingMs: remaining,
          hordeStatus: status,
          totalWaves,
          waves: challenge.waveClears.map(({ wave, username, snoovatar, word, clearedAtMs }) => ({
            wave,
            username,
            word,
            clearedAtMs,
            ...(snoovatar ? { snoovatar } : {}),
          })),
          currentWaveTopGuesses: topWave,
          topHordeGuessers,
        },
      };
      return payload;
    }
  );

  export const makeNewChallenge = fn(z.void(), async () => {
    console.log('Making new challenge...');
    const [currentChallengeNumber, currentSubreddit] = await Promise.all([
      getCurrentChallengeNumber(),
      reddit.getCurrentSubreddit(),
    ]);

    const newChallengeNumber = currentChallengeNumber + 1;

    console.log('New challenge number:', newChallengeNumber);

    let post: Post | undefined;

    // Pull the next set of words for HORDE mode
    const newWords = (await HordeWordQueue.shift())?.words;
    if (!newWords) {
      throw new Error('No more words available for new challenge. Need to add more to the list!');
    }

    try {
      // Preload all words for fast lookups
      await Promise.all(newWords.map((w) => getWordConfigCached({ word: w })));

      post = await reddit.submitCustomPost({
        subredditName: currentSubreddit.name,
        title: `Hot and Cold Horde #${newChallengeNumber}`,

        splash: {
          entry: 'horde',
          appDisplayName: 'Hot and Cold',
          backgroundUri: 'transparent.png',
        },
        postData: makePostData({
          challengeNumber: newChallengeNumber,
          totalPlayers: 0,
          totalGuesses: 0,
          currentHordeLevel: 1,
          timeRemainingMs: 600000,
        }),
      });

      // Pin the how-to-play comment
      try {
        const comment = await reddit.submitComment({
          id: post.id,
          text: `Welcome to Hot and Cold HORDE – the co-op word hunt!\n\nHow it works:\n- Work together to guess multiple secret words across waves.\n- Each guess returns a rank: smaller number = closer.\n- New waves unlock as you progress; the timer keeps counting down.\n\nExample (for one secret word):\nbanana → #12956 (cold)\nsun → #493 (warmer)\nhotdog → #220 (hot)\ncold → #42 (hot)\nwarm → #15 (very hot!)\n\nTip: Antonyms and related concepts can be “close” because AI models consider relationships, not just synonyms.\n\nHave fun! Share feedback so we can keep improving the horde mode!`,
        });
        await comment.distinguish(true);
      } catch (error) {
        // This is bugged as of 10/8 but maybe for only playtesting?
        console.error('Error pinning how-to-play comment:', error);
      }

      await setChallenge({
        challengeNumber: newChallengeNumber,
        config: {
          words: newWords,
          totalPlayers: 0,
          totalGuesses: 0,
          currentHordeLevel: 1,
          timeRemainingMs: 600_000,
          lastTickMs: Date.now(),
          winners: [],
          waveClears: [],
          status: 'running',
        },
      });

      await setPostIdForChallenge({ challengeNumber: newChallengeNumber, postId: post.id });

      await setCurrentChallengeNumber({ number: newChallengeNumber });

      console.log(
        'New challenge created:',
        'New Challenge Number:',
        newChallengeNumber,
        'New words:',
        JSON.stringify(newWords),
        'Post ID:',
        post.id
      );

      const flairId = await settings.get<string>('hordeFlairId');
      if (flairId) {
        await reddit.setPostFlair({
          postId: post.id,
          subredditName: context.subredditName!,
          flairTemplateId: flairId,
        });
      } else {
        console.warn('No flair ID configured, skipping...');
      }

      return {
        postId: post.id,
        postUrl: post.url,
        challenge: newChallengeNumber,
        words: newWords,
      };
    } catch (error) {
      console.error('Error making new challenge:', error);

      // If the transaction fails, remove the post if created
      if (post) {
        console.log(`Removing post ${post.id} due to new challenge error`);
        await reddit.remove(post.id, false);
      }

      throw error;
    }
  });

  export const exportLast30Days = fn(z.void(), async () => {
    const currentChallengeNumber = await getCurrentChallengeNumber();

    // Assume roughly 1 challenge per day and get last 30 challenges
    // If there are gaps in challenge numbers, we'll filter them out
    const startChallengeNumber = Math.max(1, currentChallengeNumber - 30);
    const challengeNumbers = Array.from(
      { length: currentChallengeNumber - startChallengeNumber + 1 },
      (_, i) => startChallengeNumber + i
    );

    // Query all challenges in the range
    const challenges = await Promise.all(
      challengeNumbers.map(async (challengeNumber) => {
        try {
          const challenge = await getChallenge({ challengeNumber });
          return {
            challengeNumber: challenge.challengeNumber,
            words: challenge.words,
            totalPlayers: challenge.totalPlayers,
            totalGuesses: challenge.totalGuesses,
            currentHordeLevel: challenge.currentHordeLevel,
            timeRemainingMs: challenge.timeRemainingMs,
          };
        } catch (error) {
          console.error('Error getting challenge for stat export:', error);
          // Challenge doesn't exist, skip it
          return null;
        }
      })
    );

    // Filter out null challenges and sort by challenge number (newest first)
    const validChallenges = challenges
      .filter((challenge): challenge is NonNullable<typeof challenge> => challenge !== null)
      .sort((a, b) => b.challengeNumber - a.challengeNumber);

    return validChallenges;
  });

  // Updates postData for the most recent N challenges (including current)
  export const updatePostDataForRecentChallenges = fn(z.void(), async () => {
    const current = await getCurrentChallengeNumber();
    if (current <= 0) return { updated: 0 } as const;

    const maxToUpdate = 10;
    let updated = 0;

    for (let i = 0; i < maxToUpdate; i++) {
      const challengeNumber = current - i;
      if (challengeNumber <= 0) break;

      try {
        const postId = await getPostIdForChallenge({ challengeNumber });
        if (!postId) continue;

        // Load latest counters for this challenge
        const c = await getChallenge({ challengeNumber });
        const totalPlayers = c.totalPlayers;
        const totalGuesses = c.totalGuesses;
        const currentHordeLevel = c.currentHordeLevel;
        const timeRemainingMs = c.timeRemainingMs;

        const post = await reddit.getPostById(postId as any);
        await post.setPostData(
          makePostData({
            challengeNumber,
            totalPlayers,
            totalGuesses,
            currentHordeLevel,
            timeRemainingMs,
          })
        );
        updated++;
      } catch (err) {
        console.error('Failed to update postData for challenge', challengeNumber, err);
        // continue with the rest
      }
    }

    return { updated } as const;
  });
}
