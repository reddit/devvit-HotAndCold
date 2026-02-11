import { redis } from '@devvit/web/server';

/** Global: allow SQL (e.g. Neon) to be used. When off, drizzle.sql() will throw. */
export const SQL_ENABLED_KEY = 'userGuessSql:enabled' as const;

export const USER_GUESS_SQL_FORCE_READS_KEY = 'userGuessSql:forceReadFromSql' as const;
export const USER_GUESS_SQL_DRAIN_ENABLED_KEY = 'userGuessSql:drain:enabled' as const;
export const USER_GUESS_SQL_DRAIN_BATCH_SIZE_KEY = 'userGuessSql:drain:batchSize' as const;
export const USER_GUESS_SQL_DEFAULT_DRAIN_BATCH_SIZE = 500;
export const USER_GUESS_SQL_MIN_DRAIN_BATCH_SIZE = 1;
export const USER_GUESS_SQL_MAX_DRAIN_BATCH_SIZE = 10_000;

export const USER_GUESS_SQL_ROLLOUT_FLAGS = [
  {
    formFieldName: 'sqlEnabled',
    label: 'Enable UserGuess SQL support (global)',
    key: SQL_ENABLED_KEY,
  },
  {
    formFieldName: 'forceReadFromSql',
    label: 'Force reads from SQL (bypass Redis)',
    key: USER_GUESS_SQL_FORCE_READS_KEY,
  },
  {
    formFieldName: 'drainEnabled',
    label: 'Enable draining (Redis -> SQL -> delete Redis)',
    key: USER_GUESS_SQL_DRAIN_ENABLED_KEY,
  },
] as const;

/** Read a boolean toggle from Redis (value === '1'). */
export const isToggleEnabled = async (key: string): Promise<boolean> => {
  return (await redis.get(key)) === '1';
};

/** Set a boolean toggle in Redis ('1' when enabled, key deleted when disabled). */
export const setToggleEnabled = async (key: string, enabled: boolean): Promise<void> => {
  if (enabled) {
    await redis.set(key, '1');
  } else {
    await redis.del(key);
  }
};

/** Parse form/request value to boolean for toggle fields. */
export const parseBooleanToggle = (value: unknown): boolean => {
  return value === true || value === 'true' || value === 1 || value === '1';
};

const normalizeDrainBatchSize = (value: number): number => {
  if (!Number.isFinite(value)) return USER_GUESS_SQL_DEFAULT_DRAIN_BATCH_SIZE;
  const rounded = Math.floor(value);
  return Math.min(
    USER_GUESS_SQL_MAX_DRAIN_BATCH_SIZE,
    Math.max(USER_GUESS_SQL_MIN_DRAIN_BATCH_SIZE, rounded)
  );
};

/** Parse form/request value to drain batch size (clamped to min/max). */
export const parseDrainBatchSize = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (Number.isNaN(parsed)) return USER_GUESS_SQL_DEFAULT_DRAIN_BATCH_SIZE;
  return normalizeDrainBatchSize(parsed);
};

/** Batch size for the drain job (clamped to min/max). */
export const getDrainBatchSize = async (): Promise<number> => {
  const raw = await redis.get(USER_GUESS_SQL_DRAIN_BATCH_SIZE_KEY);
  if (!raw) return USER_GUESS_SQL_DEFAULT_DRAIN_BATCH_SIZE;
  return parseDrainBatchSize(raw);
};

/** Set drain batch size in Redis (clamped to min/max). */
export const setDrainBatchSize = async (size: number): Promise<void> => {
  await redis.set(USER_GUESS_SQL_DRAIN_BATCH_SIZE_KEY, String(normalizeDrainBatchSize(size)));
};

/** Whether SQL is enabled globally. If false, calling sql() in drizzle.ts will throw. */
export const isSqlEnabled = () => isToggleEnabled(SQL_ENABLED_KEY);

/** When true, skip Redis and read from SQL only (then empty default). */
export const isForceReadFromSql = () => isToggleEnabled(USER_GUESS_SQL_FORCE_READS_KEY);

/** Whether the drain job (Redis -> SQL -> delete Redis) is enabled. */
export const isDrainEnabled = () => isToggleEnabled(USER_GUESS_SQL_DRAIN_ENABLED_KEY);
