import { index, pgTable, text } from 'drizzle-orm/pg-core';
import { installationId } from './drizzle.common';

export const usersTable = pgTable(
  'users',
  {
    id: text().primaryKey(),
    installationId,
  },
  (t) => [index().on(t.installationId)]
);
