import { z } from 'zod';
import { Score } from './core/score';
import { context } from '@devvit/web/server';
import { AppError } from '../shared/errors';

export const zodRedditUsername = z
  .string()
  .trim()
  .min(1)
  .refine((val) => !val.startsWith('u/'), {
    message: 'Username must not start with the u/ prefix!',
  })
  .refine((val) => !val.startsWith('$'), {
    message: 'The string must not start with a $ character',
  });

/**
 * A special Zod schema that parses a string into a number.
 * Empty string is parsed as `undefined`.
 */
export const redisNumberString = z.string().transform((val, ctx) => {
  if (val === '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Not a number',
    });

    // This is a special symbol you can use to
    // return early from the transform function.
    // It has type `never` so it does not affect the
    // inferred return type.
    return z.NEVER;
  }

  const parsed = parseInt(val);

  if (isNaN(parsed)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Not a number',
    });

    // This is a special symbol you can use to
    // return early from the transform function.
    // It has type `never` so it does not affect the
    // inferred return type.
    return z.NEVER;
  }
  return parsed;
});

export const UserSettingsSchema = z.object({
  sortDirection: z.enum(['ASC', 'DESC']),
  sortType: z.enum(['SIMILARITY', 'TIMESTAMP']),
  layout: z.enum(['CONDENSED', 'EXPANDED']),
  isUserOptedIntoReminders: z.boolean(),
});

export const GuessSchema = z.object({
  word: z.string(),
  timestampMs: z.number(),
  similarity: z.number(),
  rank: z.number(),
  isHint: z.boolean(),
});

export const PlayerProgressSchema = z.object({
  progress: z.int().min(0).max(100),
  avatarUrl: z.string().url().optional(),
  username: zodRedditUsername,
  isPlayer: z.boolean(),
});

export const ChallengeUserInfoSchema = z.object({
  score: Score.Info.optional(),
  // May be unset until the user's first-ever guess is processed
  startedPlayingAtMs: z.number().optional(),
  gaveUpAtMs: z.number().optional(),
  solvedAtMs: z.number().optional(),
  guesses: z.array(GuessSchema),
  username: zodRedditUsername,
});

export const GameResponseSchema = z.object({
  challengeNumber: z.number(),
  challengeInfo: z.object({
    // DO NOT SEND THE WORD HERE!
    // THAT WOULD BE SILLY
    totalGuesses: z.number().optional(),
    totalPlayers: z.number().optional(),
    totalSolves: z.number().optional(),
    totalHints: z.number().optional(),
    totalGiveUps: z.number().optional(),
  }),
  challengeUserInfo: ChallengeUserInfoSchema,
});

// ---------------------------------------------------------------------------
// Redis helpers – coerce Redis string fields into typed shapes using Zod
// ---------------------------------------------------------------------------

const ChallengeUserInfoRedisRaw = z.object({
  username: zodRedditUsername,
  startedPlayingAtMs: z.string().optional(),
  gaveUpAtMs: z.string().optional(),
  solvedAtMs: z.string().optional(),
  guesses: z.string().default('[]'),
  score: z.string().optional(),
});

export const ChallengeUserInfoFromRedis = ChallengeUserInfoRedisRaw.transform((raw) => {
  const startedPlayingAtMs = raw.startedPlayingAtMs
    ? Number.parseInt(raw.startedPlayingAtMs)
    : undefined;
  const gaveUpAtMs = raw.gaveUpAtMs ? Number.parseInt(raw.gaveUpAtMs) : undefined;
  const solvedAtMs = raw.solvedAtMs ? Number.parseInt(raw.solvedAtMs) : undefined;

  let guessesParsed: unknown = [];
  try {
    guessesParsed = JSON.parse(raw.guesses);
  } catch {
    guessesParsed = [];
  }

  let scoreParsed: unknown | undefined = undefined;
  if (raw.score) {
    try {
      scoreParsed = JSON.parse(raw.score);
    } catch {
      scoreParsed = undefined;
    }
  }

  // Validate against the canonical schema to ensure types are correct
  return ChallengeUserInfoSchema.parse({
    username: raw.username,
    startedPlayingAtMs,
    gaveUpAtMs,
    solvedAtMs,
    guesses: guessesParsed,
    ...(scoreParsed ? { score: scoreParsed } : {}),
  });
});

/** Gets installation id from context or throws. Must be invoked inside of a request. */
export const getInstallationId = () => {
  const installationId = context.metadata['devvit-installation']?.['values'][0];
  if (!installationId)
    throw new AppError(
      'Installation ID not found. Are you calling this function from inside of a request context?'
    );
  return installationId;
};
