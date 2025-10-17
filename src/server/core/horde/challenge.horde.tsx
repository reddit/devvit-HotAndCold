import { z } from 'zod';
import { redisNumberString } from '../../utils';
import { fn } from '../../../shared/fn';
import { redis, reddit, Post, settings, context } from '@devvit/web/server';
import { HordeWordQueue } from './wordQueue.horde';
import { getWordConfigCached } from '../api';
import { HordeGuess } from './guess.horde';
import type { HordeMessage } from '../../../shared/realtime.horde';

export const stringifyValues = <T extends Record<string, any>>(obj: T): Record<keyof T, string> => {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      // Persist complex values (arrays/objects) as JSON strings so they round‑trip correctly
      if (value !== null && typeof value === 'object') {
        return [key, JSON.stringify(value)];
      }
      return [key, String(value)];
    })
  ) as Record<keyof T, string>;
};

export namespace Challenge {
  // Compute game status from current counters in a single place (DRY)
  export function computeStatus(args: {
    timeRemainingMs: number;
    currentHordeLevel: number;
    totalWaves: number;
  }): 'running' | 'lost' | 'won' {
    const { timeRemainingMs, currentHordeLevel, totalWaves } = args;
    if (timeRemainingMs > 0) {
      return currentHordeLevel > totalWaves ? 'won' : 'running';
    }
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

  // Parsed challenge shape returned by getChallenge
  const challengeSchema = z
    .object({
      challengeNumber: z.string(),
      // Stored in Redis as JSON string; parsed to array here
      words: z
        .string()
        .transform((raw) => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [] as string[];
          }
        })
        .pipe(z.array(z.string().min(1)).min(1)),
      totalPlayers: redisNumberString.optional(),
      totalGuesses: redisNumberString.optional(),
      currentHordeLevel: redisNumberString.optional(),
      timeRemainingMs: redisNumberString.optional(),
      lastTickMs: redisNumberString.optional(),
      winners: z
        .string()
        .transform((raw) => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [] as string[];
          }
        })
        .optional(),
      status: z.string().optional(),
    })
    .strict();

  // Input shape accepted by setChallenge; allows arrays for words
  const challengeInputSchema = z
    .object({
      challengeNumber: z.string(),
      words: z.array(z.string().min(1)).min(1),
      totalPlayers: redisNumberString.optional(),
      totalGuesses: redisNumberString.optional(),
      currentHordeLevel: redisNumberString.optional(),
      timeRemainingMs: redisNumberString.optional(),
      lastTickMs: redisNumberString.optional(),
      winners: z.array(z.string()).optional(),
      status: z.string().optional(),
    })
    .strict();

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

      if (!result) {
        throw new Error('No challenge found');
      }
      return challengeSchema.parse(result);
    }
  );

  export const setChallenge = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      config: challengeInputSchema,
    }),
    async ({ challengeNumber, config }) => {
      await redis.hSet(Challenge.ChallengeKey(challengeNumber), stringifyValues(config));
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
      const raw = (await redis.hGet(key, 'winners')) ?? '[]';
      let arr: string[] = [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) arr = parsed;
      } catch {}
      const idx = Math.max(0, wave - 1);
      if (arr.length <= idx) arr.length = idx + 1;
      if (!arr[idx]) arr[idx] = username;
      await redis.hSet(key, { winners: JSON.stringify(arr) });
      return arr;
    }
  );

  export const setStatus = fn(
    z.object({ challengeNumber: z.number().gt(0), status: z.enum(['running', 'lost', 'won']) }),
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
      const [timeStr, lastStr] = await Promise.all([
        redis.hGet(key, 'timeRemainingMs'),
        redis.hGet(key, 'lastTickMs'),
      ]);
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
        : Number.parseInt(String(challenge.timeRemainingMs ?? '0'), 10) || 0;

      const top = await HordeGuess.getTopByRank({ challengeNumber, limit: 50 });
      const topGuessersRaw = await HordeGuess.topGuessers({ challengeNumber, limit: 20 });
      const topGuessers = topGuessersRaw.map((r) => ({ username: r.member, count: r.score }));

      const status = computeStatus({
        timeRemainingMs: remaining,
        currentHordeLevel: Number.parseInt(String(challenge.currentHordeLevel ?? '1'), 10) || 1,
        totalWaves: Array.isArray(challenge.words) ? challenge.words.length : 0,
      });

      if (persistLost && status === 'lost' && (challenge as any).status !== 'lost') {
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
          totalPlayers: Number.parseInt(String(challenge.totalPlayers ?? '0'), 10) || 0,
          totalGuesses: Number.parseInt(String(challenge.totalGuesses ?? '0'), 10) || 0,
          currentHordeLevel:
            Number.parseInt(String(challenge.currentHordeLevel ?? '1'), 10) || 1,
          timeRemainingMs: remaining,
          status,
          topGuesses: top,
          winners: (challenge as any).winners ?? [],
          topGuessers,
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
          challengeNumber: newChallengeNumber.toString(),
          words: newWords,
          totalPlayers: '0',
          totalGuesses: '0',
          currentHordeLevel: '1',
          timeRemainingMs: '600000',
          lastTickMs: String(Date.now()),
          winners: [],
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
            challengeNumber: parseInt(challenge.challengeNumber),
            words: challenge.words,
            totalPlayers: challenge.totalPlayers ?? 0,
            totalGuesses: challenge.totalGuesses ?? 0,
            currentHordeLevel: challenge.currentHordeLevel ?? 0,
            timeRemainingMs: challenge.timeRemainingMs ?? 0,
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
        const totalPlayers = Number.parseInt(String(c.totalPlayers ?? '0'), 10) || 0;
        const totalGuesses = Number.parseInt(String(c.totalGuesses ?? '0'), 10) || 0;
        const currentHordeLevel = Number.parseInt(String(c.currentHordeLevel ?? '1'), 10) || 1;
        const timeRemainingMs = Number.parseInt(String(c.timeRemainingMs ?? '0'), 10) || 0;

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
