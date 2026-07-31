import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { z } from 'zod';
import { publicProcedure, router } from './trpc';
import { createContext } from './context';
import { createServer, getServerPort, redis, scheduler } from '@devvit/web/server';
import { Challenge } from './core/challenge';
import { SpoilerGuard } from './core/spoilerGuard';
import { WtfResponder } from './core/wtfResponder';
import { buildHintCsvForChallenge, buildLetterCsvForChallenge, getWord } from './core/api';
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
import { CommonWordsAggregator } from './core/commonWordsAggregator';
import { WORD_DATA_API_PREFIX } from '../shared/wordDataVersion';

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

function formatUtcOffset(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(minutes);
  const hours = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  return `UTC${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function getTimezoneOffsetLabel(timeZone: string, baseDate: Date): string {
  try {
    const local = new Date(baseDate.toLocaleString('en-US', { timeZone }));
    const utc = new Date(baseDate.toLocaleString('en-US', { timeZone: 'UTC' }));
    const offsetMinutes = Math.round((local.getTime() - utc.getTime()) / 60000);
    return formatUtcOffset(offsetMinutes);
  } catch {
    return 'UTC+00:00';
  }
}

function getReadableTimeZoneName(timeZone: string): string {
  if (timeZone === 'Etc/UTC' || timeZone === 'UTC') return 'UTC';
  const parts = timeZone.split('/');
  const last = parts[parts.length - 1] || timeZone;
  return last.replace(/_/g, ' ');
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
app.get(
  [
    '/api/challenges/:challengeNumber/_hint.csv',
    `${WORD_DATA_API_PREFIX}/challenges/:challengeNumber/_hint.csv`,
  ],
  async (req, res): Promise<void> => {
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
      console.error('[word-data] failed to serve hint CSV', {
        requestPath: req.path,
        challengeNumber: req.params.challengeNumber,
        release: WORD_DATA_API_PREFIX,
        error: err,
      });
      res.status(500).send('Failed to generate CSV');
    }
  }
);

// Register CSV endpoints BEFORE tRPC so they are not shadowed by the /api adapter
app.get(
  [
    '/api/challenges/:challengeNumber/:letter.csv',
    `${WORD_DATA_API_PREFIX}/challenges/:challengeNumber/:letter.csv`,
  ],
  async (req, res): Promise<void> => {
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
      console.error('[word-data] failed to serve letter CSV', {
        requestPath: req.path,
        challengeNumber: req.params.challengeNumber,
        letter: req.params.letter,
        release: WORD_DATA_API_PREFIX,
        error: err,
      });
      res.status(500).send('Failed to generate CSV');
    }
  }
);

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
    const usedWordsSet = new Set<string>();
    const usedWords: string[] = [];
    const seenUsed = new Set<string>();
    const currentChallengeNumber = await Challenge.getCurrentChallengeNumber();
    for (let challengeNumber = currentChallengeNumber; challengeNumber >= 1; challengeNumber--) {
      try {
        const challenge = await Challenge.getChallenge({ challengeNumber });
        const rawWord = challenge.secretWord?.trim();
        if (!rawWord) continue;
        usedWordsSet.add(rawWord.toLowerCase());
      } catch (error) {
        // Ignore missing or invalid challenges.
      }
    }
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
        if (usedWordsSet.has(lower)) {
          if (!seenUsed.has(lower)) {
            usedWords.push(w);
            seenUsed.add(lower);
          }
          return false;
        }
        seenIncoming.add(lower);
        return true;
      })
      .map((w) => ({ word: w }));

    if (prepend) {
      for (const c of toEnqueue) {
        await WordQueue.prepend({ challenge: c });
      }
    } else {
      for (const c of toEnqueue) {
        await WordQueue.append({ challenge: c });
      }
    }

    const successCount = toEnqueue.length;
    const failureWords = failures.map((f) => f.word).join(', ');
    const duplicateWords = duplicates.join(', ');
    const usedWordsText = usedWords.join(', ');
    const issues: string[] = [];
    if (failures.length > 0) issues.push(`Failed: ${failureWords}`);
    if (duplicates.length > 0) issues.push(`Skipped duplicates: ${duplicateWords}`);
    if (usedWords.length > 0) issues.push(`Skipped used words: ${usedWordsText}`);
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

// [stats] Reminder opt-ins grouped by timezone (DM)
app.post('/internal/menu/reminders-by-timezone', async (_req, res): Promise<void> => {
  const logPrefix = '[RemindersByTimezone]';
  const startedAt = Date.now();
  try {
    console.log(`${logPrefix} start`);
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

    console.log(`${logPrefix} fetching opted-in users`);
    const optedIn = await Reminders.getAllUsersOptedIntoReminders();
    console.log(`${logPrefix} opted-in users fetched`, {
      count: optedIn.length,
      durationMs: Date.now() - startedAt,
    });
    const usernames = optedIn.map((entry) => entry.username);
    console.log(`${logPrefix} fetching timezones`, { count: usernames.length });
    const tzLookupStart = Date.now();
    const tzMap = await Timezones.getUserTimezones({ usernames });
    console.log(`${logPrefix} timezones fetched`, { durationMs: Date.now() - tzLookupStart });
    const numberFormat = new Intl.NumberFormat('en-US');
    const now = new Date();

    const counts = new Map<string, number>();
    const missingKey = '__missing__';
    let missing = 0;
    for (const { username } of optedIn) {
      const zone = tzMap[username];
      if (!zone) {
        missing++;
        counts.set(missingKey, (counts.get(missingKey) ?? 0) + 1);
        continue;
      }
      counts.set(zone, (counts.get(zone) ?? 0) + 1);
    }

    const rows = Array.from(counts.entries()).map(([zone, count]) => {
      if (zone === missingKey) {
        return {
          label: 'Unknown',
          offset: 'no timezone',
          count,
          zone,
        };
      }
      return {
        label: getReadableTimeZoneName(zone),
        offset: getTimezoneOffsetLabel(zone, now),
        count,
        zone,
      };
    });

    rows.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.label.localeCompare(b.label);
    });
    console.log(`${logPrefix} grouped reminders`, {
      uniqueTimezones: rows.filter((row) => row.zone !== missingKey).length,
      missing,
    });

    const lines: string[] = [];
    lines.push('Reminder opt-ins by timezone');
    lines.push('');
    lines.push(`Total opted-in users: ${numberFormat.format(optedIn.length)}`);
    lines.push(`With timezone: ${numberFormat.format(optedIn.length - missing)}`);
    lines.push(`Missing timezone: ${numberFormat.format(missing)}`);
    lines.push('');
    lines.push('Timezones (sorted by size):');
    for (const row of rows) {
      lines.push(`- ${row.label} (${row.offset}): ${numberFormat.format(row.count)}`);
    }
    console.log(`${logPrefix} prepared output`, {
      lines: lines.length,
      elapsedMs: Date.now() - startedAt,
    });

    const subject = 'Hot & Cold reminders by timezone';
    const maxLength = 9500;
    const chunks: string[] = [];
    let current = '';
    for (const line of lines) {
      const candidate = current.length === 0 ? line : `${current}\n${line}`;
      if (candidate.length <= maxLength) {
        current = candidate;
        continue;
      }
      if (current.length > 0) {
        chunks.push(current);
        current = '';
      }
      if (line.length > maxLength) {
        for (let i = 0; i < line.length; i += maxLength) {
          chunks.push(line.slice(i, i + maxLength));
        }
      } else {
        current = line;
      }
    }
    if (current.length > 0) {
      chunks.push(current);
    }

    const totalParts = Math.max(1, chunks.length);
    console.log(`${logPrefix} sending DM`, { totalParts });
    for (let i = 0; i < totalParts; i++) {
      const part = chunks[i] ?? '';
      const partLabel = totalParts > 1 ? ` (${i + 1}/${totalParts})` : '';
      const prefix = totalParts > 1 ? `Part ${i + 1}/${totalParts}\n\n` : '';
      try {
        await reddit.sendPrivateMessage({
          to: me.username,
          subject: `${subject}${partLabel}`,
          text: `${prefix}${part}`,
        });
        console.log(`${logPrefix} sent DM part`, { part: i + 1, length: part.length });
      } catch (err) {
        console.error(`${logPrefix} failed to send DM part`, {
          part: i + 1,
          error: err instanceof Error ? err.message : err,
        });
        console.log(`${logPrefix} output preview`, lines.slice(0, 20).join('\n'));
        res.status(200).json({
          showToast: {
            text: 'Failed to send DM. Check logs for [RemindersByTimezone].',
            appearance: 'neutral',
          },
        });
        return;
      }
    }

    console.log(`${logPrefix} done`, { elapsedMs: Date.now() - startedAt });
    res.status(200).json({
      showToast: { text: 'Sent reminder timezone stats via DM', appearance: 'success' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to get reminders by timezone';
    console.error(`${logPrefix} error`, err);
    res.status(500).json({
      showToast: {
        text: message,
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
    const maxLength = 9500;
    const chunks: string[] = [];
    const lines = body.split('\n');
    let current = '';

    for (const line of lines) {
      const candidate = current.length === 0 ? line : `${current}\n${line}`;
      if (candidate.length <= maxLength) {
        current = candidate;
        continue;
      }

      if (current.length > 0) {
        chunks.push(current);
        current = '';
      }

      if (line.length > maxLength) {
        for (let i = 0; i < line.length; i += maxLength) {
          chunks.push(line.slice(i, i + maxLength));
        }
      } else {
        current = line;
      }
    }

    if (current.length > 0) {
      chunks.push(current);
    }

    const totalParts = Math.max(1, chunks.length);
    for (let i = 0; i < totalParts; i++) {
      const part = chunks[i] ?? '';
      const partLabel = totalParts > 1 ? ` (${i + 1}/${totalParts})` : '';
      const prefix = totalParts > 1 ? `Part ${i + 1}/${totalParts}\n\n` : '';
      await reddit.sendPrivateMessage({
        to: me.username,
        subject: `${subject}${partLabel}`,
        text: `${prefix}${part}`,
      });
    }

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
// [migrate] Export every historical challenge number and secret word to the
// invoking moderator. The CSV is intentionally sent only by private message.
app.post('/internal/menu/export-secret-words', async (_req, res): Promise<void> => {
  try {
    const { userId } = context;
    if (!userId) {
      res.status(400).json({ showToast: 'userId is required' });
      return;
    }
    const me = await reddit.getUserById(userId);
    if (!me) {
      res.status(400).json({ showToast: 'Could not resolve current user' });
      return;
    }

    const current = await Challenge.getCurrentChallengeNumber();
    const rows: Array<{ challengeNumber: number; secretWord: string }> = [];
    const missing: number[] = [];
    const batchSize = 25;
    for (let start = 1; start <= current; start += batchSize) {
      const numbers = Array.from(
        { length: Math.min(batchSize, current - start + 1) },
        (_, index) => start + index
      );
      const batch = await Promise.all(
        numbers.map(async (challengeNumber) => {
          try {
            const challenge = await Challenge.getChallenge({ challengeNumber });
            return { challengeNumber, secretWord: challenge.secretWord };
          } catch {
            return null;
          }
        })
      );
      for (let i = 0; i < batch.length; i++) {
        const challenge = batch[i];
        if (challenge) rows.push(challenge);
        else missing.push(numbers[i]!);
      }
    }

    const lines = [
      'challengeNumber,secretWord',
      ...rows.map(({ challengeNumber, secretWord }) => `${challengeNumber},${secretWord}`),
    ];
    if (missing.length > 0) lines.push(`# Missing challenge numbers: ${missing.join(',')}`);

    const maxLength = 9500;
    const chunks: string[] = [];
    let chunk = '';
    for (const line of lines) {
      const candidate = chunk ? `${chunk}\n${line}` : line;
      if (candidate.length <= maxLength) {
        chunk = candidate;
      } else {
        if (chunk) chunks.push(chunk);
        chunk = line;
      }
    }
    if (chunk) chunks.push(chunk);

    for (let i = 0; i < chunks.length; i++) {
      const part = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : '';
      await reddit.sendPrivateMessage({
        to: me.username,
        subject: `Hot & Cold historical secret-word export${part}`,
        text: chunks[i]!,
      });
    }

    res.status(200).json({
      showToast: {
        text: `Sent ${rows.length} secret words via DM${missing.length ? `; ${missing.length} missing` : ''}`,
        appearance: missing.length === 0 ? 'success' : 'neutral',
      },
    });
  } catch (err: any) {
    console.error('Failed to export historical secret words', err);
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to export historical secret words',
        appearance: 'neutral',
      },
    });
  }
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
