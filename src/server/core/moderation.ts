import { context, reddit, redis } from '@devvit/web/server';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { publicProcedure, router } from '../trpc';
import { Challenge } from './challenge';
import { WordQueue } from './wordQueue';
import { getWord, WordConfigKey } from './api';
import { Notifications } from './notifications';
import { ChallengeLeaderboard } from './challengeLeaderboard';
import { ChallengeProgress } from './challengeProgress';
import { UserGuess } from './userGuess';
import { CommonWordsAggregator } from './commonWordsAggregator';
import { WORD_DATA_RELEASE } from '../../shared/wordDataVersion';
import { isPlaytestContext } from '../../shared/playtest';
import { Playtest } from './playtest';
import { LowQueueAlerts } from './lowQueueAlerts';
import { Admin } from './admin';
import {
  WORD_REVEAL_DURATION_MS,
  WORD_REVEAL_PURPOSES,
  WORD_REVEAL_REASON_MIN_LENGTH,
  WORD_REVEAL_REASON_MAX_LENGTH,
} from '../../shared/moderation';

// Read-only inspection of @devvit/cache 0.15.0's known namespace. Cleanup below
// never deletes these SDK-managed keys, only our legacy full JSON ranking keys.
const compactStorageKey = (path: string) =>
  `__devvit_cache_val__static-word-data:${WORD_DATA_RELEASE}:${path}`;

export async function isModerator(): Promise<boolean> {
  if (!context.userId || !context.subredditName) return false;
  const user = await reddit.getUserById(context.userId);
  if (!user) return false;
  const moderators = await reddit
    .getModerators({ subredditName: context.subredditName, username: user.username, limit: 1 })
    .all();
  return moderators.some((mod) => mod.id === context.userId);
}

export async function requireModerator(): Promise<void> {
  if (!(await isModerator())) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Subreddit moderator access is required.' });
  }
}

const moderatorProcedure = publicProcedure.use(async ({ next }) => {
  await requireModerator();
  return next();
});

const wordsInput = z.object({ words: z.string().min(1).max(5000) });
const revealInput = z.object({
  purpose: z.enum(WORD_REVEAL_PURPOSES),
  reason: z.string().trim().min(WORD_REVEAL_REASON_MIN_LENGTH).max(WORD_REVEAL_REASON_MAX_LENGTH),
  promiseNotToCheat: z.literal(true),
  confirmation: z.literal('REVEAL'),
});
const normalize = (word: string) => word.trim().toLowerCase();

async function usedWords(): Promise<Set<string>> {
  const current = await Challenge.getCurrentChallengeNumber();
  const used = new Set<string>();
  const deadline = Date.now() + 10_000;
  for (let end = current; end > 0; end -= 25) {
    if (Date.now() > deadline) {
      throw new Error('History lookup took too long. No words were added; please try again.');
    }
    const numbers = Array.from({ length: Math.min(25, end) }, (_, i) => end - i);
    const words = await Promise.all(
      numbers.map((number) => redis.hGet(Challenge.ChallengeKey(number), 'secretWord'))
    );
    for (const word of words) if (word) used.add(normalize(word));
  }
  return used;
}

export async function previewQueueWords(raw: string) {
  const words = raw.split(/[,\n]/).map(normalize).filter(Boolean);
  if (words.length > 200) throw new Error('Add up to 200 words at a time.');
  const [queue, used] = await Promise.all([WordQueue.peekAll(), usedWords()]);
  const queued = new Set(queue.map((item) => normalize(item.word)));
  const seen = new Set<string>();
  const result: { word: string; status: 'ready' | 'queued' | 'used' | 'duplicate' | 'invalid' }[] =
    [];
  for (let start = 0; start < words.length; start += 8) {
    const batch = words.slice(start, start + 8).map(async (word) => {
      if (seen.has(word)) return { word, status: 'duplicate' as const };
      seen.add(word);
      if (queued.has(word)) return { word, status: 'queued' as const };
      if (used.has(word)) return { word, status: 'used' as const };
      if (!/^[a-z][a-z'-]*$/.test(word)) return { word, status: 'invalid' as const };
      // Origin errors fail the preview instead of mislabelling valid words.
      const valid = (await getWord({ word })).data.length > 0;
      return { word, status: valid ? ('ready' as const) : ('invalid' as const) };
    });
    result.push(...(await Promise.all(batch)));
  }
  return result;
}

export async function sampleRedisStorage(endChallenge?: number) {
  const current = await Challenge.getCurrentChallengeNumber();
  const end = Math.min(endChallenge ?? current, current);
  const numbers = Array.from({ length: Math.min(5, end) }, (_, i) => end - i);
  const rows = await Promise.all(
    numbers.map(async (number) => {
      const word = await redis.hGet(Challenge.ChallengeKey(number), 'secretWord');
      const [cacheBytes, compactCacheBytes, players, progressPlayers, solved, started] =
        await Promise.all([
          word ? redis.strLen(WordConfigKey(word)) : 0,
          word
            ? redis.strLen(
                compactStorageKey(`${encodeURIComponent(word).replaceAll("'", '%27')}.bin.gz`)
              )
            : 0,
          redis.zCard(ChallengeLeaderboard.ScoreKey(number)),
          redis.zCard(ChallengeProgress.StartKey(number)),
          redis.zRange(ChallengeLeaderboard.ScoreKey(number), 0, 9, { by: 'rank' }),
          redis.zRange(ChallengeProgress.StartKey(number), 0, 9, { by: 'rank' }),
        ]);
      const usernames = [...new Set([...solved, ...started].map((entry) => entry.member))];
      const guesses = await Promise.all(
        usernames.map((username) => redis.hGet(UserGuess.Key(number, username), 'guesses'))
      );
      return {
        challengeNumber: number,
        cacheBytes,
        compactCacheBytes,
        players,
        progressPlayers,
        sampledPlayers: usernames.length,
        sampledGuessBytes: guesses.reduce((sum, value) => sum + Buffer.byteLength(value ?? ''), 0),
      };
    })
  );
  return {
    rows,
    nextEnd: end > 5 ? end - 5 : null,
    dictionaryBytes: await redis.strLen(compactStorageKey('_dictionary.csv.gz')),
  };
}

export const moderationRouter = router({
  createTestPost: moderatorProcedure
    .input(
      z.object({
        word: z
          .string()
          .trim()
          .toLowerCase()
          .min(2)
          .max(80)
          .regex(/^[a-z][a-z'-]*$/),
      })
    )
    .mutation(({ input }) => Playtest.createPost(input.word)),
  testRun: moderatorProcedure.query(() => Playtest.getRun()),
  resetTestRun: moderatorProcedure
    .input(
      z.object({
        state: z.enum(['fresh', 'solved']),
        expectedChallengeNumber: z.number().int().min(1),
      })
    )
    .mutation(({ input }) => Playtest.resetRun(input.state, input.expectedChallengeNumber)),
  access: publicProcedure.query(async () => ({ isModerator: await isModerator() })),
  setLowQueueAlerts: moderatorProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const user = await reddit.getUserById(context.userId!);
      if (!user) throw new TRPCError({ code: 'UNAUTHORIZED' });
      return LowQueueAlerts.setEnabled(user.id, user.username, input.enabled);
    }),
  overview: moderatorProcedure.query(async () => {
    const [number, queueSize, notifications, job, lowQueueAlertsEnabled, developerToolsAvailable] =
      await Promise.all([
        Challenge.getCurrentChallengeNumber(),
        WordQueue.size(),
        Notifications.pendingStats(),
        CommonWordsAggregator.getJobState(),
        LowQueueAlerts.isEnabled(context.userId!),
        Admin.isAdmin(),
      ]);
    const record = number > 0 ? await Challenge.getChallenge({ challengeNumber: number }) : null;
    // Default dashboard responses must not disclose an answer, even in network tools.
    const challenge = record ? (({ secretWord: _secretWord, ...safe }) => safe)(record) : null;
    const next = new Date();
    next.setUTCHours(12, 0, 0, 0);
    if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1);
    return {
      challenge,
      queueSize,
      lowQueueAlertsEnabled,
      developerToolsAvailable,
      notifications,
      job,
      nextPostAtMs: next.getTime(),
      playtestAvailable: isPlaytestContext(context),
    };
  }),
  queue: moderatorProcedure
    .input(revealInput.extend({ page: z.number().int().min(0) }))
    .mutation(async ({ input }) => {
      const items = await redis.zRange(WordQueue.Key(), input.page * 50, input.page * 50 + 49, {
        by: 'rank',
      });
      return {
        page: input.page,
        words: items.map((item) => WordQueue.ChallengeSchema.parse(JSON.parse(item.member))),
        expiresAtMs: Date.now() + WORD_REVEAL_DURATION_MS,
      };
    }),
  revealAnswer: moderatorProcedure
    .input(revealInput.extend({ challengeNumber: z.number().int().min(1) }))
    .mutation(async ({ input }) => {
      const challenge = await Challenge.getChallenge({ challengeNumber: input.challengeNumber });
      return {
        challengeNumber: input.challengeNumber,
        word: challenge.secretWord,
        expiresAtMs: Date.now() + WORD_REVEAL_DURATION_MS,
      };
    }),
  previewWords: moderatorProcedure
    .input(wordsInput)
    .mutation(({ input }) => previewQueueWords(input.words)),
  addWords: moderatorProcedure
    .input(wordsInput.extend({ prepend: z.boolean().default(false) }))
    .mutation(async ({ input }) => {
      const preview = await previewQueueWords(input.words);
      const ready = preview.filter((item) => item.status === 'ready');
      if (ready.length > 0) {
        await WordQueue.addMany({
          challenges: ready.map(({ word }) => ({ word })),
          prepend: input.prepend,
        });
        await LowQueueAlerts.recordRefill();
      }
      return { added: ready.length, skipped: preview.length - ready.length };
    }),
  clearQueue: moderatorProcedure
    .input(z.object({ confirm: z.literal('CLEAR') }))
    .mutation(async () => {
      await WordQueue.clear();
      return { cleared: true };
    }),
  recoverPost: moderatorProcedure.mutation(async () => {
    try {
      return await Challenge.ensureLatestClassicPostOrRetry();
    } catch {
      // Source failures can include the answer in their message. Keep those
      // details in the existing server logs, not the protected console.
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unable to recover the scheduled puzzle. Check the publishing logs.',
      });
    }
  }),
  postNext: moderatorProcedure
    .input(z.object({ confirm: z.literal('POST'), skipNotifications: z.boolean() }))
    .mutation(async ({ input }) => {
      try {
        const result = await Challenge.makeNewChallenge({
          ignoreDailyWindow: true,
          enqueueNotifications: !input.skipNotifications,
        });
        return { challenge: result.challenge, postId: result.postId, postUrl: result.postUrl };
      } catch {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Unable to create the next puzzle. Check the queue and publishing logs.',
        });
      }
    }),
  redisSample: moderatorProcedure
    .input(z.object({ endChallenge: z.number().int().min(1).optional() }))
    .query(({ input }) => sampleRedisStorage(input.endChallenge)),
  clearWordCaches: moderatorProcedure
    .input(
      z.object({
        challengeNumbers: z.array(z.number().int().min(1)).max(5),
        confirm: z.literal('CLEAR_CACHES'),
      })
    )
    .mutation(async ({ input }) => {
      // Resolve cache keys on the server so storage tools never need to reveal answers.
      const words = await Promise.all(
        [...new Set(input.challengeNumbers)].map((number) =>
          redis.hGet(Challenge.ChallengeKey(number), 'secretWord')
        )
      );
      const keys = [...new Set(words.filter((word): word is string => Boolean(word)))].map(
        WordConfigKey
      );
      const sizes = await Promise.all(keys.map((key) => redis.strLen(key)));
      if (keys.length > 0) await redis.del(...keys);
      return {
        cleared: sizes.filter((size) => size > 0).length,
        bytes: sizes.reduce((sum, size) => sum + size, 0),
      };
    }),
});

export async function openModeratorSettingsPost() {
  await requireModerator();
  const key = 'moderator:settings-post-id';
  const previous = await redis.get(key);
  if (previous) {
    try {
      const post = await reddit.getPostById(previous as `t3_${string}`);
      return post.url;
    } catch {
      /* Recreate a removed launcher. */
    }
  }
  const post = await reddit.submitCustomPost({
    subredditName: context.subredditName!,
    title: 'Hot and Cold Moderator Settings (Experimental)',
    entry: 'moderator',
    postData: { kind: 'moderator-settings' },
  });
  await redis.set(key, post.id);
  return post.url;
}
