import { expect, vi } from 'vitest';
import { redis, scheduler } from '@devvit/web/server';
import { test } from '../test';
import { CommonWordsAggregator } from './commonWordsAggregator';

test('common-word job state keeps an expiration when cancelled', async () => {
  const scheduled = vi.spyOn(scheduler, 'runJob').mockResolvedValue('job-test');
  const written = vi.spyOn(redis, 'set');
  try {
    await CommonWordsAggregator.startJob({
      startChallenge: 1,
      endChallenge: 2,
      initiatorUsername: 'testuser',
    });
    // A legacy interrupted job could leave counts without an expiration.
    await redis.zAdd('commonWords:job:counts', { member: 'apple', score: 1 });
    await CommonWordsAggregator.cancelJob();
    const stateWrites = written.mock.calls.filter(([key]) => key === 'commonWords:job:state');
    expect(stateWrites.length).toBeGreaterThanOrEqual(2);
    for (const [, , options] of stateWrites) {
      expect(options?.expiration).toBeInstanceOf(Date);
      expect(options!.expiration!.getTime()).toBeGreaterThan(Date.now());
    }
    expect((await CommonWordsAggregator.getJobState())?.status).toBe('cancelled');
    expect(await redis.expireTime('commonWords:job:state')).toBeGreaterThan(Date.now() / 1000);
    expect(await redis.expireTime('commonWords:job:counts')).toBeGreaterThan(Date.now() / 1000);
  } finally {
    scheduled.mockRestore();
    written.mockRestore();
  }
});
