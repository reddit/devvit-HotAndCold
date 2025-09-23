import express from 'express';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { z } from 'zod';
import { publicProcedure, router } from './trpc';
import { createContext } from './context';
import { createServer, getServerPort, redis } from '@devvit/web/server';
import { Challenge } from './core/challenge';
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

    setReminder: publicProcedure.input(z.object({})).mutation(async () => {
      const current = await User.getCurrent();
      await Reminders.setReminderForUsername({ username: current.username });
      return { success: true } as const;
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
});

// Export type router type signature, this is used by the client.
export type AppRouter = typeof appRouter;

const app = express();

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
    console.error('Faieferfel');
    console.log('err', err.message.substring(0, 500));
    console.error('Failed to serve hint CSV', err);
    res.status(500).send('Failed to generate CSV');
  }
});

// Register CSV endpoints BEFORE tRPC so they are not shadowed by the /api adapter
app.get('/api/challenges/:challengeNumber/:letter.csv', async (req, res): Promise<void> => {
  console.log('getting letter csv');
  try {
    const challengeNumber = Number.parseInt(String(req.params.challengeNumber), 10);
    const rawLetter = String(req.params.letter || '')
      .trim()
      .toLowerCase();
    console.log('challengeNumber', challengeNumber);
    console.log('rawLetter', rawLetter);
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
    console.error('Faieferfel');
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
      // Surface all procedure errors on the server for debugging/observability
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
    const post = await Challenge.makeNewChallenge();

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
  try {
    const next = await WordQueue.shift();
    if (!next) {
      res.status(200).json({
        showToast: {
          text: 'Queue is empty - nothing to post',
          appearance: 'neutral',
        },
      });
      return;
    }
    // Placeholder: implement posting flow for a challenge word when available
    res.status(200).json({
      showToast: {
        text: `Next queued word: ${next.word}`,
        appearance: 'success',
      },
    });
  } catch (err: any) {
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to post next queued challenge',
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
    console.log('Creating new challenge from scheduler');
    await Challenge.makeNewChallenge();
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

createServer(app).listen(getServerPort());
