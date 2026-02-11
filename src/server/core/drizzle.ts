import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { settings } from '@devvit/web/server';
import { isSqlEnabled } from './sqlFlags';

const SQL_DISABLED_MESSAGE = `Attempted to call sql() while SQL is disabled.

Guard the call so SQL is only used when enabled, e.g.:
  if (await isSqlEnabled()) {
    const db = await sql();
    // ... use db
  }
(or skip the SQL path when disabled).

To enable SQL instead: use the "Configure UserGuess SQL flags" menu and turn ON "Enable UserGuess SQL support (global)", or set Redis key "userGuessSql:enabled" to "1".`;

export const sql = async () => {
  const enabled = await isSqlEnabled();
  if (!enabled) {
    throw new Error(SQL_DISABLED_MESSAGE);
  }

  const connectionString = await settings.get<string>('NEON_PG_DB_CONNECTION_STRING');
  if (!connectionString) throw new Error('NEON_PG_DB_CONNECTION_STRING is not set');

  const sqlClient = neon(connectionString);
  return drizzle({ client: sqlClient, casing: 'snake_case' });
};
