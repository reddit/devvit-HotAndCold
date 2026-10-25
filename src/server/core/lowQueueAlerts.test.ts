import { expect, vi } from 'vitest';
import { reddit, redis } from '@devvit/web/server';
import { test } from '../test';
import { LowQueueAlerts } from './lowQueueAlerts';
import { WordQueue } from './wordQueue';

const moderator = { id: 't2_mod', username: 'moderator' };
const nextCheck = async (size: number) => {
  // Simulate the next scheduled hour without sleeping for the lease to expire.
  await redis.del('queueAlerts:checkLock');
  return LowQueueAlerts.check(size);
};
const mockReddit = () => {
  const mods = vi
    .spyOn(reddit, 'getModerators')
    .mockReturnValue({ all: async () => [moderator] } as any);
  const send = vi.spyOn(reddit, 'sendPrivateMessage').mockResolvedValue();
  return {
    mods,
    send,
    restore: () => {
      mods.mockRestore();
      send.mockRestore();
    },
  };
};

test('alerts are opt-in, begin at seven, suppress overlapping checks, and warn once more when empty', async () => {
  const mock = mockReddit();
  try {
    await LowQueueAlerts.check(2);
    expect(mock.send).not.toHaveBeenCalled();
    await LowQueueAlerts.setEnabled(moderator.id, moderator.username, true);
    await nextCheck(8);
    expect(mock.send).not.toHaveBeenCalled();
    const results = await Promise.all([LowQueueAlerts.check(7), LowQueueAlerts.check(7)]);
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
    expect(mock.send).toHaveBeenCalledTimes(1);
    expect(mock.send.mock.calls[0]![0]).toMatchObject({
      to: 'moderator',
      text: expect.stringContaining('**7 queued words**'),
    });
    await nextCheck(6);
    await nextCheck(1);
    expect(mock.send).toHaveBeenCalledTimes(1);
    await nextCheck(0);
    await nextCheck(0);
    expect(mock.send).toHaveBeenCalledTimes(2);
    // Refilling only to a low level does not create another low-queue episode.
    await nextCheck(3);
    expect(mock.send).toHaveBeenCalledTimes(2);
    await WordQueue.addMany({
      challenges: Array.from({ length: 8 }, (_, i) => ({ word: `word${i}` })),
      prepend: false,
    });
    await LowQueueAlerts.recordRefill();
    await nextCheck(7);
    expect(mock.send).toHaveBeenCalledTimes(3);
  } finally {
    mock.restore();
  }
});

test('empty queues notify directly, opt-outs stop delivery, and former moderators are removed', async () => {
  const mock = mockReddit();
  try {
    await LowQueueAlerts.setEnabled(moderator.id, moderator.username, true);
    await nextCheck(0);
    expect(mock.send).toHaveBeenCalledTimes(1);
    expect(mock.send.mock.calls[0]![0].text).toContain('cannot post until more words are added');
    await LowQueueAlerts.setEnabled(moderator.id, moderator.username, false);
    await nextCheck(0);
    expect(mock.send).toHaveBeenCalledTimes(1);
    await LowQueueAlerts.setEnabled(moderator.id, moderator.username, true);
    mock.mods.mockReturnValue({ all: async () => [] } as any);
    await nextCheck(0);
    expect(mock.send).toHaveBeenCalledTimes(1);
    expect(await LowQueueAlerts.isEnabled(moderator.id)).toBe(false);
  } finally {
    mock.restore();
  }
});

test('failed delivery retries next hour without losing another moderator’s alert', async () => {
  const mock = mockReddit();
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    mock.mods.mockReturnValue({
      all: async () => [moderator, { id: 't2_other', username: 'othermod' }],
    } as any);
    await LowQueueAlerts.setEnabled(moderator.id, moderator.username, true);
    await LowQueueAlerts.setEnabled('t2_other', 'othermod', true);
    mock.send.mockImplementation(async ({ to }) => {
      if (to === 'moderator') throw new Error('Reddit unavailable');
    });
    expect(await nextCheck(5)).toEqual({ sent: 1 });
    mock.send.mockResolvedValue();
    expect(await nextCheck(4)).toEqual({ sent: 1 });
    expect(mock.send.mock.calls.map(([message]) => message.to)).toEqual([
      'moderator',
      'othermod',
      'moderator',
    ]);
    expect(await nextCheck(3)).toEqual({ sent: 0 });
  } finally {
    log.mockRestore();
    mock.restore();
  }
});
