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
import makeAnalyticsRouter from './analytics';
import { usePosthog, usePosthogErrorTracking } from './posthog';
import { Timezones } from './core/timezones';
import { Notifications } from './core/notifications';
import { makeClientConfig } from '../shared/makeClientConfig';
import { AnalyticsSync } from './core/analyticsSync';
// no-op

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
    get: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
        })
      )
      .query(async ({ input }) => {
        const challengeNumber = input.challengeNumber;
        const current = await User.getCurrent();
        const username = current.username;
        const [challengeInfo, challengeUserInfo] = await Promise.all([
          Challenge.getChallenge({ challengeNumber }),
          UserGuess.getChallengeUserInfo({ username, challengeNumber }),
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

// Attach PostHog to res.locals and error tracking middleware
app.use(usePosthog);

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
    const post = await Challenge.makeNewChallenge({ enqueueNotifications: true });

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
    const post = await Challenge.makeNewChallenge({ enqueueNotifications: !skipNotifications });

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
      throw new Error('Missing challengeNumber in postData');
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
      try {
        let sourceText = text;
        const isJustWtf = /^!wtf$/i.test(text);
        // If it's a bare !wtf on a reply (not root), use the parent comment's body as the source
        if (isJustWtf && !isRoot) {
          try {
            const parentComment = await reddit.getCommentById(parentId as any);
            sourceText = parentComment.body;
          } catch (e) {
            // ignore fetch failure; we'll fall back to the triggering text
          }
        }

        const reply = await WtfResponder.explainCloseness({
          challengeNumber,
          raw: sourceText,
        });
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

        await reddit.submitComment({ id: commentId as any, richtext: builder });
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
    await Challenge.makeNewChallenge({ enqueueNotifications: true });
    console.log('[Scheduler] create-new-challenge completed');
    res.json({
      status: 'success',
    });
  } catch (error) {
    console.error(`Error creating new challenge from scheduler: ${error}`);
    res.status(400).json({
      status: 'error',
      message: 'Failed to create post',
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

// Daily analytics reconciliation: sync reminders and joined_subreddit to PostHog
app.post('/internal/scheduler/posthog-user-prop-sync', async (req, res): Promise<void> => {
  try {
    const body = (req.body as any) ?? {};
    const data = body?.data ?? {};
    const stage = (data?.stage as any) ?? 'reminders';
    const cursor = Number.parseInt(String(data?.cursor ?? '0'), 10) || 0;
    const limit = Number.parseInt(String(data?.limit ?? '500'), 10) || 500;
    console.log('[Scheduler] posthog-user-prop-sync invoked', { stage, cursor, limit });
    const result = await AnalyticsSync.runOrRequeue({ stage, cursor, limit });
    console.log('[Scheduler] posthog-user-prop-sync completed', { result });
    res.json({ status: 'success', next: result });
  } catch (error) {
    console.error('Error running PostHog user property sync:', error);
    res.status(400).json({ status: 'error', message: 'Failed to sync PostHog properties' });
  }
});

// One-off job target for scheduled timezone groups
app.post('/internal/scheduler/notifications-send-group', async (req, res): Promise<void> => {
  try {
    const body = (req.body as any) ?? {};
    const groupId: string | undefined = body?.groupId;
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

// [ops] Remove reminders/timezones (form launcher)
app.post('/internal/menu/admin/cleanup-users', async (_req, res): Promise<void> => {
  res.status(200).json({
    showForm: {
      name: 'cleanupUsersForm',
      form: {
        title: 'Remove reminders and timezones',
        acceptLabel: 'Remove',
        fields: [
          {
            name: 'usernamesCsv',
            label: 'Usernames (comma-separated)',
            type: 'paragraph',
            required: true,
            placeholder: 'user1, user2, user3',
          },
        ],
      },
    },
  });
});

// [notifications] Send single (form launcher)
app.post('/internal/menu/notifications/send-single', async (_req, res): Promise<void> => {
  res.status(200).json({
    showForm: {
      name: 'notificationsSendSingleForm',
      form: {
        title: 'Send notification to user',
        acceptLabel: 'Send',
        fields: [
          { name: 'username', label: 'Username (case-sensitive)', type: 'string', required: true },
          { name: 'postId', label: 'Post ID (t3_...)', type: 'string', required: true },
          { name: 'title', label: 'Title', type: 'string', required: true },
          { name: 'body', label: 'Body', type: 'paragraph', required: true },
        ],
      },
    },
  });
});

app.post('/internal/form/notifications/manage', async (req, res): Promise<void> => {
  try {
    const { action } = (req.body as any) ?? {};
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

// [ops] Remove reminders/timezones (form handler)
app.post('/internal/form/admin/cleanup-users', async (req, res): Promise<void> => {
  try {
    const { usernamesCsv } = (req.body as any) ?? {};
    if (typeof usernamesCsv !== 'string' || usernamesCsv.trim().length === 0) {
      res.status(400).json({
        showToast: { text: 'Usernames are required', appearance: 'neutral' },
      });
      return;
    }

    const usernames = usernamesCsv
      .split(',')
      .map((u: string) => u.trim())
      .filter((u: string) => u.length > 0);

    if (usernames.length === 0) {
      res.status(400).json({
        showToast: { text: 'No usernames provided after parsing', appearance: 'neutral' },
      });
      return;
    }

    let remindersRemoved = 0;
    let timezonesCleared = 0;
    const failures: Array<{ username: string; error: string }> = [];

    for (const username of usernames) {
      try {
        await Reminders.removeReminderForUsername({ username });
        remindersRemoved++;
      } catch (e: any) {
        failures.push({ username, error: e?.message || 'Failed to remove reminder' });
      }
      try {
        await Timezones.clearUserTimezone({ username });
        timezonesCleared++;
      } catch (e: any) {
        failures.push({ username, error: e?.message || 'Failed to clear timezone' });
      }
    }

    const issues = failures.length
      ? ` | Failed: ${[...new Set(failures.map((f) => f.username))].join(', ')}`
      : '';
    const text = `Removed reminders: ${remindersRemoved} | Cleared timezones: ${timezonesCleared}${issues}`;

    res.status(200).json({
      showToast: { text, appearance: failures.length === 0 ? 'success' : 'neutral' },
    });
  } catch (err: any) {
    console.error('Failed to cleanup users', err);
    res.status(500).json({
      showToast: { text: err?.message || 'Failed to cleanup users', appearance: 'neutral' },
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

    const challengeNumber = await Challenge.getCurrentChallengeNumber();
    const currentPostId = await Challenge.getPostIdForChallenge({ challengeNumber });
    const { groups, totalRecipients } = await Notifications.enqueueNewChallengeByTimezone({
      challengeNumber: Math.max(1, challengeNumber || 1),
      postId: currentPostId ?? 't3_placeholder',
      postUrl: 'https://reddit.com',
      localSendHour: 9,
      localSendMinute: 0,
      dryRun: true,
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

    await reddit.sendPrivateMessage({
      to: me.username,
      subject,
      text: body,
    });

    res.status(200).json({
      showToast: 'Sent dry-run preview via DM',
    });
  } catch (err: any) {
    console.error('Failed dry-run notifications DM', err);
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
      data: { stage: 'reminders', cursor: 0, limit: 500 },
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

// Error tracking should be last among middleware to catch downstream errors
app.use(usePosthogErrorTracking);

createServer(app).listen(getServerPort());
