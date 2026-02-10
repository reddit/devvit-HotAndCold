import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { settings } from '@devvit/web/server';

export const sql = async () => {
  const connectionString = await settings.get<string>('NEON_PG_DB_CONNECTION_STRING');
  if (!connectionString) throw new Error('NEON_PG_DB_CONNECTION_STRING is not set');

  const sql = neon(connectionString);
  return drizzle({ client: sql });
};
