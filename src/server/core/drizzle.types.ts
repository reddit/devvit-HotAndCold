import { customType, text } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { getInstallationId } from '../utils';
import { User } from './user';

export const installationId = text('installation_id')
  .notNull()
  .$defaultFn(() => getInstallationId());

export const maskedUserId = customType<{
  data: string;
}>({
  dataType() {
    return 'text';
  },
  toDriver(value) {
    if (!User.isMaskedId(value)) throw new Error('Expected masked user id');
    return value;
  },
  fromDriver(value) {
    const parsed = z.string().parse(value);
    if (!User.isMaskedId(parsed)) throw new Error('Stored non-masked user id');
    return parsed;
  },
});
