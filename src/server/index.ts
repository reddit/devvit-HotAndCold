import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { z } from 'zod';
import { publicProcedure, router } from './trpc';
import { createContext } from './context';
import { createServer, getServerPort, redis, scheduler } from '@devvit/web/server';
import { Challenge } from './core/challenge';
import { SpoilerGuard } from './core/spoilerGuard';
import { WtfResponder } from './core/wtfResponder';
import {
  WordConfigKey,
  buildHintCsvForChallenge,
  buildLetterCsvForChallenge,
  getWord,
  getWordConfig,
} from './core/api';
import { UserGuess } from './core/userGuess';
import { User } from './core/user';
import { ChallengeProgress } from './core/challengeProgress';
import { ChallengeLeaderboard } from './core/challengeLeaderboard';
import { LastPlayedAt } from './core/lastPlayedAt';
import { Reminders } from './core/reminder';
import { JoinedSubreddit } from './core/joinedSubreddit';
import { UserComment } from './core/userComment';
import { reddit, RichTextBuilder, context } from '@devvit/web/server';
import { WordQueue } from './core/wordQueue';
import { FormattingFlag } from '@devvit/shared-types/richtext/types.js';
import { omit } from '../shared/omit';
import { Flairs } from './core/flairs';
import { Admin } from './core/admin';
import { makeAnalyticsRouter } from '@devvit/analytics/server/posthog';
import { Timezones } from './core/timezones';
import { Notifications } from './core/notifications';
import { makeClientConfig } from '../shared/makeClientConfig';
import { redisCompressed } from './core/redisCompression';
import { CommonWordsAggregator } from './core/commonWordsAggregator';

redisCompressed.del().catch(() => {});

const USER_GUESS_MIGRATION_DISABLED_KEY = 'userGuessCompressionMigration:disabled' as const;
const CHALLENGE_PROGRESS_MIGRATION_DISABLED_KEY =
  'challengeProgressCompressionMigration:disabled' as const;
const USER_CACHE_MIGRATION_DISABLED_KEY = 'userCacheCompressionMigration:disabled' as const;

// Formats a duration in milliseconds to a human-readable long form like
// "2 hours 5 minutes 3 seconds" or "2 minutes 45 seconds" or "5 seconds".
function formatDurationLong(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  if (seconds > 0 || parts.length === 0)
    parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
  return parts.join(' ');
}

async function computeCommentSuffix({
  username,
  challengeNumber,
}: {
  username: string;
  challengeNumber: number;
}): Promise<string> {
  const info = await UserGuess.getChallengeUserInfo({ username, challengeNumber });
  const start = info.startedPlayingAtMs ?? 0;
  const end = info.solvedAtMs ?? info.gaveUpAtMs ?? Date.now();
  const duration = formatDurationLong(end - start);
  const nonHintGuesses = (info.guesses ?? []).filter((g: any) => !g.isHint).length;
  const hintsUsed = (info.guesses ?? []).filter((g: any) => g.isHint).length;
  const score = info.score?.finalScore;
  const base = `Automatically added: I found the secret word in ${duration} after ${nonHintGuesses} ${
    nonHintGuesses === 1 ? 'guess' : 'guesses'
  } and ${hintsUsed} ${hintsUsed === 1 ? 'hint' : 'hints'}.`;
  return typeof score === 'number' ? `${base} Score: ${score}.` : base;
}

const appRouter = router({
  init: publicProcedure.query(async () => {
    console.log('inside of init');

    const resp = await fetch('https://en.wikipedia.org/wiki/Pauline_Ferrand-Pr%C3%A9vot');
    const html = await resp.text();
    console.log(html);

    return {
      challengeNumber: await Challenge.getCurrentChallengeNumber(),
      html,
    };
  }),
  user: {
    me: publicProcedure.query(async () => {
      const current = await User.getCurrent();
      return current;
    }),
    isAdmin: publicProcedure.query(async () => {
      return await Admin.isAdmin();
    }),
  },
  cta: {
    getCallToAction: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
        })
      )
      .query(async ({ input }) => {
        const challengeNumber = input.challengeNumber;
        const current = await User.getCurrent();
        const username = current.username;

        const [hasJoined, hasReminder, hasCommented] = await Promise.all([
          JoinedSubreddit.isUserJoinedSubreddit({ username }),
          Reminders.isUserOptedIntoReminders({ username }),
          UserComment.hasUserCommentedForChallenge({ username, challengeNumber }),
        ]);

        if (!hasJoined) return 'JOIN_SUBREDDIT' as const;
        if (!hasReminder) return 'REMIND_ME_TO_PLAY' as const;
        if (!hasCommented) return 'COMMENT' as const;
        return null;
      }),

    joinSubreddit: publicProcedure.input(z.object({})).mutation(async () => {
      await reddit.subscribeToCurrentSubreddit();
      const current = await User.getCurrent();
      await JoinedSubreddit.setJoinedSubredditForUsername({ username: current.username });
      return { success: true } as const;
    }),

    hasJoinedSubreddit: publicProcedure.query(async () => {
      const current = await User.getCurrent();
      return await JoinedSubreddit.isUserJoinedSubreddit({ username: current.username });
    }),

    isOptedIntoReminders: publicProcedure.query(async () => {
      const current = await User.getCurrent();
      return await Reminders.isUserOptedIntoReminders({ username: current.username });
    }),

    setReminder: publicProcedure
      .input(z.object({ timezone: z.string().min(1).optional() }))
      .mutation(async ({ input }) => {
        const current = await User.getCurrent();
        await Reminders.setReminderForUsername({ username: current.username });
        if (input?.timezone) {
          await Timezones.setUserTimezone({ username: current.username, timezone: input.timezone });
        }
        return { success: true } as const;
      }),

    removeReminder: publicProcedure.input(z.object({})).mutation(async () => {
      const current = await User.getCurrent();
      await Reminders.removeReminderForUsername({ username: current.username });
      return { success: true } as const;
    }),

    toggleReminder: publicProcedure
      .input(z.object({ timezone: z.string().min(1).optional() }))
      .mutation(async ({ input }) => {
        const current = await User.getCurrent();
        const { newValue } = await Reminders.toggleReminderForUsername({
          username: current.username,
        });
        if (newValue && input?.timezone) {
          try {
            const tz = String(input.timezone);
            await Timezones.setUserTimezone({ username: current.username, timezone: tz });
          } catch (e) {
            console.error('Failed to set user timezone on toggle', e);
          }
        }
        return { newValue } as const;
      }),

    getCommentSuffix: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
        })
      )
      .query(async ({ input }) => {
        const { challengeNumber } = input;
        const current = await User.getCurrent();
        const username = current.username;
        const suffix = await computeCommentSuffix({ username, challengeNumber });
        return { suffix } as const;
      }),

    submitComment: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
          comment: z.string().min(1).max(10000),
        })
      )
      .mutation(async ({ input }) => {
        const { challengeNumber, comment } = input;
        // Comment on the current challenge post
        const current = await User.getCurrent();

        // Prefer stored post ID for the challenge
        const postId = await Challenge.getPostIdForChallenge({ challengeNumber });
        if (!postId) {
          throw new Error('Could not find challenge post to comment on');
        }

        // Build richtext: main comment paragraph + small/superscript caption suffix paragraph
        const builder = new RichTextBuilder();
        builder.paragraph((p) => {
          p.text({ text: comment });
        });
        try {
          const suffix = await computeCommentSuffix({
            username: current.username,
            challengeNumber,
          });
          builder.paragraph((p) => {
            p.text({
              text: suffix,
              // Apply superscript to the entire suffix as a caption-like style
              formatting: [[FormattingFlag.superscript, 0, suffix.length]],
            });
          });
        } catch {
          // ignore suffix failure; just post the main comment
        }

        const id = postId as `t3_${string}`;
        await reddit.submitComment({ id, richtext: builder, runAs: 'USER' });

        await UserComment.setUserCommentedForChallenge({
          username: current.username,
          challengeNumber,
        });

        return { success: true } as const;
      }),
  },
  counter: {
    get: publicProcedure.query(async () => {
      const resp = await redis.get('counter');
      return resp ? parseInt(resp) : 0;
    }),
    increment: publicProcedure
      .input(
        z.object({
          amount: z.number().positive().default(1),
        })
      )
      .mutation(async ({ input }) => {
        const resp = await redis.incrBy('counter', input.amount);
        return resp;
      }),
    decrement: publicProcedure
      .input(
        z.object({
          amount: z.number().negative().default(-1),
        })
      )
      .mutation(async ({ input }) => {
        const resp = await redis.incrBy('counter', input.amount);
        return resp;
      }),
  },
  leaderboard: {
    get: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
          start: z.number().int().min(0).default(0),
          stop: z.number().int().min(-1).default(20),
        })
      )
      .query(async ({ input }) => {
        const { challengeNumber, start, stop } = input;
        const current = await User.getCurrent();
        const username = current.username;

        let leaderboardByScore: Array<{ member: string; score: number }> = [];
        try {
          leaderboardByScore = await ChallengeLeaderboard.getLeaderboardByScore({
            challengeNumber,
            start,
            stop,
            sort: 'DESC',
          });
        } catch {
          // no leaderboard yet – return empty
          leaderboardByScore = [];
        }

        let userRank: { score: number; timeToSolve: number } | null = null;
        if (leaderboardByScore.length > 0) {
          const zeroBased = await ChallengeLeaderboard.getRankingsForMember({
            challengeNumber,
            username,
          });
          // Convert to 1-based for UI display
          userRank = { score: zeroBased.score + 1, timeToSolve: zeroBased.timeToSolve + 1 };
        }

        return { leaderboardByScore, userRank } as const;
      }),
  },
  archive: {
    list: publicProcedure
      .input(
        z
          .object({
            cursor: z.number().int().gt(0).optional(),
            limit: z.number().int().min(1).max(100).optional(),
          })
          .default({})
      )
      .query(async ({ input }) => {
        const limit = input.limit ?? 50;
        const cursor = input.cursor;

        const currentChallengeNumber = await Challenge.getCurrentChallengeNumber();
        if (currentChallengeNumber <= 0) {
          return { items: [], nextCursor: null };
        }

        const start = cursor ? Math.min(cursor, currentChallengeNumber) : currentChallengeNumber;

        let username: string | null = null;
        if (context.userId) {
          try {
            const currentUser = await User.getCurrent();
            username = currentUser.username;
          } catch (error) {
            console.error('Failed to resolve current user for archive list', error);
          }
        }

        const resolvePostUrl = (stored: unknown, postId: string | null): string | null => {
          if (typeof stored === 'string' && stored.length > 0) {
            return stored;
          }
          if (!postId) {
            return null;
          }
          const trimmed = postId.startsWith('t3_') ? postId.slice(3) : postId;
          return trimmed.length > 0 ? `https://www.reddit.com/comments/${trimmed}` : null;
        };

        const items: any[] = [];
        const seen = new Set<number>();
        let pointer = start;

        while (pointer > 0 && items.length < limit) {
          const challengeNumber = pointer;
          pointer -= 1;

          if (seen.has(challengeNumber)) {
            continue;
          }

          try {
            const [challenge, postId] = await Promise.all([
              Challenge.getChallenge({ challengeNumber }),
              Challenge.getPostIdForChallenge({ challengeNumber }),
            ]);

            const userInfo =
              username != null
                ? await UserGuess.getChallengeUserInfo({ username, challengeNumber })
                : null;

            const status =
              userInfo?.solvedAtMs != null
                ? 'solved'
                : userInfo?.startedPlayingAtMs != null
                  ? 'playing'
                  : 'not_played';

            const summary = {
              challengeNumber,
              totalPlayers: challenge.totalPlayers ?? 0,
              totalSolves: challenge.totalSolves ?? 0,
              totalGuesses: challenge.totalGuesses ?? 0,
              totalHints: challenge.totalHints ?? 0,
              totalGiveUps: challenge.totalGiveUps ?? 0,
              status,
              score: userInfo?.score?.finalScore ?? null,
              startedPlayingAtMs: userInfo?.startedPlayingAtMs ?? null,
              solvedAtMs: userInfo?.solvedAtMs ?? null,
              gaveUpAtMs: userInfo?.gaveUpAtMs ?? null,
              postUrl: resolvePostUrl(challenge.postUrl, postId),
              postId,
            };

            items.push(summary);
            seen.add(challengeNumber);
          } catch (error) {
            console.error('Failed to load challenge for archive list', {
              challengeNumber,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        const nextCursor = pointer > 0 ? pointer : null;

        return { items, nextCursor };
      }),
  },
  guess: {
    submitBatch: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
          guesses: z.array(
            z.object({
              word: z.string(),
              similarity: z.number(),
              rank: z.number(),
              atMs: z.number(),
              isHint: z.boolean().optional(),
            })
          ),
        })
      )
      .mutation(async ({ input }) => {
        const { challengeNumber, guesses } = input;
        const current = await User.getCurrent();
        const username = current.username;

        // Map to server core expected shape
        const mapped = guesses.map((g) => ({
          word: g.word,
          similarity: g.similarity,
          rank: g.rank,
          // Only accept isHint when explicitly provided by client UI
          isHint: g.isHint === true,
        }));
        const response = await UserGuess.submitGuesses({
          username,
          challengeNumber,
          guesses: mapped,
        });
        // Track when the user last played
        try {
          await LastPlayedAt.setLastPlayedAtForUsername({ username });
        } catch (e) {
          console.error('Failed to record lastPlayedAt', e);
        }
        return response;
      }),
    giveUp: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
        })
      )
      .mutation(async ({ input }) => {
        const challengeNumber = input.challengeNumber;
        const current = await User.getCurrent();
        const username = current.username;
        const response = await UserGuess.giveUp({ username, challengeNumber });
        return response;
      }),
  },
  game: {
    reveal: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
        })
      )
      .query(async ({ input }) => {
        const challengeNumber = input.challengeNumber;

        // If logged out, allow revealing (no leaderboard stakes)
        if (!context.userId) {
          const challenge = await Challenge.getChallenge({ challengeNumber });
          return { secretWord: challenge.secretWord };
        }

        // If logged in, only allow revealing if the game is over for them
        const current = await User.getCurrent();
        const info = await UserGuess.getChallengeUserInfo({
          username: current.username,
          challengeNumber,
        });

        if (info.solvedAtMs || info.gaveUpAtMs) {
          const challenge = await Challenge.getChallenge({ challengeNumber });
          return { secretWord: challenge.secretWord };
        }

        // Otherwise deny to prevent trivial API-based cheating while actively playing
        throw new Error('Cannot reveal secret word while playing');
      }),
    get: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
        })
      )
      .query(async ({ input }) => {
        const challengeNumber = input.challengeNumber;
        let username: string | null = null;
        try {
          const current = await User.getCurrent();
          username = current.username;
        } catch {
          // Logged out or user not found
        }

        const [challengeInfo, challengeUserInfo] = await Promise.all([
          Challenge.getChallenge({ challengeNumber }),
          username ? UserGuess.getChallengeUserInfo({ username, challengeNumber }) : null,
        ]);
        return {
          challengeNumber,
          challengeInfo: omit(challengeInfo, ['secretWord']),
          challengeUserInfo,
        };
      }),
  },
  progress: {
    nearestByStartTime: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
          windowBefore: z.number().int().min(0).max(200).default(10),
          windowAfter: z.number().int().min(0).max(200).default(10),
        })
      )
      .query(async ({ input }) => {
        const challengeNumber = input.challengeNumber;
        // Gracefully handle unauthenticated context to avoid log noise
        if (!context.userId) {
          return [] as const;
        }
        const current = await User.getCurrent();
        const username = current.username;
        const neighbors = await ChallengeProgress.getNearestByStartTime({
          challengeNumber,
          username,
          windowBefore: input.windowBefore,
          windowAfter: input.windowAfter,
        });
        return neighbors;
      }),
  },
  notifications: {
    testPush: publicProcedure.mutation(async () => {
      const isAdmin = await Admin.isAdmin();
      if (!isAdmin) {
        throw new Error('Unauthorized');
      }

      const current = await User.getCurrent();
      const challengeNumber = await Challenge.getCurrentChallengeNumber();
      const postId = await Challenge.getPostIdForChallenge({ challengeNumber });

      if (!postId) {
        throw new Error('Could not find challenge post to use for notification');
      }

      const result = await Notifications.sendSingleNow({
        username: current.username,
        postId,
        title: 'Test Notification',
        body: 'This is a test notification from the admin menu.',
      });

      return result;
    }),
  },
  // Returns whether the current user is an admin. Caches result in Redis.
});

// Export type router type signature, this is used by the client.
export type AppRouter = typeof appRouter;

const app = express();

// Mount analytics proxy BEFORE any body parsers to avoid mangling raw bodies
app.use('/api', (...args) => {
  const isProd = context.subredditName === 'HotAndCold';
  return makeAnalyticsRouter({
    posthogKey: makeClientConfig(isProd).POSTHOG_KEY,
  })(...args);
});

app.use(express.json());

// Needs to be before /api/challenges/:challengeNumber/:letter.csv!!
app.get('/api/challenges/:challengeNumber/_hint.csv', async (req, res): Promise<void> => {
  try {
    const challengeNumber = Number.parseInt(String(req.params.challengeNumber), 10);
    if (!Number.isFinite(challengeNumber) || challengeNumber <= 0) {
      res.status(400).send('Invalid challenge number');
      return;
    }

    const challenge = await Challenge.getChallenge({ challengeNumber });
    const csv = await buildHintCsvForChallenge({
      challengeSecretWord: challenge.secretWord,
      max: 500,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('Surrogate-Control', 'max-age=31536000, immutable');
    res.status(200).send(csv);
  } catch (err: any) {
    console.log('err', err.message.substring(0, 500));
    console.error('Failed to serve hint CSV', err);
    res.status(500).send('Failed to generate CSV');
  }
});

// Register CSV endpoints BEFORE tRPC so they are not shadowed by the /api adapter
app.get('/api/challenges/:challengeNumber/:letter.csv', async (req, res): Promise<void> => {
  try {
    const challengeNumber = Number.parseInt(String(req.params.challengeNumber), 10);
    const rawLetter = String(req.params.letter || '')
      .trim()
      .toLowerCase();
    if (!Number.isFinite(challengeNumber) || challengeNumber <= 0) {
      res.status(400).send('Invalid challenge number');
      return;
    }
    if (!/^[a-z]$/.test(rawLetter)) {
      res.status(400).send('Invalid letter');
      return;
    }

    const challenge = await Challenge.getChallenge({ challengeNumber });
    const csv = await buildLetterCsvForChallenge({
      challengeSecretWord: challenge.secretWord,
      letter: rawLetter,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    res.setHeader('Surrogate-Control', 'max-age=31536000, immutable');
    res.status(200).send(csv);
  } catch (err: any) {
    console.log('err', err.message.substring(0, 500));
    console.error('Failed to serve letter CSV', err);
    res.status(500).send('Failed to generate CSV');
  }
});

app.use(
  '/api',
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError({ error, path, type, input }) {
      // Suppress logging for expected user-facing errors
      const message = String(error?.message ?? '');
      if (message.includes('You already guessed')) {
        return;
      }
      if (message.includes('User not found')) {
        return;
      }

      // Surface all other procedure errors on the server for debugging/observability
      console.error('[tRPC error]', {
        path,
        type,
        message: error.message,
        cause: error.cause,
        input,
        stack: error.stack,
      });
    },
  })
);

app.post('/internal/menu/post-create', async (_req, res): Promise<void> => {
  try {
    const post = await Challenge.makeNewChallenge({
      enqueueNotifications: true,
      ignoreDailyWindow: true,
    });

    res.json({
      navigateTo: post.postUrl,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

app.post('/internal/form/post-create', async (req, res): Promise<void> => {
  try {
    const { skipNotifications } = (req.body as any) ?? {};
    const post = await Challenge.makeNewChallenge({
      enqueueNotifications: !skipNotifications,
      ignoreDailyWindow: true,
    });

    res.json({
      navigateTo: post.postUrl,
      showToast: {
        text: skipNotifications ? 'Post created (notifications skipped)' : 'Post created',
        appearance: 'success',
      },
    });
  } catch (error) {
    console.error(`Error creating post (advanced): ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
    });
  }
});

// Queue: submit challenges (append or prepend)
app.post('/internal/form/queue/add', async (req, res): Promise<void> => {
  try {
    console.log('adding to queue', req.body);
    const { wordsCsv, prepend } = (req.body as any) ?? {};
    if (typeof wordsCsv !== 'string' || wordsCsv.trim().length === 0) {
      res.status(400).json({
        showToast: {
          text: 'wordsCsv is required',
          appearance: 'neutral',
        },
      });
      return;
    }

    const words = wordsCsv
      .split(',')
      .map((w: string) => w.trim())
      .filter((w: string) => w.length > 0);

    if (words.length === 0) {
      res.status(400).json({
        showToast: {
          text: 'No words provided after parsing',
          appearance: 'neutral',
        },
      });
      return;
    }

    const challenges = z
      .array(WordQueue.ChallengeSchema)
      .parse(words.map((w: string) => ({ word: w })));

    // Validate each word via getWord before queuing; continue on failures
    const validatedResults = await Promise.allSettled(
      challenges.map(async (c) => {
        const word = c.word;
        try {
          const result = await getWord({ word });
          const isValid = Array.isArray(result?.data) && result.data.length > 0;
          if (!isValid) throw new Error('Word not found');
          return { word } as const;
        } catch (e: any) {
          throw new Error(e?.message || 'Validation failed');
        }
      })
    );

    const successes: Array<{ word: string }> = [];
    const failures: Array<{ word: string; error: string }> = [];

    for (let i = 0; i < validatedResults.length; i++) {
      const result = validatedResults[i]!;
      const word = challenges[i]!.word;
      if (result.status === 'fulfilled') {
        successes.push({ word: result.value.word });
      } else {
        const errorMsg = result.reason?.message ?? String(result.reason);
        failures.push({ word, error: errorMsg });
        console.error('Queue add validation failed', { word, error: errorMsg });
      }
    }

    // Enqueue only validated successes; skip duplicates already in queue
    const existingQueue = await WordQueue.peekAll();
    const existingSet = new Set(existingQueue.map((c) => c.word.toLowerCase()));
    const seenIncoming = new Set<string>();
    const duplicates: string[] = [];
    const toEnqueue = successes
      .map((s) => s.word)
      .filter((w) => {
        const lower = w.toLowerCase();
        if (existingSet.has(lower)) {
          duplicates.push(w);
          return false;
        }
        if (seenIncoming.has(lower)) {
          duplicates.push(w);
          return false;
        }
        seenIncoming.add(lower);
        return true;
      })
      .map((w) => ({ word: w }));

    if (prepend) {
      for (const c of toEnqueue) {
        await WordQueue.prepend({ challenge: c });
        // This heats up the cache on the Supabase side
        void getWordConfig({ word: c.word }).catch(() => {});
      }
    } else {
      for (const c of toEnqueue) {
        await WordQueue.append({ challenge: c });
        // This heats up the cache on the Supabase side
        void getWordConfig({ word: c.word }).catch(() => {});
      }
    }

    const successCount = toEnqueue.length;
    const failureWords = failures.map((f) => f.word).join(', ');
    const duplicateWords = duplicates.join(', ');
    const issues: string[] = [];
    if (failures.length > 0) issues.push(`Failed: ${failureWords}`);
    if (duplicates.length > 0) issues.push(`Skipped duplicates: ${duplicateWords}`);
    const base = `Added ${successCount} item(s) to the queue`;
    const text = issues.length === 0 ? base : `${base}. ${issues.join('. ')}`;

    res.status(200).json({
      showToast: {
        text,
        appearance: issues.length === 0 ? 'success' : 'neutral',
      },
    });
  } catch (err: any) {
    console.error('Failed to add to queue', err);
    res.status(400).json({
      showToast: {
        text: err?.message || 'Failed to add to queue',
        appearance: 'neutral',
      },
    });
  }
});

// Queue: clear (requires confirmation)
app.post('/internal/form/queue/clear', async (req, res): Promise<void> => {
  const { confirm } = (req.body as any) ?? {};
  if (!confirm) {
    res.status(400).json({
      showToast: {
        text: 'You must confirm to clear the queue',
        appearance: 'neutral',
      },
    });
    return;
  }
  await WordQueue.clear();
  res.status(200).json({
    showToast: {
      text: 'Queue cleared',
      appearance: 'success',
    },
  });
});

// [queue] Add to queue (form launcher)
app.post('/internal/menu/add', async (_req, res): Promise<void> => {
  res.status(200).json({
    showForm: {
      name: 'queueAddForm',
      form: {
        title: 'Add challenges to queue',
        acceptLabel: 'Submit',
        fields: [
          {
            name: 'wordsCsv',
            label: 'Comma-separated words',
            type: 'paragraph',
            required: true,
            placeholder: 'word1, word2, word3',
          },
          {
            name: 'prepend',
            label: 'Prepend to front (instead of append)',
            type: 'boolean',
            defaultValue: false,
          },
        ],
      },
    },
  });
});

// [queue] Clear queue (form launcher)
app.post('/internal/menu/clear', async (_req, res): Promise<void> => {
  res.status(200).json({
    showForm: {
      name: 'queueClearForm',
      form: {
        title: 'Clear challenge queue',
        acceptLabel: 'Clear queue',
        fields: [
          {
            name: 'confirm',
            label: 'I understand this will delete all items in the queue',
            type: 'boolean',
            defaultValue: false,
          },
        ],
      },
    },
  });
});

// [queue] Get size (immediate action)
app.post('/internal/menu/size', async (_req, res): Promise<void> => {
  const n = await WordQueue.size();
  res.status(200).json({
    showToast: `Queue size: ${n}`,
  });
});

// [stats] Show count of users opted into reminders (immediate action)
app.post('/internal/menu/reminders-count', async (_req, res): Promise<void> => {
  try {
    const total = await Reminders.totalReminders();
    res.status(200).json({
      showToast: `Users opted into reminders: ${total}`,
    });
  } catch (err: any) {
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to get reminders count',
        appearance: 'neutral',
      },
    });
  }
});

// [stats] Show count of users who joined the subreddit (immediate action)
app.post('/internal/menu/joined-count', async (_req, res): Promise<void> => {
  try {
    const total = await JoinedSubreddit.totalJoinedSubreddit();
    res.status(200).json({
      showToast: `Users joined subreddit: ${total}`,
    });
  } catch (err: any) {
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to get joined subreddit count',
        appearance: 'neutral',
      },
    });
  }
});

// [ops] Drop IdToUsernameKey (immediate action)
app.post('/internal/menu/admin/drop-id-to-username-key', async (_req, res): Promise<void> => {
  try {
    await redis.del('user:idToUsername');
    res.status(200).json({
      showToast: {
        text: 'Dropped user:idToUsername key',
        appearance: 'success',
      },
    });
  } catch (err: any) {
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to drop key',
        appearance: 'neutral',
      },
    });
  }
});

// [stats] Players count (form launcher)
app.post('/internal/menu/stats/players-count', async (_req, res): Promise<void> => {
  try {
    let defaultChallenge: number | undefined = undefined;
    try {
      defaultChallenge = await Challenge.getCurrentChallengeNumber();
    } catch {
      // ignore failure to compute default
    }
    res.status(200).json({
      showForm: {
        name: 'statsPlayersForm',
        form: {
          title: 'Players count for challenge',
          acceptLabel: 'Check',
          fields: [
            {
              name: 'challengeNumber',
              label: 'Challenge Number',
              type: 'number',
              required: true,
              ...(defaultChallenge ? { defaultValue: defaultChallenge } : {}),
            },
          ],
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to open players count form',
        appearance: 'neutral',
      },
    });
  }
});

// [stats] Players count (form handler)
app.post('/internal/form/stats/players-count', async (req, res): Promise<void> => {
  try {
    const { challengeNumber } = (req.body as any) ?? {};
    const parsed = Number.parseInt(String(challengeNumber), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      res.status(400).json({
        showToast: { text: 'Invalid challenge number', appearance: 'neutral' },
      });
      return;
    }
    const challenge = await Challenge.getChallenge({ challengeNumber: parsed });
    const totalPlayers = Number.parseInt(String(challenge.totalPlayers ?? '0'), 10) || 0;
    const text = `#${parsed}: "${challenge.secretWord}" — Total players: ${totalPlayers}`;
    res.status(200).json({
      showToast: { text, appearance: 'success' },
    });
  } catch (err: any) {
    res.status(500).json({
      showToast: { text: err?.message || 'Failed to fetch players count', appearance: 'neutral' },
    });
  }
});

// [stats] Total guesses across all challenges
app.post('/internal/menu/stats/total-guesses', async (_req, res): Promise<void> => {
  try {
    const currentChallengeNumber = await Challenge.getCurrentChallengeNumber();
    let totalGuesses = 0;
    const batchSize = 100;

    for (let i = 1; i <= currentChallengeNumber; i += batchSize) {
      const batchPromises: Promise<string | undefined>[] = [];
      const end = Math.min(i + batchSize - 1, currentChallengeNumber);
      for (let j = i; j <= end; j++) {
        batchPromises.push(redis.hGet(Challenge.ChallengeKey(j), 'totalGuesses'));
      }
      const results = await Promise.all(batchPromises);
      for (const val of results) {
        if (val) {
          totalGuesses += parseInt(val, 10) || 0;
        }
      }
    }

    res.status(200).json({
      showToast: {
        text: `Total guesses across all ${currentChallengeNumber} challenges: ${totalGuesses}`,
        appearance: 'success',
      },
    });
  } catch (err: any) {
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to calculate total guesses',
        appearance: 'neutral',
      },
    });
  }
});

// [queue] DM full queue contents to invoking moderator (immediate action)
app.post('/internal/menu/dm', async (_req, res): Promise<void> => {
  try {
    const { userId } = context;
    if (!userId) {
      res.status(400).json({
        showToast: 'userId is required',
      });
      return;
    }

    const me = await reddit.getUserById(userId);
    if (!me) {
      res.status(400).json({
        showToast: 'Could not resolve current user',
      });
      return;
    }

    const items = await WordQueue.peekAll();
    const subject = 'Hot & Cold challenge queue contents';
    const body = items.length === 0 ? 'Queue is empty.' : JSON.stringify(items, null, 2);

    await reddit.sendPrivateMessage({
      to: me.username,
      subject,
      text: body,
    });

    res.status(200).json({
      showToast: 'Sent challenge queue via DM',
    });
  } catch (err: any) {
    console.error('Failed to send challenge queue DM', err);
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to send challenge queue DM',
        appearance: 'neutral',
      },
    });
  }
});

// [queue] Post next queued challenge (immediate action)
app.post('/internal/menu/post-next', async (_req, res): Promise<void> => {
  // Show a form that allows moderator to optionally skip notifications
  res.status(200).json({
    showForm: {
      name: 'postCreateForm',
      form: {
        title: 'Create next challenge',
        acceptLabel: 'Create',
        fields: [
          {
            name: 'skipNotifications',
            label: 'Skip sending reminder DMs',
            type: 'boolean',
            defaultValue: false,
          },
        ],
      },
    },
  });
});
// Trigger: on comment create → remove spoilers that reveal the secret word (unless within spoiler)
app.post('/internal/triggers/on-comment-create', async (req, res): Promise<void> => {
  try {
    // Payload contract from Devvit triggers
    const body = (req.body as any) ?? {};
    const commentId: string | undefined = body?.comment?.id;
    const parentPostId: string | undefined = body?.post?.id ?? body?.comment?.postId;
    const commentBodyRaw: string = String(body?.comment?.body ?? '');
    const parentId: string | undefined = body?.comment?.parentId;

    if (!commentId || !parentPostId) {
      res.status(200).json({ handled: false });
      return;
    }

    const text = commentBodyRaw.trim();
    // Assign flair using LLM classifier, guarded by cheap keyword prefilter
    try {
      const authorName: string | undefined = body?.author?.name;
      if (authorName && typeof authorName === 'string' && authorName.length > 0) {
        const lowered = text.toLowerCase();
        if (lowered.includes('hate') && lowered.includes('tomorrow')) {
          const shouldAssign = await Flairs.classifyIHateThisGameTomorrow({ raw: text });
          if (shouldAssign) {
            await reddit.setUserFlair({
              subredditName: context.subredditName!,
              username: authorName,
              flairTemplateId: Flairs.FLAIRS.I_HATE_THIS_GAME_SEE_YALL_TOMORROW,
            });
          }
        }
      }
    } catch (e) {
      console.error('Failed to assign user flair via classifier', e);
    }

    // TODO: This will probably get ratelimited but no other way to get post data right now
    // 1) Get challenge from the parent post's postData
    const post = await reddit.getPostById(parentPostId as any);
    const postData: any = await post.getPostData();
    const parsed = Number.parseInt(String(postData?.challengeNumber ?? ''));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      // Not a game post; skip spoiler and !wtf handling
      res.status(200).json({ handled: false, action: 'skip-non-challenge-post' });
      return;
    }
    const challengeNumber = parsed;

    // 2) Get the secret word
    const challenge = await Challenge.getChallenge({ challengeNumber });
    const secretWord = String(challenge.secretWord).trim().toLowerCase();
    if (!secretWord) {
      res.status(200).json({ handled: false });
      return;
    }

    // 3) Run spoiler guard (remove comment if it reveals secret outside spoiler)
    const sgResult = await SpoilerGuard.checkAndRemoveIfNeeded({
      commentId,
      text: commentBodyRaw,
      secretWord,
    });
    if (sgResult.removed) {
      console.log('[spoiler-guard] Removed revealing comment', {
        commentId,
        parentPostId,
        challengeNumber,
        author: body?.author?.name,
      });
      res.status(200).json({ handled: true, action: 'removed' });
      return;
    }

    // 4) Handle !wtf logic

    const containsWtf = /!wtf\b/i.test(text);
    const isRoot = typeof parentId === 'string' && parentId === parentPostId;
    if (containsWtf) {
      console.log('[!wtf] containsWtf', { text, containsWtf, isRoot });
      try {
        let sourceText = text;
        const isJustWtf = /^!wtf$/i.test(text);
        // If it's a bare !wtf on a reply (not root), use the parent comment's body as the source
        if (isJustWtf && !isRoot) {
          console.log('[!wtf] isJustWtf and !isRoot', { parentId, parentPostId });
          try {
            const parentComment = await reddit.getCommentById(parentId as any);
            sourceText = parentComment.body;
          } catch (e) {
            // ignore fetch failure; we'll fall back to the triggering text
          }
        }

        console.log('[!wtf] sourceText. getting ready to explain...', { sourceText });
        const reply = await WtfResponder.explainCloseness({
          challengeNumber,
          raw: sourceText,
        });
        console.log('[!wtf] reply', { reply });
        if (!reply) {
          res.status(200).json({ handled: true, action: 'wtf-noop' });
          return;
        }

        // Build richtext with reply and a small superscript note
        const builder = new RichTextBuilder();
        builder.paragraph((p) => {
          p.text({ text: reply });
        });
        const note = "I'm a sometimes helpful bot and can make mistakes.";
        builder.paragraph((p) => {
          p.text({
            text: note,
            formatting: [[FormattingFlag.superscript, 0, note.length]],
          });
        });

        console.log('[!wtf] submitting comment', { commentId, richtext: builder });
        await reddit.submitComment({ id: commentId as any, richtext: builder });
        console.log('[!wtf] comment submitted', { commentId });
        res.status(200).json({ handled: true, action: 'wtf-replied' });
        return;
      } catch (e) {
        console.error('Failed to handle !wtf', e);
        res.status(200).json({ handled: false, error: 'wtf-failed' });
        return;
      }
    }

    // Nothing to do
    res.status(200).json({ handled: true, action: 'noop' });
  } catch (err: any) {
    console.error('Failed on-comment-create trigger', err);
    res.status(200).json({ handled: false, error: err?.message });
  }
});
// [queue] Peek next 3 queued challenges (immediate action)
app.post('/internal/menu/peek', async (_req, res): Promise<void> => {
  try {
    const items = await WordQueue.peekAll();
    const nextThree = items.slice(0, 3).map((c) => c.word);
    const text =
      nextThree.length === 0
        ? 'Queue is empty'
        : nextThree.length === 1
          ? `Next word: ${nextThree[0]}`
          : `Next ${nextThree.length} words: ${nextThree.join(', ')}`;

    res.status(200).json({
      showToast: {
        text,
        appearance: 'success',
      },
    });
  } catch (err: any) {
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to peek queue',
        appearance: 'neutral',
      },
    });
  }
});
// [migrate] Backfill secret words for challenges 1-25 (immediate action)
app.post('/internal/menu/migrate-secret-words', async (_req, res): Promise<void> => {
  // Ordered words for challenges 1-25
  const words = [
    'loud',
    'west',
    'deal',
    'black',
    'finish',
    'analysis',
    'river',
    'idea',
    'open',
    'soft',
    'element',
    'minute',
    'engage',
    'chair',
    'need',
    'sun',
    'effect',
    'watch',
    'glass',
    'gold',
    'seek',
    'diversify',
    'variable',
    'light',
    'dimension',
  ] as const;

  const optionalKeys = [
    'totalPlayers',
    'totalSolves',
    'totalGuesses',
    'totalHints',
    'totalGiveUps',
  ] as const;

  let updated = 0;
  let skippedMissing = 0;
  const failures: Array<{ challengeNumber: number; error: string }> = [];

  const current = await Challenge.getCurrentChallengeNumber();
  const limit = Math.max(0, Math.min(current, words.length));

  for (let i = 1; i <= limit; i++) {
    const word = words[i - 1];
    try {
      // Read existing config directly to avoid strict parsing that requires secretWord
      const existing = await redis.hGetAll(Challenge.ChallengeKey(i));

      // Skip if this challenge hash does not exist in this environment
      if (!existing || Object.keys(existing).length === 0) {
        skippedMissing++;
        continue;
      }

      if (!word) {
        throw new Error(`Missing word for challenge ${i}`);
      }

      // Build a minimal valid config while preserving known optional counters
      const config: Record<string, string> = {
        challengeNumber: String(i),
        secretWord: word,
        ...optionalKeys.reduce(
          (acc, k) => {
            const v = (existing as any)[k];
            if (typeof v === 'string' && v.length > 0) acc[k] = v;
            return acc;
          },
          {} as Record<string, string>
        ),
      };

      await Challenge.setChallenge({ challengeNumber: i, config: config as any });
      updated++;
    } catch (e: any) {
      failures.push({ challengeNumber: i, error: e?.message ?? String(e) });
    }
  }

  const text =
    failures.length === 0
      ? `Migration complete: updated ${updated}, skipped missing ${skippedMissing}`
      : `Migration finished: updated ${updated}, skipped missing ${skippedMissing}, errors for ${failures.length}`;

  res.status(200).json({
    showToast: {
      text,
      appearance: failures.length === 0 ? 'success' : 'neutral',
    },
  });
});
app.post('/internal/scheduler/create-new-challenge', async (_req, res): Promise<void> => {
  try {
    console.log('[Scheduler] create-new-challenge invoked');
    const result = await Challenge.ensureLatestClassicPostOrRetry();
    console.log('[Scheduler] create-new-challenge result', result);
    res.json({ status: 'success', result });
  } catch (error) {
    console.error(`Error creating new challenge from scheduler: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create or ensure post',
    });
  }
});
app.post('/internal/scheduler/update-post-data', async (_req, res): Promise<void> => {
  try {
    console.log('[Scheduler] update-post-data invoked');
    const result = await Challenge.updatePostDataForRecentChallenges();
    console.log('[Scheduler] update-post-data completed', { updated: result.updated });
    res.json({
      status: 'success',
      updated: result.updated,
    });
  } catch (error) {
    console.error('Error updating post data from scheduler:', error);
    res.status(400).json({
      status: 'error',
      message: 'Failed to update post data',
    });
  }
});

// Retry: Ensure a challenge exists shortly after the main cron time and a few times later.
// This endpoint is idempotent and safe to call; it will create only if missing for today,
// maintain unique challenge numbers, and enqueue notifications at most once.
app.post('/internal/scheduler/create-new-challenge-retry', async (_req, res): Promise<void> => {
  try {
    console.log('[Scheduler] create-new-challenge-retry invoked');
    const result = await Challenge.ensureLatestClassicPostOrRetry();
    console.log('[Scheduler] create-new-challenge-retry result', result);
    res.json({ status: 'success', result });
  } catch (error) {
    console.error('Error in create-new-challenge-retry:', error);
    res.status(400).json({ status: 'error', message: 'Retry failed' });
  }
});

// Backup sweeper: drains any due groups that may have been missed by the
// precise one-off job executor. See Notifications.sendDueGroups and
// the architecture notes in Notifications for details.
app.post('/internal/scheduler/notifications-backup-sweep', async (_req, res): Promise<void> => {
  try {
    console.log('[Scheduler] notifications-backup-sweep invoked');
    const { processed, sent } = await Notifications.sendDueGroups({ limit: 10 });
    console.log('[Scheduler] notifications-backup-sweep completed', { processed, sent });
    res.json({ status: 'success', processed, sent });
  } catch (error) {
    console.error('Error processing notifications:', error);
    res.status(400).json({ status: 'error', message: 'Failed to process notifications' });
  }
});

// One-off job target for scheduled timezone groups
app.post('/internal/scheduler/notifications-send-group', async (req, res): Promise<void> => {
  try {
    console.log('[Scheduler] [Notifications] notifications-send-group invoked', req.body);
    const body = (req.body as any) ?? {};
    const groupId: string | undefined = body?.data?.groupId as string | undefined;
    if (!groupId) {
      res.status(400).json({ status: 'error', message: 'groupId is required' });
      return;
    }
    console.log('[Scheduler] notifications-send-group invoked', { groupId });
    const result = await Notifications.sendGroupNow({ groupId });
    console.log('[Scheduler] notifications-send-group completed', { groupId, result });
    res.json({ status: 'success', result });
  } catch (error) {
    console.error('Error sending notification group:', error);
    res.status(400).json({ status: 'error', message: 'Failed to send group' });
  }
});

// Enqueue new challenge notifications (job target)
app.post(
  '/internal/scheduler/notifications-enqueue-new-challenge',
  async (req, res): Promise<void> => {
    try {
      console.log('[Scheduler] notifications-enqueue-new-challenge invoked', req.body);
      const body = (req.body as any) ?? {};
      const data = body?.data ?? {};
      const challengeNumber = Number(data.challengeNumber);
      const postId = String(data.postId);
      const postUrl = String(data.postUrl);

      if (!challengeNumber || !postId) {
        res.status(400).json({ status: 'error', message: 'Missing challengeNumber or postId' });
        return;
      }

      await Notifications.enqueueNewChallengeByTimezone({
        challengeNumber,
        postId,
        postUrl,
      });
      console.log('[Scheduler] notifications-enqueue-new-challenge completed');
      res.json({ status: 'success' });
    } catch (error) {
      console.error('Error enqueuing new challenge notifications:', error);
      res.status(400).json({ status: 'error', message: 'Failed to enqueue notifications' });
    }
  }
);

// Notifications management menu
app.post('/internal/menu/notifications/manage', async (_req, res): Promise<void> => {
  res.status(200).json({
    showForm: {
      name: 'notificationsManageForm',
      form: {
        title: 'Manage notifications queue',
        acceptLabel: 'Run',
        fields: [
          {
            name: 'action',
            label: 'Action',
            type: 'select',
            options: [
              { label: 'Show stats', value: 'stats' },
              { label: 'Process now (200)', value: 'process' },
              { label: 'Clear queue', value: 'clear' },
            ],
            defaultValue: 'stats',
          },
        ],
      },
    },
  });
});

app.post('/internal/menu/admin/cleanup-cache', async (_req, res): Promise<void> => {
  res.status(200).json({
    showForm: {
      name: 'cleanupCacheForm',
      form: {
        title: 'Clear cache for users without reminders',
        acceptLabel: 'Start cleanup',
        fields: [
          {
            name: 'startAt',
            label: 'Start cursor (default 0)',
            type: 'number',
            defaultValue: 0,
          },
          {
            name: 'totalIterations',
            label: 'Maximum scan iterations',
            type: 'number',
            defaultValue: 1000,
          },
          {
            name: 'count',
            label: 'Count per hScan (1-1000)',
            type: 'number',
            defaultValue: 250,
          },
        ],
      },
    },
  });
});

app.post('/internal/menu/admin/toggle-cleanup-cancel', async (_req, res): Promise<void> => {
  try {
    const currentlyCancelled = await Reminders.isCleanupJobCancelled();
    const nextState = !currentlyCancelled;
    await Reminders.setCleanupJobCancelled(nextState);

    res.status(200).json({
      showToast: nextState
        ? 'Cleanup cancel flag enabled. Future jobs will halt after the current run.'
        : 'Cleanup cancel flag disabled. Cleanup jobs may resume.',
    });
  } catch (err: any) {
    console.error('Failed to toggle cleanup cancel flag', err);
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to toggle cleanup cancel flag',
      },
    });
  }
});

// [ops] Toggle UserGuess migration (immediate action)
app.post(
  '/internal/menu/admin/migrate-user-guess-compression/toggle',
  async (_req, res): Promise<void> => {
    try {
      const currentlyDisabled = (await redis.get(USER_GUESS_MIGRATION_DISABLED_KEY)) === '1';
      if (currentlyDisabled) {
        await redis.del(USER_GUESS_MIGRATION_DISABLED_KEY);
      } else {
        await redis.set(USER_GUESS_MIGRATION_DISABLED_KEY, '1');
      }

      res.status(200).json({
        showToast: currentlyDisabled
          ? 'UserGuess migration re-enabled.'
          : 'UserGuess migration paused.',
      });
    } catch (err: any) {
      console.error('Failed to toggle UserGuess migration', err);
      res.status(500).json({
        showToast: { text: err?.message || 'Failed to toggle migration', appearance: 'neutral' },
      });
    }
  }
);

// [ops] Toggle ChallengeProgress migration (immediate action)
app.post(
  '/internal/menu/admin/migrate-challenge-progress-compression/toggle',
  async (_req, res): Promise<void> => {
    try {
      const currentlyDisabled =
        (await redis.get(CHALLENGE_PROGRESS_MIGRATION_DISABLED_KEY)) === '1';
      if (currentlyDisabled) {
        await redis.del(CHALLENGE_PROGRESS_MIGRATION_DISABLED_KEY);
      } else {
        await redis.set(CHALLENGE_PROGRESS_MIGRATION_DISABLED_KEY, '1');
      }

      res.status(200).json({
        showToast: currentlyDisabled
          ? 'ChallengeProgress migration re-enabled.'
          : 'ChallengeProgress migration paused.',
      });
    } catch (err: any) {
      console.error('Failed to toggle ChallengeProgress migration', err);
      res.status(500).json({
        showToast: {
          text: err?.message || 'Failed to toggle ChallengeProgress migration',
          appearance: 'neutral',
        },
      });
    }
  }
);

// [ops] Toggle User cache migration (immediate action)
app.post(
  '/internal/menu/admin/migrate-user-cache-compression/toggle',
  async (_req, res): Promise<void> => {
    try {
      const currentlyDisabled = (await redis.get(USER_CACHE_MIGRATION_DISABLED_KEY)) === '1';
      if (currentlyDisabled) {
        await redis.del(USER_CACHE_MIGRATION_DISABLED_KEY);
      } else {
        await redis.set(USER_CACHE_MIGRATION_DISABLED_KEY, '1');
      }

      res.status(200).json({
        showToast: currentlyDisabled
          ? 'User cache migration re-enabled.'
          : 'User cache migration paused.',
      });
    } catch (err: any) {
      console.error('Failed to toggle user cache migration', err);
      res.status(500).json({
        showToast: {
          text: err?.message || 'Failed to toggle user cache migration',
          appearance: 'neutral',
        },
      });
    }
  }
);

// [notifications] Send single (form launcher)
app.post('/internal/menu/notifications/send-single', async (_req, res): Promise<void> => {
  let defaultUsername = '';
  let defaultPostId = '';

  try {
    if (context.userId) {
      const user = await User.getCurrent();
      defaultUsername = user.username;
    }
  } catch (e) {
    console.error('Failed to get current user for form default', e);
  }

  try {
    const challengeNumber = await Challenge.getCurrentChallengeNumber();
    if (challengeNumber > 0) {
      const pid = await Challenge.getPostIdForChallenge({ challengeNumber });
      if (pid) defaultPostId = pid;
    }
  } catch (e) {
    console.error('Failed to get current challenge for form default', e);
  }

  res.status(200).json({
    showForm: {
      name: 'notificationsSendSingleForm',
      form: {
        title: 'Send notification to user',
        acceptLabel: 'Send',
        fields: [
          {
            name: 'username',
            label: 'Username (case-sensitive)',
            type: 'string',
            required: true,
            defaultValue: defaultUsername,
          },
          {
            name: 'postId',
            label: 'Post ID (t3_...)',
            type: 'string',
            required: true,
            defaultValue: defaultPostId,
          },
          {
            name: 'title',
            label: 'Title',
            type: 'string',
            required: true,
            defaultValue: 'hello',
          },
          {
            name: 'body',
            label: 'Body',
            type: 'paragraph',
            required: true,
            defaultValue: 'world',
          },
        ],
      },
    },
  });
});

app.post('/internal/form/notifications/manage', async (req, res): Promise<void> => {
  try {
    const { action: actionArray } = (req.body as any) ?? {};
    const action = actionArray[0]!;
    if (action === 'process') {
      const { processed, sent } = await Notifications.sendDueGroups({ limit: 200 });
      res.status(200).json({
        showToast: { text: `Processed ${processed}, sent ${sent}`, appearance: 'success' },
      });
      return;
    }
    if (action === 'clear') {
      await Notifications.clearAllPending();
      res.status(200).json({
        showToast: {
          text: 'Notifications queue cleared',
          appearance: 'success',
        },
      });
      return;
    }
    // default: stats → DM detailed info to invoking moderator
    const { userId } = context;
    if (!userId) {
      res.status(400).json({
        showToast: 'userId is required',
      });
      return;
    }
    const me = await reddit.getUserById(userId);
    if (!me) {
      res.status(400).json({
        showToast: 'Could not resolve current user',
      });
      return;
    }

    const s = await Notifications.pendingStats();
    const lines: string[] = [];
    lines.push('Notifications queue stats');
    lines.push('');
    lines.push(`Total pending groups: ${s.total}`);
    try {
      const challengeNumber = await Challenge.getCurrentChallengeNumber();
      const totalStr = await redis.get(Notifications.ChallengeSentTotalKey(challengeNumber));
      const sentTotal = Number(totalStr || '0') || 0;
      lines.push('');
      lines.push(`Current challenge: #${challengeNumber}`);
      lines.push(`Sent total (attempted enqueues): ${sentTotal}`);
    } catch (e) {
      // ignore failures reading sent counter
    }
    if (s.next.length > 0) {
      lines.push('');
      lines.push('Next groups (up to 10):');
      for (const n of s.next) {
        lines.push(`- ${n.groupId} at ${new Date(n.dueAtMs).toISOString()}`);
      }
    }

    await reddit.sendPrivateMessage({
      to: me.username,
      subject: 'Hot & Cold notifications queue stats',
      text: lines.join('\n'),
    });

    res.status(200).json({
      showToast: { text: 'Sent notifications queue stats via DM', appearance: 'success' },
    });
  } catch (err: any) {
    console.error('Failed notifications manage action', err);
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed notifications manage action',
        appearance: 'neutral',
      },
    });
  }
});

// [notifications] Send single (form handler)
app.post('/internal/form/notifications/send-single', async (req, res): Promise<void> => {
  try {
    const { username, postId, title, body } = (req.body as any) ?? {};
    if (typeof username !== 'string' || username.trim().length === 0) {
      res.status(400).json({
        showToast: { text: 'Username is required', appearance: 'neutral' },
      });
      return;
    }
    if (typeof postId !== 'string' || postId.trim().length === 0) {
      res.status(400).json({
        showToast: { text: 'Post ID is required', appearance: 'neutral' },
      });
      return;
    }
    if (typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({
        showToast: { text: 'Title is required', appearance: 'neutral' },
      });
      return;
    }
    if (typeof body !== 'string' || body.trim().length === 0) {
      res.status(400).json({
        showToast: { text: 'Body is required', appearance: 'neutral' },
      });
      return;
    }

    const result = await Notifications.sendSingleNow({ username, postId, title, body });
    if (!result.ok && result.reason === 'user-not-found') {
      res.status(400).json({
        showToast: { text: `User not found: ${username}`, appearance: 'neutral' },
      });
      return;
    }
    res.status(200).json({
      showToast: { text: `Notification sent to ${username}`, appearance: 'success' },
    });
  } catch (err: any) {
    console.error('Failed to send single notification', err);
    res.status(500).json({
      showToast: { text: err?.message || 'Failed to send notification', appearance: 'neutral' },
    });
  }
});

app.post('/internal/form/admin/cleanup-cache', async (req, res): Promise<void> => {
  try {
    const body = (req.body as any) ?? {};
    const parsedStart = Number.parseInt(String(body?.startAt ?? '0'), 10) || 0;
    const parsedIterations = Number.parseInt(String(body?.totalIterations ?? '1000'), 10) || 1000;
    const parsedCount = Number.parseInt(String(body?.count ?? '250'), 10) || 250;

    if (parsedStart < 0) {
      res.status(400).json({
        showToast: { text: 'Start cursor must be >= 0', appearance: 'neutral' },
      });
      return;
    }
    if (parsedCount < 1 || parsedCount > 1000) {
      res.status(400).json({
        showToast: { text: 'Count must be between 1 and 1000', appearance: 'neutral' },
      });
      return;
    }
    if (parsedIterations < 1 || parsedIterations > 10000) {
      res.status(400).json({
        showToast: { text: 'Iterations must be between 1 and 10000', appearance: 'neutral' },
      });
      return;
    }

    await scheduler.runJob({
      name: 'users-clean-reminderless-cache',
      runAt: new Date(),
      data: { startAt: parsedStart, totalIterations: parsedIterations, count: parsedCount },
    });

    res.status(200).json({
      showToast: {
        text: `Queued cache cleanup job (start=${parsedStart}, iterations=${parsedIterations}, count=${parsedCount})`,
        appearance: 'success',
      },
    });
  } catch (err: any) {
    console.error('Failed to queue cache cleanup job', err);
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to queue cache cleanup job',
        appearance: 'neutral',
      },
    });
  }
});
app.post('/internal/menu/export-last-30-days', async (_req, res): Promise<void> => {
  try {
    const { userId } = context;
    if (!userId) {
      res.status(400).json({
        showToast: 'userId is required',
      });
      return;
    }

    const me = await reddit.getUserById(userId);
    if (!me) {
      res.status(400).json({
        showToast: 'Could not resolve current user',
      });
      return;
    }

    const challenges = await Challenge.exportLast30Days();

    if (challenges.length === 0) {
      const subject = 'Hot & Cold - Last 30 Days Challenge Data';
      const body = 'No challenges found in the last 30 days.';

      await reddit.sendPrivateMessage({
        to: me.username,
        subject,
        text: body,
      });

      res.status(200).json({
        showToast: 'Sent empty challenge data via DM',
      });
      return;
    }

    // Convert challenges to CSV format
    const headers = [
      'Challenge Number',
      'Secret Word',
      'Total Players',
      'Total Solves',
      'Total Guesses',
      'Total Hints',
      'Total Give-ups',
    ];
    const csvRows = [
      headers.join(','),
      ...challenges.map((challenge) =>
        [
          challenge.challengeNumber,
          `"${challenge.secretWord}"`,
          challenge.totalPlayers,
          challenge.totalSolves,
          challenge.totalGuesses,
          challenge.totalHints,
          challenge.totalGiveUps,
        ].join(',')
      ),
    ];

    const csvContent = csvRows.join('\n');
    const subject = 'Hot & Cold - Last 30 Days Challenge Data';
    const body = `Here is the challenge data for the last 30 days:\n\n${csvContent}`;

    await reddit.sendPrivateMessage({
      to: me.username,
      subject,
      text: body,
    });

    res.status(200).json({
      showToast: `Sent ${challenges.length} challenges data via DM`,
    });
  } catch (err: any) {
    console.error('Failed to send challenge data DM', err);
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to send challenge data DM',
        appearance: 'neutral',
      },
    });
  }
});

// [notifications] Dry run notifications for latest challenge (immediate action)
app.post('/internal/menu/notifications/dry-run-latest', async (_req, res): Promise<void> => {
  const handlerStartMs = Date.now();
  console.log('[Menu] notifications dry-run-latest invoked');
  try {
    const { userId } = context;
    if (!userId) {
      res.status(400).json({
        showToast: 'userId is required',
      });
      return;
    }

    const tGetUserStart = Date.now();
    const me = await reddit.getUserById(userId);
    console.log('[Menu] notifications dry-run-latest resolved invoking user', {
      elapsedMs: Date.now() - tGetUserStart,
      hasUser: !!me,
    });
    if (!me) {
      res.status(400).json({
        showToast: 'Could not resolve current user',
      });
      return;
    }

    const tGetChallengeStart = Date.now();
    const challengeNumber = await Challenge.getCurrentChallengeNumber();
    console.log('[Menu] notifications dry-run-latest got current challenge number', {
      challengeNumber,
      elapsedMs: Date.now() - tGetChallengeStart,
    });

    const tGetPostIdStart = Date.now();
    const currentPostId = await Challenge.getPostIdForChallenge({ challengeNumber });
    console.log('[Menu] notifications dry-run-latest got current post id', {
      challengeNumber,
      postId: currentPostId,
      elapsedMs: Date.now() - tGetPostIdStart,
    });

    const enqueueOpts = {
      challengeNumber: Math.max(1, challengeNumber || 1),
      postId: currentPostId ?? 't3_placeholder',
      postUrl: 'https://reddit.com',
      localSendHour: 9,
      localSendMinute: 0,
      dryRun: true as const,
    };
    console.log(
      '[Menu] notifications dry-run-latest calling enqueueNewChallengeByTimezone',
      enqueueOpts
    );
    const tEnqueueStart = Date.now();
    const { groups, totalRecipients } = await Notifications.enqueueNewChallengeByTimezone({
      ...enqueueOpts,
    });
    console.log('[Menu] notifications dry-run-latest enqueue completed', {
      groups: groups.length,
      totalRecipients,
      elapsedMs: Date.now() - tEnqueueStart,
    });

    const subject = 'Hot & Cold - Dry run notifications preview';
    const lines: string[] = [];
    lines.push(`Preview for challenge #${challengeNumber}`);
    lines.push(`Total recipients: ${totalRecipients}`);
    lines.push(`Groups: ${groups.length}`);
    lines.push('');
    for (const g of groups) {
      const when = new Date(g.dueAtMs).toISOString();
      lines.push(`- groupId=${g.groupId} | timezone=${g.zone} | size=${g.size} | dueAtUtc=${when}`);
    }
    const body = lines.join('\n');

    const tDmStart = Date.now();
    await reddit.sendPrivateMessage({
      to: me.username,
      subject,
      text: body,
    });
    console.log('[Menu] notifications dry-run-latest DM sent', {
      to: me.username,
      bodyLength: body.length,
      elapsedMs: Date.now() - tDmStart,
      totalElapsedMs: Date.now() - handlerStartMs,
    });

    res.status(200).json({
      showToast: 'Sent dry-run preview via DM',
    });
  } catch (err: any) {
    console.error('Failed dry-run notifications DM', {
      message: err?.message,
      name: err?.name,
      stack: err?.stack,
      totalElapsedMs: Date.now() - handlerStartMs,
    });
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to send dry-run notifications DM',
        appearance: 'neutral',
      },
    });
  }
});

// Ops menu: kick off PostHog user property sync now
app.post('/internal/menu/analytics/sync-user-props', async (_req, res): Promise<void> => {
  try {
    console.log('[Menu] Starting PostHog user properties sync now');
    await scheduler.runJob({
      name: 'posthog-user-prop-sync',
      runAt: new Date(),
      data: { cursor: 0, limit: 25_000 },
    });
    console.log('[Menu] PostHog user properties sync queued');
    res.status(200).json({
      showToast: { text: 'Started PostHog user properties sync', appearance: 'success' },
    });
  } catch (err: any) {
    console.error('Failed to start PostHog user property sync', err);
    res.status(500).json({
      showToast: { text: err?.message || 'Failed to start sync', appearance: 'neutral' },
    });
  }
});

app.post('/internal/scheduler/users-clean-reminderless-cache', async (req, res): Promise<void> => {
  try {
    const body = (req.body as any) ?? {};
    const data = body?.data ?? {};
    const startAt = Number.parseInt(String(data?.startAt ?? '0'), 10) || 0;
    const totalIterations = Number.parseInt(String(data?.totalIterations ?? '1000'), 10) || 1000;
    const count = Number.parseInt(String(data?.count ?? '250'), 10) || 250;

    const cancelFlag = await Reminders.isCleanupJobCancelled();
    if (cancelFlag) {
      console.log('[UserCacheCleanup] Cancel flag enabled; skipping job run.');
      const stats = await Reminders.getCleanupStats();
      res.json({ status: 'cancelled', reason: 'cancel-flag', stats });
      return;
    }

    const previousStats = await Reminders.getCleanupStats();
    console.log('[UserCacheCleanup] cumulative stats before run', previousStats);

    console.log('[UserCacheCleanup] job start', { startAt, totalIterations, count });
    const result = await Reminders.clearCacheForNonReminderUsers({
      startAt,
      totalIterations,
      count,
    });
    console.log('[UserCacheCleanup] job complete', result);

    const cumulativeStats = await Reminders.recordCleanupRun(result);
    console.log('[UserCacheCleanup] cumulative stats after run', cumulativeStats);

    if (!result.done && result.lastCursor !== 0) {
      console.log('[UserCacheCleanup] Requeueing follow-up job', {
        nextCursor: result.lastCursor,
        examined: result.examined,
        iterations: result.iterations,
      });
      await scheduler.runJob({
        name: 'users-clean-reminderless-cache',
        runAt: new Date(),
        data: {
          startAt: result.lastCursor,
          totalIterations,
          count,
        },
      });
      res.json({
        status: 'success',
        result,
        stats: cumulativeStats,
        requeued: true,
        nextCursor: result.lastCursor,
      });
      return;
    }

    res.json({ status: 'success', result, stats: cumulativeStats, requeued: false });
  } catch (error: any) {
    console.error('[UserCacheCleanup] job failed', error);
    res.status(500).json({
      status: 'error',
      message: error?.message || 'Failed to clean reminderless caches',
    });
  }
});

// Ops menu: Migrate all cached word config entries to gzip compression
app.post('/internal/menu/word-config/migrate-compression', async (_req, res): Promise<void> => {
  console.log('[Menu] Starting word config gzip migration');
  try {
    const currentChallengeNumber = await Challenge.getCurrentChallengeNumber();
    if (currentChallengeNumber <= 0) {
      res.status(200).json({
        showToast: { text: 'No challenges found to migrate', appearance: 'success' },
      });
      return;
    }

    const seenWords = new Set<string>();
    const summary = {
      scannedChallenges: 0,
      uniqueWords: 0,
      migrated: 0,
      missing: 0,
      errors: 0,
    };

    for (let challengeNumber = currentChallengeNumber; challengeNumber >= 1; challengeNumber--) {
      try {
        const challenge = await Challenge.getChallenge({ challengeNumber });
        summary.scannedChallenges++;
        const rawWord = challenge.secretWord?.trim();
        if (!rawWord) continue;
        const normalizedWord = rawWord.toLowerCase();
        if (seenWords.has(normalizedWord)) continue;
        seenWords.add(normalizedWord);
        summary.uniqueWords++;

        const key = WordConfigKey(normalizedWord);
        const val = await redisCompressed.get(key);
        if (val) {
          // Explicitly write back to trigger compression logic in redisCompressed.set
          await redisCompressed.set(key, val);
          summary.migrated++;
        } else {
          summary.missing++;
        }
      } catch (error: any) {
        summary.errors++;
        console.error('[Menu] word-config gzip migration challenge failed', {
          challengeNumber,
          message: error?.message,
        });
      }
    }

    console.log('[Menu] word-config gzip migration complete', {
      ...summary,
      totalChallenges: currentChallengeNumber,
    });

    const toastText =
      summary.uniqueWords === 0
        ? 'No secret words found to migrate'
        : `Word config migration complete: scanned/ensured ${summary.migrated}, missing ${summary.missing}`;

    res.status(200).json({
      showToast: { text: toastText, appearance: 'success' },
    });
  } catch (err: any) {
    console.error('Failed to migrate word config caches', err);
    res.status(500).json({
      showToast: { text: err?.message || 'Failed word config migration', appearance: 'neutral' },
    });
  }
});

// [migrate] Timezones: offsets -> IANA (immediate action)
app.post('/internal/menu/timezones/migrate-to-iana', async (_req, res): Promise<void> => {
  try {
    console.log('[Menu] Starting timezone migration offsets -> IANA');
    const { migrated, skipped } = await Timezones.migrateOffsetsToIana({ batchSize: 500 });
    res.status(200).json({
      showToast: {
        text: `Timezone migration complete: migrated ${migrated}, skipped ${skipped}`,
        appearance: 'success',
      },
    });
  } catch (err: any) {
    console.error('Failed timezone migration offsets -> IANA', err);
    res.status(500).json({
      showToast: { text: err?.message || 'Failed timezone migration', appearance: 'neutral' },
    });
  }
});

// [ops] Delete legacy reminders keys (immediate action)
app.post('/internal/menu/admin/delete-old-reminders-keys', async (_req, res): Promise<void> => {
  try {
    await Reminders.deleteOldReminderKeys();
    res.status(200).json({
      showToast: { text: 'Deleted legacy reminders keys', appearance: 'success' },
    });
  } catch (err: any) {
    console.error('Failed to delete legacy reminders keys', err);
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to delete legacy reminders keys',
        appearance: 'neutral',
      },
    });
  }
});

// [ops] Migrate UserGuess compression (form launcher)
app.post(
  '/internal/menu/admin/migrate-user-guess-compression',
  async (_req, res): Promise<void> => {
    res.status(200).json({
      showForm: {
        name: 'migrateUserGuessForm',
        form: {
          title: 'Migrate UserGuess compression',
          acceptLabel: 'Start Migration',
          fields: [
            {
              name: 'startChallenge',
              label: 'Start Challenge Number',
              type: 'number',
              required: true,
              defaultValue: 1,
            },
            {
              name: 'endChallenge',
              label: 'End Challenge Number',
              type: 'number',
              required: true,
            },
            {
              name: 'chunkSize',
              label: 'Chunk Size (users per batch)',
              type: 'number',
              defaultValue: 500,
            },
          ],
        },
      },
    });
  }
);

// [ops] Migrate UserGuess compression (form handler)
app.post('/internal/form/admin/migrate-user-guess-compression', async (req, res): Promise<void> => {
  try {
    const { startChallenge, endChallenge, chunkSize } = (req.body as any) ?? {};
    const start = Number(startChallenge);
    const end = Number(endChallenge);
    const chunk = Number(chunkSize) || 50;

    const migrationDisabled = (await redis.get(USER_GUESS_MIGRATION_DISABLED_KEY)) === '1';
    if (migrationDisabled) {
      res.status(400).json({
        showToast: {
          text: 'Migration is currently paused. Toggle it back on to run.',
          appearance: 'neutral',
        },
      });
      return;
    }

    if (!start || !end || start > end) {
      res.status(400).json({
        showToast: { text: 'Invalid challenge range', appearance: 'neutral' },
      });
      return;
    }

    await scheduler.runJob({
      name: 'migrate-user-guess-compression',
      runAt: new Date(),
      data: {
        startChallenge: start,
        endChallenge: end,
        chunkSize: chunk,
        currentChallenge: start,
        cursor: 0,
        processed: 0,
      },
    });

    res.status(200).json({
      showToast: {
        text: `Migration started for challenges ${start}-${end}`,
        appearance: 'success',
      },
    });
  } catch (err: any) {
    console.error('Failed to start migration', err);
    res.status(500).json({
      showToast: { text: err?.message || 'Failed to start migration', appearance: 'neutral' },
    });
  }
});

// Scheduler: migrate-user-guess-compression
app.post('/internal/scheduler/migrate-user-guess-compression', async (req, res): Promise<void> => {
  const startTime = Date.now();
  try {
    const body = (req.body as any) ?? {};
    const data = body?.data ?? {};
    const startChallenge = Number(data.startChallenge);
    const endChallenge = Number(data.endChallenge);
    const chunkSize = Number(data.chunkSize) || 500;
    let currentChallenge = Number(data.currentChallenge) || startChallenge;
    let cursor = Number(data.cursor) || 0;
    const processedTotal = Number(data.processed) || 0;

    const migrationDisabled = (await redis.get(USER_GUESS_MIGRATION_DISABLED_KEY)) === '1';
    if (migrationDisabled) {
      console.log('[MigrateCompression] Skipping job because migration is disabled via toggle');
      res.json({ status: 'disabled', processed: processedTotal });
      return;
    }

    console.log('[MigrateCompression] Job start', {
      currentChallenge,
      endChallenge,
      cursor,
      chunkSize,
    });

    let keepRunning = true;
    let processedInJob = 0;
    const ZSCAN_COUNT = 250;

    while (keepRunning && currentChallenge <= endChallenge) {
      if (processedInJob >= chunkSize) {
        keepRunning = false;
        break;
      }

      // Find users who played this challenge
      const key = ChallengeProgress.StartKey(currentChallenge);
      // zScan returns { cursor: number, members: [] } for Devvit redis client
      const { cursor: nextCursor, members } = await redis.zScan(
        key,
        cursor,
        undefined,
        ZSCAN_COUNT
      );

      // Migrate each user found in parallel to stay within the 30s window
      await Promise.allSettled(
        members.map(async (member) => {
          const username = member.member;
          const userKey = UserGuess.Key(currentChallenge, username);
          try {
            // Read (decompress if needed)
            const data = await redisCompressed.hGetAll(userKey);
            if (data && Object.keys(data).length > 0) {
              // Write (compress)
              await redisCompressed.hSet(userKey, data);
            }
          } catch (error) {
            console.error('[MigrateCompression] Failed user', { userKey, error });
          }
        })
      );

      processedInJob += members.length;

      // Prepare for next iteration
      if (nextCursor === 0) {
        // Finished this challenge
        currentChallenge++;
        cursor = 0;
      } else {
        // Continue this challenge
        cursor = nextCursor;
      }

      // Check time limit (safety buffer for 30s timeout)
      if (Date.now() - startTime > 20000) {
        keepRunning = false;
      }
    }

    const newProcessedTotal = processedTotal + processedInJob;

    const disabledAfterRun = (await redis.get(USER_GUESS_MIGRATION_DISABLED_KEY)) === '1';
    if (disabledAfterRun) {
      console.log('[MigrateCompression] Migration disabled mid-run; not requeueing', {
        currentChallenge,
      });
      res.json({ status: 'disabled', processed: newProcessedTotal });
      return;
    }

    if (currentChallenge <= endChallenge) {
      // Requeue
      await scheduler.runJob({
        name: 'migrate-user-guess-compression',
        runAt: new Date(),
        data: {
          startChallenge,
          endChallenge,
          chunkSize,
          currentChallenge,
          cursor,
          processed: newProcessedTotal,
        },
      });
      console.log('[MigrateCompression] Requeued', {
        currentChallenge,
        cursor,
        processed: newProcessedTotal,
      });
      res.json({
        status: 'requeued',
        processed: newProcessedTotal,
        nextChallenge: currentChallenge,
      });
    } else {
      // Done
      console.log('[MigrateCompression] Done', { processed: newProcessedTotal });
      res.json({ status: 'success', processed: newProcessedTotal });
    }
  } catch (err: any) {
    console.error('[MigrateCompression] Job failed', err);
    res.status(500).json({ status: 'error', message: err?.message });
  }
});

// [ops] Migrate ChallengeProgress compression (form launcher)
app.post(
  '/internal/menu/admin/migrate-challenge-progress-compression',
  async (_req, res): Promise<void> => {
    res.status(200).json({
      showForm: {
        name: 'migrateChallengeProgressForm',
        form: {
          title: 'Migrate ChallengeProgress compression',
          acceptLabel: 'Start Migration',
          fields: [
            {
              name: 'startChallenge',
              label: 'Start Challenge Number',
              type: 'number',
              required: true,
              defaultValue: 1,
            },
            {
              name: 'endChallenge',
              label: 'End Challenge Number',
              type: 'number',
              required: true,
            },
            {
              name: 'chunkSize',
              label: 'Chunk Size (players per batch)',
              type: 'number',
              defaultValue: 500,
            },
          ],
        },
      },
    });
  }
);

// [ops] Migrate ChallengeProgress compression (form handler)
app.post(
  '/internal/form/admin/migrate-challenge-progress-compression',
  async (req, res): Promise<void> => {
    try {
      const { startChallenge, endChallenge, chunkSize } = (req.body as any) ?? {};
      const start = Number(startChallenge);
      const end = Number(endChallenge);
      const chunk = Number(chunkSize) || 500;

      const migrationDisabled =
        (await redis.get(CHALLENGE_PROGRESS_MIGRATION_DISABLED_KEY)) === '1';
      if (migrationDisabled) {
        res.status(400).json({
          showToast: {
            text: 'ChallengeProgress migration is currently paused. Toggle it back on to run.',
            appearance: 'neutral',
          },
        });
        return;
      }

      if (!start || !end || start > end) {
        res.status(400).json({
          showToast: { text: 'Invalid challenge range', appearance: 'neutral' },
        });
        return;
      }

      await scheduler.runJob({
        name: 'migrate-challenge-progress-compression',
        runAt: new Date(),
        data: {
          startChallenge: start,
          endChallenge: end,
          chunkSize: chunk,
          currentChallenge: start,
          cursor: 0,
          processed: 0,
        },
      });

      res.status(200).json({
        showToast: {
          text: `ChallengeProgress migration started for challenges ${start}-${end}`,
          appearance: 'success',
        },
      });
    } catch (err: any) {
      console.error('Failed to start ChallengeProgress migration', err);
      res.status(500).json({
        showToast: {
          text: err?.message || 'Failed to start ChallengeProgress migration',
          appearance: 'neutral',
        },
      });
    }
  }
);

// Scheduler: migrate-challenge-progress-compression
app.post(
  '/internal/scheduler/migrate-challenge-progress-compression',
  async (req, res): Promise<void> => {
    const startTime = Date.now();
    try {
      const body = (req.body as any) ?? {};
      const data = body?.data ?? {};
      const startChallenge = Number(data.startChallenge);
      const endChallenge = Number(data.endChallenge);
      const chunkSize = Number(data.chunkSize) || 500;
      let currentChallenge = Number(data.currentChallenge) || startChallenge;
      let cursor = Number(data.cursor) || 0;
      const processedTotal = Number(data.processed) || 0;

      const migrationDisabled =
        (await redis.get(CHALLENGE_PROGRESS_MIGRATION_DISABLED_KEY)) === '1';
      if (migrationDisabled) {
        console.log('[ChallengeProgressMigration] Skipping job because migration is disabled');
        res.json({ status: 'disabled', processed: processedTotal });
        return;
      }

      // Get latest challenge number for age estimation fallback
      const currentMaxChallenge = await Challenge.getCurrentChallengeNumber().catch(() => 0);
      const LATEST_CHALLENGES_TO_KEEP = 8;
      const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;

      console.log('[ChallengeProgressMigration] Job start', {
        currentChallenge,
        endChallenge,
        cursor,
        chunkSize,
      });

      let keepRunning = true;
      let processedInJob = 0;
      const HSCAN_COUNT = 250;

      while (keepRunning && currentChallenge <= endChallenge) {
        if (processedInJob >= chunkSize) {
          keepRunning = false;
          break;
        }

        // Check expiry/retention at the start of processing a challenge
        if (cursor === 0) {
          const startKey = ChallengeProgress.StartKey(currentChallenge);
          const infoKey = ChallengeProgress.PlayerInfoHashKey(currentChallenge);
          const progressKey = `challenge:${currentChallenge}:players:progress`; // Old key to remove

          // If challenge is older than the latest 8, delete it
          // We allow a small buffer if currentMaxChallenge is somehow 0
          if (
            currentMaxChallenge > 0 &&
            currentChallenge <= currentMaxChallenge - LATEST_CHALLENGES_TO_KEEP
          ) {
            console.log('[ChallengeProgressMigration] Deleting expired challenge data', {
              currentChallenge,
              currentMaxChallenge,
            });
            await Promise.all([redis.del(startKey), redis.del(infoKey), redis.del(progressKey)]);
            currentChallenge++;
            // Check time budget even if we just deleted
            if (Date.now() - startTime > 20000) {
              keepRunning = false;
            }
            continue;
          }

          // Not expired: Ensure TTL is set correctly
          // Use a fixed 8 day TTL for active challenges to ensure they auto-expire later
          await Promise.all([
            redis.expire(startKey, EIGHT_DAYS_MS / 1000),
            redis.expire(infoKey, EIGHT_DAYS_MS / 1000),
            // Cleanup the old progress key if it still exists for this active challenge
            redis.del(progressKey),
          ]);
        }

        const key = ChallengeProgress.PlayerInfoHashKey(currentChallenge);
        const { cursor: nextCursor, fieldValues } = await redis.hScan(
          key,
          cursor,
          undefined,
          HSCAN_COUNT
        );

        await Promise.allSettled(
          fieldValues.map(async ({ field }) => {
            try {
              const raw = await redisCompressed.hGet(key, field);
              if (typeof raw === 'string' && raw.length > 0) {
                await redisCompressed.hSet(key, { [field]: raw });
              }
            } catch (error) {
              console.error('[ChallengeProgressMigration] Failed field', { key, field, error });
            }
          })
        );

        processedInJob += fieldValues.length;

        if (nextCursor === 0) {
          currentChallenge++;
          cursor = 0;
        } else {
          cursor = nextCursor;
        }

        if (Date.now() - startTime > 20000) {
          keepRunning = false;
        }
      }

      const newProcessedTotal = processedTotal + processedInJob;

      const disabledAfterRun = (await redis.get(CHALLENGE_PROGRESS_MIGRATION_DISABLED_KEY)) === '1';
      if (disabledAfterRun) {
        console.log('[ChallengeProgressMigration] Disabled mid-run; not requeueing', {
          currentChallenge,
        });
        res.json({ status: 'disabled', processed: newProcessedTotal });
        return;
      }

      if (currentChallenge <= endChallenge) {
        await scheduler.runJob({
          name: 'migrate-challenge-progress-compression',
          runAt: new Date(),
          data: {
            startChallenge,
            endChallenge,
            chunkSize,
            currentChallenge,
            cursor,
            processed: newProcessedTotal,
          },
        });
        console.log('[ChallengeProgressMigration] Requeued', {
          currentChallenge,
          cursor,
          processed: newProcessedTotal,
        });
        res.json({
          status: 'requeued',
          processed: newProcessedTotal,
          nextChallenge: currentChallenge,
        });
      } else {
        console.log('[ChallengeProgressMigration] Done', { processed: newProcessedTotal });
        res.json({ status: 'success', processed: newProcessedTotal });
      }
    } catch (err: any) {
      console.error('[ChallengeProgressMigration] Job failed', err);
      res.status(500).json({ status: 'error', message: err?.message });
    }
  }
);

// [ops] Migrate User cache compression (form launcher)
app.post(
  '/internal/menu/admin/migrate-user-cache-compression',
  async (_req, res): Promise<void> => {
    res.status(200).json({
      showForm: {
        name: 'migrateUserCacheForm',
        form: {
          title: 'Migrate user cache compression',
          acceptLabel: 'Start Migration',
          fields: [
            {
              name: 'startCursor',
              label: 'Start cursor (hScan)',
              type: 'number',
              defaultValue: 0,
            },
            {
              name: 'chunkSize',
              label: 'Chunk Size (users per batch)',
              type: 'number',
              defaultValue: 500,
            },
          ],
        },
      },
    });
  }
);

// [ops] Migrate User cache compression (form handler)
app.post('/internal/form/admin/migrate-user-cache-compression', async (req, res): Promise<void> => {
  try {
    const { startCursor, chunkSize } = (req.body as any) ?? {};
    const cursor = Math.max(0, Number(startCursor) || 0);
    const chunk = Math.max(1, Number(chunkSize) || 500);

    const migrationDisabled = (await redis.get(USER_CACHE_MIGRATION_DISABLED_KEY)) === '1';
    if (migrationDisabled) {
      res.status(400).json({
        showToast: {
          text: 'User cache migration is currently paused. Toggle it back on to run.',
          appearance: 'neutral',
        },
      });
      return;
    }

    await scheduler.runJob({
      name: 'migrate-user-cache-compression',
      runAt: new Date(),
      data: {
        cursor,
        chunkSize: chunk,
        processed: 0,
      },
    });

    res.status(200).json({
      showToast: {
        text: `User cache migration started (cursor=${cursor}, chunk=${chunk})`,
        appearance: 'success',
      },
    });
  } catch (err: any) {
    console.error('Failed to start user cache migration', err);
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to start user cache migration',
        appearance: 'neutral',
      },
    });
  }
});

// Scheduler: migrate-user-cache-compression
app.post('/internal/scheduler/migrate-user-cache-compression', async (req, res): Promise<void> => {
  const startTime = Date.now();
  try {
    const body = (req.body as any) ?? {};
    const data = body?.data ?? {};
    const chunkSize = Math.max(1, Number(data.chunkSize) || 500);
    let cursor = Math.max(0, Number(data.cursor) || 0);
    const processedTotal = Number(data.processed) || 0;

    const migrationDisabled = (await redis.get(USER_CACHE_MIGRATION_DISABLED_KEY)) === '1';
    if (migrationDisabled) {
      console.log('[UserCacheMigration] Skipping job because migration is disabled via toggle');
      res.json({ status: 'disabled', processed: processedTotal, cursor });
      return;
    }

    console.log('[UserCacheMigration] Job start', { cursor, chunkSize });

    let keepRunning = true;
    let processedInJob = 0;
    let done = false;
    const HSCAN_COUNT = 250;

    while (keepRunning) {
      if (processedInJob >= chunkSize) break;

      const { cursor: nextCursor, fieldValues } = await redis.hScan(
        User.UsernameToIdKey(),
        cursor,
        undefined,
        HSCAN_COUNT
      );

      await Promise.allSettled(
        fieldValues.map(async ({ field: username, value: id }) => {
          if (!id || !username) return;
          const key = User.Key(id);
          try {
            const ttl = await redis.expireTime(key);
            const raw = await redisCompressed.get(key);
            if (typeof raw === 'string' && raw.length > 0) {
              await redisCompressed.set(key, raw);
              if (ttl > 0) {
                const now = Math.floor(Date.now() / 1000);
                const remaining = ttl - now;
                if (remaining > 0) {
                  await redis.expire(key, remaining);
                }
              } else if (ttl === -2) {
                await redis.expire(key, User.CacheTtlSeconds);
              }
            }
          } catch (error) {
            console.error('[UserCacheMigration] Failed key', { key, error });
          }
        })
      );

      processedInJob += fieldValues.length;

      if (nextCursor === 0) {
        done = true;
        cursor = 0;
        break;
      } else {
        cursor = nextCursor;
      }

      if (Date.now() - startTime > 20000) {
        keepRunning = false;
      }
    }

    const newProcessedTotal = processedTotal + processedInJob;

    const disabledAfterRun = (await redis.get(USER_CACHE_MIGRATION_DISABLED_KEY)) === '1';
    if (disabledAfterRun) {
      console.log('[UserCacheMigration] Disabled mid-run; not requeueing', { cursor });
      res.json({ status: 'disabled', processed: newProcessedTotal, cursor });
      return;
    }

    if (!done) {
      await scheduler.runJob({
        name: 'migrate-user-cache-compression',
        runAt: new Date(),
        data: {
          cursor,
          chunkSize,
          processed: newProcessedTotal,
        },
      });
      console.log('[UserCacheMigration] Requeued', { cursor, processed: newProcessedTotal });
      res.json({
        status: 'requeued',
        processed: newProcessedTotal,
        cursor,
      });
    } else {
      console.log('[UserCacheMigration] Done', { processed: newProcessedTotal });
      res.json({ status: 'success', processed: newProcessedTotal });
    }
  } catch (err: any) {
    console.error('[UserCacheMigration] Job failed', err);
    res.status(500).json({ status: 'error', message: err?.message });
  }
});

// [debug] Peek user guess (form launcher)
app.post('/internal/menu/debug/peek-guess', async (_req, res): Promise<void> => {
  try {
    let currentChallenge = 1;
    try {
      currentChallenge = await Challenge.getCurrentChallengeNumber();
    } catch {
      // ignore
    }

    res.status(200).json({
      showForm: {
        name: 'peekUserGuessForm',
        form: {
          title: 'Peek user guess (Raw/Decompressed)',
          acceptLabel: 'Peek',
          fields: [
            {
              name: 'challengeNumber',
              label: 'Challenge Number',
              type: 'number',
              required: true,
              defaultValue: currentChallenge,
            },
            {
              name: 'username',
              label: 'Username (leave empty for current user)',
              type: 'string',
            },
          ],
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to open peek form',
        appearance: 'neutral',
      },
    });
  }
});

// [debug] Peek user guess (form handler)
app.post('/internal/form/debug/peek-guess', async (req, res): Promise<void> => {
  try {
    const { challengeNumber, username: inputUsername } = (req.body as any) ?? {};
    const parsedChallengeNumber = Number(challengeNumber);

    if (!parsedChallengeNumber || parsedChallengeNumber <= 0) {
      res.status(400).json({
        showToast: { text: 'Invalid challenge number', appearance: 'neutral' },
      });
      return;
    }

    let targetUsername = inputUsername;
    if (
      !targetUsername ||
      typeof targetUsername !== 'string' ||
      targetUsername.trim().length === 0
    ) {
      // If no username provided, try to use the invoker's username
      const { userId } = context;
      if (userId) {
        const me = await reddit.getUserById(userId);
        if (me) {
          targetUsername = me.username;
        }
      }
    }

    if (!targetUsername) {
      res.status(400).json({
        showToast: { text: 'Could not resolve a username to peek', appearance: 'neutral' },
      });
      return;
    }

    // Clean username
    targetUsername = targetUsername.trim();

    const key = UserGuess.Key(parsedChallengeNumber, targetUsername);

    // Parallel fetch
    const [raw, decompressed] = await Promise.all([
      redis.hGetAll(key),
      redisCompressed.hGetAll(key),
    ]);

    const { userId } = context;
    if (!userId) {
      res.status(400).json({
        showToast: { text: 'No calling user found to DM', appearance: 'neutral' },
      });
      return;
    }
    const me = await reddit.getUserById(userId);
    if (!me) {
      res.status(400).json({
        showToast: { text: 'Calling user not found', appearance: 'neutral' },
      });
      return;
    }

    const subject = `Debug Peek: ${targetUsername} (Challenge #${parsedChallengeNumber})`;
    const body = [
      `**Key**: \`${key}\``,
      '',
      '**Raw (redis.hGetAll)**:',
      '```json',
      JSON.stringify(raw ?? {}, null, 2),
      '```',
      '',
      '**Decompressed (redisCompressed.hGetAll)**:',
      '```json',
      JSON.stringify(decompressed ?? {}, null, 2),
      '```',
    ].join('\n');

    await reddit.sendPrivateMessage({
      to: me.username,
      subject,
      text: body,
    });

    res.status(200).json({
      showToast: {
        text: `Sent peek data for ${targetUsername} via DM`,
        appearance: 'success',
      },
    });
  } catch (err: any) {
    console.error('Failed to peek user guess', err);
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to peek user guess',
        appearance: 'neutral',
      },
    });
  }
});

// [stats] Common words (form launcher)
app.post('/internal/menu/stats/common-words', async (_req, res): Promise<void> => {
  try {
    const current = await Challenge.getCurrentChallengeNumber();
    res.status(200).json({
      showForm: {
        name: 'commonWordsForm',
        form: {
          title: 'Analyze Common Words',
          acceptLabel: 'Start Analysis',
          fields: [
            {
              name: 'startChallenge',
              label: 'Start Challenge',
              type: 'number',
              required: true,
              defaultValue: 1,
            },
            {
              name: 'endChallenge',
              label: 'End Challenge',
              type: 'number',
              required: true,
              defaultValue: current,
            },
          ],
        },
      },
    });
  } catch (err: any) {
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to open form',
        appearance: 'neutral',
      },
    });
  }
});

// [stats] Common words (form handler)
app.post('/internal/form/stats/common-words', async (req, res): Promise<void> => {
  try {
    const { startChallenge, endChallenge } = (req.body as any) ?? {};
    const start = Number(startChallenge);
    const end = Number(endChallenge);

    if (!start || !end || start > end) {
      res.status(400).json({
        showToast: { text: 'Invalid challenge range', appearance: 'neutral' },
      });
      return;
    }

    const { userId } = context;
    if (!userId) {
      res.status(400).json({
        showToast: { text: 'User not found', appearance: 'neutral' },
      });
      return;
    }

    const user = await reddit.getUserById(userId);
    if (!user) {
      res.status(400).json({
        showToast: { text: 'User not found', appearance: 'neutral' },
      });
      return;
    }

    const { jobId } = await CommonWordsAggregator.startJob({
      startChallenge: start,
      endChallenge: end,
      initiatorUsername: user.username,
    });

    res.status(200).json({
      showToast: {
        text: `Analysis started! Job ID: ${jobId}. You will be DM'd when complete.`,
        appearance: 'success',
      },
    });
  } catch (err: any) {
    console.error('Failed to start common words job', err);
    res.status(500).json({
      showToast: { text: err?.message || 'Failed to start job', appearance: 'neutral' },
    });
  }
});

// [stats] Cancel common words job
app.post('/internal/menu/stats/common-words/cancel', async (_req, res): Promise<void> => {
  try {
    const cancelled = await CommonWordsAggregator.cancelJob();
    res.status(200).json({
      showToast: {
        text: cancelled ? 'Job cancelled.' : 'No running job found or could not cancel.',
        appearance: cancelled ? 'success' : 'neutral',
      },
    });
  } catch (err: any) {
    res.status(500).json({
      showToast: { text: err?.message || 'Failed to cancel job', appearance: 'neutral' },
    });
  }
});

// Scheduler: common-words-aggregator
app.post('/internal/scheduler/common-words-aggregator', async (_req, res): Promise<void> => {
  try {
    const finished = await CommonWordsAggregator.processBatch();
    if (!finished) {
      // Requeue
      await scheduler.runJob({
        name: 'common-words-aggregator',
        runAt: new Date(),
        data: {},
      });
      res.json({ status: 'requeued' });
    } else {
      res.json({ status: 'done' });
    }
  } catch (err: any) {
    console.error('Failed common words aggregator job', err);
    // Attempt to requeue on error so the job eventually finishes
    try {
      await scheduler.runJob({
        name: 'common-words-aggregator',
        runAt: new Date(),
        data: {},
      });
      res.json({ status: 'requeued-on-error', error: err?.message });
    } catch (requeueErr) {
      console.error('Failed to requeue after error', requeueErr);
      res.status(500).json({ status: 'error', message: err?.message });
    }
  }
});

// Scheduler: common-words-watchdog
app.post('/internal/scheduler/common-words-watchdog', async (_req, res): Promise<void> => {
  try {
    // Check every 10s, restart if silent for >45s (approx 9 missed heartbeats)
    const result = await CommonWordsAggregator.checkHealthAndRestart(45_000);
    if (result.restarted) {
      console.log(`[Watchdog] Restarted stuck common words job (age: ${result.age}ms)`);
    }
    res.json({ status: 'success', ...result });
  } catch (err: any) {
    console.error('Failed common words watchdog', err);
    res.status(500).json({ status: 'error', message: err?.message });
  }
});

createServer(app).listen(getServerPort());
