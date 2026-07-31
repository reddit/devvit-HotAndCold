/**
 * Cache identity for the full-vocabulary word-data release.
 *
 * Change this whenever committed word data changes. It is deliberately separate
 * from the on-disk `v1` directory name so CDN and application caches can be
 * invalidated without changing the ranking algorithm's version.
 */
export const WORD_DATA_RELEASE = 'v1-full-64639-r2';

export const WORD_DATA_API_PREFIX = `/api/word-data/${WORD_DATA_RELEASE}`;
