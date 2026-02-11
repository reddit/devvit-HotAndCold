import * as p from 'drizzle-orm/pg-core';
import { and, eq } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { installationId, maskedUserId } from './drizzle.types';
import { z } from 'zod';
import { fn } from '../../shared/fn';
import { GuessSchema } from '../utils';
import { Score } from './score';
import { User } from './user';
import { sql } from './drizzle';

type StoredGuess = z.infer<typeof GuessSchema>;
type StoredScore = z.infer<typeof Score.Info>;

export const userGuessesTable = p.pgTable(
  'user_guesses',
  {
    installationId,
    challengeNumber: p.integer().notNull(),
    userId: maskedUserId().notNull(),
    startedPlayingAt: p.timestamp({ withTimezone: true }),
    gaveUpAt: p.timestamp({ withTimezone: true }),
    solvedAt: p.timestamp({ withTimezone: true }),
    guesses: p.jsonb().$type<StoredGuess[]>().notNull().default([]),
    score: p.jsonb().$type<StoredScore>(),
  },
  (t) => [p.primaryKey({ columns: [t.installationId, t.challengeNumber, t.userId] })]
);

export type UserGuessRow = typeof userGuessesTable.$inferSelect;

/**
 * Read a single user guess row from SQL by installation, challenge, and masked user id.
 * Returns null if not found.
 */
export const getUserGuessRow = fn(
  z.object({
    installationIdValue: z.string(),
    challengeNumber: z.number(),
    userId: User.zodMaskedUserId,
  }),
  async ({ installationIdValue, challengeNumber, userId }) => {
    const db = await sql();
    const rows = await db
      .select()
      .from(userGuessesTable)
      .where(
        and(
          eq(userGuessesTable.installationId, installationIdValue),
          eq(userGuessesTable.challengeNumber, challengeNumber),
          eq(userGuessesTable.userId, userId)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }
);

/**
 * Insert or update a user guess row (drain: write Redis data to SQL).
 */
export const upsertUserGuessRow = fn(
  z.object({
    installationIdValue: z.string(),
    challengeNumber: z.number(),
    userId: User.zodMaskedUserId,
    startedPlayingAt: z.date().nullable(),
    gaveUpAt: z.date().nullable(),
    solvedAt: z.date().nullable(),
    guesses: z.array(GuessSchema),
    score: Score.Info.nullable(),
  }),
  async (row) => {
    const db = await sql();
    const set: PgUpdateSetSource<typeof userGuessesTable> = {
      startedPlayingAt: row.startedPlayingAt,
      gaveUpAt: row.gaveUpAt,
      solvedAt: row.solvedAt,
      guesses: row.guesses,
      score: row.score,
    };
    await db
      .insert(userGuessesTable)
      .values({
        installationId: row.installationIdValue,
        challengeNumber: row.challengeNumber,
        userId: row.userId,
        startedPlayingAt: row.startedPlayingAt,
        gaveUpAt: row.gaveUpAt,
        solvedAt: row.solvedAt,
        guesses: row.guesses,
        score: row.score,
      })
      .onConflictDoUpdate({
        target: [
          userGuessesTable.installationId,
          userGuessesTable.challengeNumber,
          userGuessesTable.userId,
        ],
        set,
      });
  }
);
