import { text } from 'drizzle-orm/pg-core';
import { getInstallationId } from '../utils';

export const installationId = text('installation_id')
  .notNull()
  .$defaultFn(() => getInstallationId());
