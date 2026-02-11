import * as p from 'drizzle-orm/pg-core';
import { installationId, maskedUserId } from './drizzle.types';

export const usersTable = p.pgTable(
  'users',
  {
    id: maskedUserId().primaryKey(),
    name: p.text().notNull(),
    installationId,
  },
  (t) => [p.index().on(t.installationId)]
);
