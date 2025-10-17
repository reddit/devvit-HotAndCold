import express from 'express';
import { z } from 'zod';
import { reddit, context } from '@devvit/web/server';
import { HordeWordQueue } from './core/horde/wordQueue.horde';
import { getWord, getWordConfig } from './core/api';
import { Challenge as HordeChallenge } from './core/horde/challenge.horde';
import { publicProcedure, router as trpcRouter } from './trpc';
import { User } from './core/user';
import { LastPlayedAt } from './core/lastPlayedAt';
import { HordeUserGuess } from './core/horde/userGuess.horde';
import { HordeGuess } from './core/horde/guess.horde';
import { realtime } from '@devvit/web/server';
import { HordeMessage, hordeChannelName } from '../shared/realtime.horde';
import { HordeActivePlayers } from './core/horde/activePlayers.horde';

const router = express.Router();

// [horde][queue] Add to queue (form launcher)
router.post('/menu/add', async (_req, res): Promise<void> => {
  res.status(200).json({
    showForm: {
      name: 'hordeQueueAddForm',
      form: {
        title: 'Add HORDE challenges to queue',
        acceptLabel: 'Submit',
        fields: [
          {
            name: 'lines',
            label: 'Lines (comma-separated words per line)',
            type: 'paragraph',
            required: true,
            placeholder: 'word1, word2, word3\nalpha, beta\none, two, three, four',
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

// [horde][queue] Add to queue (form submit)
router.post('/form/queue/add', async (req, res): Promise<void> => {
  try {
    const body = (req.body as any) ?? {};
    const parsed = z
      .object({
        lines: z.string().min(1),
        prepend: z.boolean().optional().default(false),
      })
      .parse({
        lines: body?.lines,
        prepend: body?.prepend,
      });

    const rawLines = parsed.lines
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (rawLines.length === 0) {
      res.status(400).json({
        showToast: {
          text: 'No lines provided',
          appearance: 'neutral',
        },
      });
      return;
    }

    const parsedChallenges = rawLines
      .map((line) =>
        line
          .split(',')
          .map((w) => w.trim())
          .filter((w) => w.length > 0)
      )
      .filter((arr) => arr.length > 0)
      .map((words) => ({ words })) as Array<{ words: string[] }>;

    // Validate shape for each challenge
    const challenges = z.array(HordeWordQueue.ChallengeSchema).parse(parsedChallenges);

    // Validate each word exists via getWord; collect successes & failures
    const successes: Array<{ words: string[] }> = [];
    const failures: Array<{ words: string[]; error: string }> = [];
    for (const c of challenges) {
      try {
        await Promise.all(
          c.words.map(async (w) => {
            const result = await getWord({ word: w });
            const ok = Array.isArray(result?.data) && result.data.length > 0;
            if (!ok) throw new Error(`Word not found: ${w}`);
          })
        );
        successes.push({ words: c.words });
      } catch (e: any) {
        failures.push({ words: c.words, error: e?.message || 'Validation failed' });
      }
    }

    // De-duplicate against existing queue and within incoming
    const existing = await HordeWordQueue.peekAll();
    const toKey = (words: string[]) => words.map((w) => w.trim().toLowerCase()).join('||');
    const existingKeys = new Set(existing.map((c) => toKey(c.words)));
    const seenIncoming = new Set<string>();
    const duplicates: string[] = [];
    const toEnqueue = successes.filter((c) => {
      const key = toKey(c.words);
      if (existingKeys.has(key) || seenIncoming.has(key)) {
        duplicates.push(c.words.join(', '));
        return false;
      }
      seenIncoming.add(key);
      return true;
    });

    // Enqueue
    if (parsed.prepend) {
      for (const c of toEnqueue) {
        await HordeWordQueue.prepend({ challenge: c });
        // Warm remote cache for each word
        for (const w of c.words) void getWordConfig({ word: w }).catch(() => {});
      }
    } else {
      for (const c of toEnqueue) {
        await HordeWordQueue.append({ challenge: c });
        // Warm remote cache for each word
        for (const w of c.words) void getWordConfig({ word: w }).catch(() => {});
      }
    }

    const successCount = toEnqueue.length;
    const issues: string[] = [];
    if (failures.length > 0)
      issues.push(`Failed: ${failures.map((f) => `[${f.words.join(', ')}]`).join('; ')}`);
    if (duplicates.length > 0) issues.push(`Skipped duplicates: ${duplicates.join('; ')}`);
    const base = `Added ${successCount} item(s) to the horde queue`;
    const text = issues.length === 0 ? base : `${base}. ${issues.join('. ')}`;

    res.status(200).json({
      showToast: {
        text,
        appearance: issues.length === 0 ? 'success' : 'neutral',
      },
    });
  } catch (err: any) {
    console.error('Failed to add to horde queue', err);
    res.status(400).json({
      showToast: {
        text: err?.message || 'Failed to add to horde queue',
        appearance: 'neutral',
      },
    });
  }
});

// [horde][queue] Clear queue (form launcher)
router.post('/menu/clear', async (_req, res): Promise<void> => {
  res.status(200).json({
    showForm: {
      name: 'hordeQueueClearForm',
      form: {
        title: 'Clear HORDE challenge queue',
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

// [horde][queue] Clear queue (form submit)
router.post('/form/queue/clear', async (req, res): Promise<void> => {
  const { confirm } = ((req.body as any) ?? {}) as { confirm?: boolean };
  if (!confirm) {
    res.status(400).json({
      showToast: {
        text: 'You must confirm to clear the horde queue',
        appearance: 'neutral',
      },
    });
    return;
  }
  await HordeWordQueue.clear();
  res.status(200).json({
    showToast: {
      text: 'Horde queue cleared',
      appearance: 'success',
    },
  });
});

// [horde][queue] Get size (immediate action)
router.post('/menu/size', async (_req, res): Promise<void> => {
  const n = await HordeWordQueue.size();
  res.status(200).json({
    showToast: {
      text: `Horde queue size: ${n}`,
      appearance: 'success',
    },
  });
});

// [horde][queue] Peek next 3 queued challenges (immediate action)
router.post('/menu/peek', async (_req, res): Promise<void> => {
  try {
    const items = await HordeWordQueue.peekAll();
    const nextThree = items.slice(0, 3).map((c) => c.words.join(', '));
    const text =
      nextThree.length === 0
        ? 'Horde queue is empty'
        : nextThree.length === 1
          ? `Next horde: ${nextThree[0]}`
          : `Next ${nextThree.length} hordes: ${nextThree.join(' | ')}`;

    res.status(200).json({
      showToast: {
        text,
        appearance: 'success',
      },
    });
  } catch (err: any) {
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to peek horde queue',
        appearance: 'neutral',
      },
    });
  }
});

// [horde][queue] DM full queue contents to invoking moderator (immediate action)
router.post('/menu/dm', async (_req, res): Promise<void> => {
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

    const items = await HordeWordQueue.peekAll();
    const subject = 'Hot & Cold HORDE queue contents';
    const body =
      items.length === 0
        ? 'Horde queue is empty.'
        : items.map((c) => c.words.join(', ')).join('\n');

    await reddit.sendPrivateMessage({
      to: me.username,
      subject,
      text: body,
    });

    res.status(200).json({
      showToast: {
        text: 'Sent horde queue via DM',
      },
    });
  } catch (err: any) {
    console.error('Failed to send horde queue DM', err);
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to send horde queue DM',
        appearance: 'neutral',
      },
    });
  }
});

// [horde][queue] Post next queued challenge (immediate action)
router.post('/menu/post-next', async (_req, res): Promise<void> => {
  try {
    const post = await HordeChallenge.makeNewChallenge();
    const words = Array.isArray((post as any).words) ? (post as any).words : [];
    res.status(200).json({
      showToast: {
        text: words.length > 0 ? `Next horde: ${words.join(', ')}` : 'Posted next horde',
        appearance: 'success',
      },
      navigateTo: post.postUrl,
    });
  } catch (err: any) {
    res.status(500).json({
      showToast: {
        text: err?.message || 'Failed to post next horde challenge',
        appearance: 'neutral',
      },
    });
  }
});

export default router;

// Scheduler HTTP endpoint for game_update heartbeat (referenced by devvit.json)
router.post('/scheduler/game-update', async (_req, res): Promise<void> => {
  try {
    const challengeNumber = await HordeChallenge.getCurrentChallengeNumber();
    if (!challengeNumber || challengeNumber <= 0) {
      res.status(200).json({ ok: false });
      return;
    }
    const channel = hordeChannelName(challengeNumber);
    const payload = await HordeChallenge.buildGameUpdateMessage({
      challengeNumber,
      tick: true,
      persistLost: true,
    });
    try {
      await realtime.send(channel, payload);
    } catch (e) {
      console.error('Failed to send horde game_update (http endpoint)', e);
    }

    res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error('Failed /internal/horde/scheduler/game-update', e);
    res.status(500).json({ ok: false, error: e?.message || 'failed' });
  }
});

// tRPC sub-router to be folded under the main schema as `horde`
export const hordeTrpcRouter = trpcRouter({
  active: trpcRouter({
    // Client heartbeat to mark this user as active in the current 30s bucket
    heartbeat: publicProcedure
      .input(z.object({ challengeNumber: z.number().gt(0) }))
      .mutation(async ({ input }) => {
        await HordeActivePlayers.increment({ challengeNumber: input.challengeNumber });
        const current = await HordeActivePlayers.get({ challengeNumber: input.challengeNumber });
        return { activePlayersEstimate: current } as const;
      }),
  }),
  queue: trpcRouter({
    // Return current queue size
    size: publicProcedure.query(async () => {
      const n = await HordeWordQueue.size();
      return { size: n } as const;
    }),

    // Peek next N items (default: 3)
    peek: publicProcedure
      .input(z.object({ count: z.number().int().min(1).max(25).default(3) }).optional())
      .query(async ({ input }) => {
        const count = input?.count ?? 3;
        const items = await HordeWordQueue.peekAll();
        return { items: items.slice(0, count) } as const;
      }),

    // Clear queue (requires explicit confirmation)
    clear: publicProcedure.input(z.object({ confirm: z.boolean() })).mutation(async ({ input }) => {
      if (!input.confirm) {
        throw new Error('confirm must be true to clear queue');
      }
      await HordeWordQueue.clear();
      return { cleared: true } as const;
    }),

    // Add challenges to queue
    add: publicProcedure
      .input(
        z.object({
          challenges: z.array(z.object({ words: z.array(z.string().min(1)).min(1) })).min(1),
          prepend: z.boolean().optional().default(false),
        })
      )
      .mutation(async ({ input }) => {
        const parsed = z
          .array(HordeWordQueue.ChallengeSchema)
          .parse(input.challenges.map((c) => ({ words: c.words })));

        const successes: Array<{ words: string[] }> = [];
        const failures: Array<{ words: string[]; error: string }> = [];
        for (const c of parsed) {
          try {
            await Promise.all(
              c.words.map(async (w) => {
                const result = await getWord({ word: w });
                const ok = Array.isArray(result?.data) && result.data.length > 0;
                if (!ok) throw new Error(`Word not found: ${w}`);
              })
            );
            successes.push({ words: c.words });
          } catch (e: any) {
            failures.push({ words: c.words, error: e?.message || 'Validation failed' });
          }
        }

        // De-duplicate against existing and within request
        const existing = await HordeWordQueue.peekAll();
        const keyOf = (words: string[]) => words.map((w) => w.toLowerCase().trim()).join('||');
        const existingKeys = new Set(existing.map((c) => keyOf(c.words)));
        const seen = new Set<string>();
        const duplicates: string[] = [];
        const toEnqueue = successes.filter((c) => {
          const key = keyOf(c.words);
          if (existingKeys.has(key) || seen.has(key)) {
            duplicates.push(c.words.join(', '));
            return false;
          }
          seen.add(key);
          return true;
        });

        if (input.prepend) {
          for (const c of toEnqueue) {
            await HordeWordQueue.prepend({ challenge: c });
            for (const w of c.words) void getWordConfig({ word: w }).catch(() => {});
          }
        } else {
          for (const c of toEnqueue) {
            await HordeWordQueue.append({ challenge: c });
            for (const w of c.words) void getWordConfig({ word: w }).catch(() => {});
          }
        }

        return {
          added: toEnqueue.length,
          duplicates,
          failures,
        } as const;
      }),

    // Post next queued challenge
    postNext: publicProcedure.mutation(async () => {
      const post = await HordeChallenge.makeNewChallenge();
      const words = Array.isArray((post as any).words) ? (post as any).words : [];
      return {
        postUrl: post.postUrl,
        words,
      } as const;
    }),
  }),
  scheduler: trpcRouter({
    gameUpdate: publicProcedure.mutation(async () => {
      // Determine current challenge number (HORDE)
      const challengeNumber = await HordeChallenge.getCurrentChallengeNumber();
      if (!challengeNumber || challengeNumber <= 0) return { ok: false as const };

      const channel = hordeChannelName(challengeNumber);
      const payload = await HordeChallenge.buildGameUpdateMessage({
        challengeNumber,
        tick: false,
        persistLost: false,
      });
      try {
        await realtime.send(channel, payload);
      } catch (e) {
        console.error('Failed to send horde game_update', e);
      }
      return { ok: true as const };
    }),
  }),
  game: trpcRouter({
    state: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
        })
      )
      .query(async ({ input }) => {
        const { challengeNumber } = input;
        if (!Number.isFinite(challengeNumber) || challengeNumber <= 0) {
          throw new Error('Invalid challenge number');
        }
        const message = await HordeChallenge.buildGameUpdateMessage({
          challengeNumber,
          tick: false,
          persistLost: false,
        });
        return message.update;
      }),
    get: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
        })
      )
      .query(async ({ input }) => {
        const { challengeNumber } = input;
        const current = await User.getCurrent();
        const username = current.username;
        const [challengeInfo, challengeUserInfo] = await Promise.all([
          HordeChallenge.getChallenge({ challengeNumber }),
          HordeUserGuess.getChallengeUserInfo({ username, challengeNumber }),
        ]);
        return {
          challengeNumber,
          challengeInfo,
          challengeUserInfo,
        } as const;
      }),
  }),
  guess: trpcRouter({
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

        const mapped = guesses.map((g) => ({
          word: g.word,
          similarity: g.similarity,
          rank: g.rank,
          isHint: g.isHint === true,
        }));

        const response = await HordeUserGuess.submitGuesses({
          username,
          challengeNumber,
          guesses: mapped,
        });

        try {
          await LastPlayedAt.setLastPlayedAtForUsername({ username });
        } catch (e) {
          console.error('Failed to record lastPlayedAt', e);
        }

        // Send realtime message to the HORDE channel for this challenge
        const channel = hordeChannelName(challengeNumber);
        const payload: HordeMessage = {
          type: 'guess_batch',
          challengeNumber,
          guesses: guesses.map((g) => ({
            word: g.word,
            similarity: g.similarity,
            rank: g.rank,
            atMs: g.atMs,
            username,
          })),
        };
        try {
          console.log('sending realtime horde guess_batch', payload);
          console.log('channel', channel);
          console.log('payload', payload);
          await realtime.send(channel, payload);
        } catch (e) {
          console.error('Failed to send realtime horde guess_batch', e);
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
        const { challengeNumber } = input;
        const current = await User.getCurrent();
        const username = current.username;
        const response = await HordeUserGuess.giveUp({ username, challengeNumber });
        return response;
      }),
    topByRank: publicProcedure
      .input(
        z.object({
          challengeNumber: z.number(),
          limit: z.number().int().min(1).max(1000).default(25),
        })
      )
      .query(async ({ input }) => {
        const { challengeNumber, limit } = input;
        const items = await HordeGuess.getTopByRank({ challengeNumber, limit });
        return { items } as const;
      }),
  }),
});
