import { it, expect, resetRedis } from '../test/devvitTest';
import { Notifications } from './notifications';
import { Reminders } from './reminder';
import { Timezones } from './timezones';
import { redis, scheduler, reddit } from '@devvit/web/server';
import { pushnotif } from '@devvit/pushnotif';
import type { BulkPushNotifQueueOptions, BulkPushNotifQueueResponse } from '@devvit/pushnotif';
import { vi } from 'vitest';

const PAYLOADS_KEY = 'notifications:groups:payloads';
const PENDING_KEY = 'notifications:groups:pending';
const PROGRESS_KEY = 'notifications:groups:progress';

it('groups recipients by timezone and schedules per-zone jobs', async () => {
  await resetRedis();

  // Fixed time: 2025-01-01T12:00:00.000Z
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T12:00:00.000Z'));

  // Stub external dependencies
  const scheduled: Array<{ name: string; runAt: Date; data: any }> = [];
  const runJobSpy = vi.spyOn(scheduler, 'runJob').mockImplementation(async (job: any) => {
    scheduled.push(job);
    return `job-${scheduled.length}`;
  });
  const getUserSpy = vi.spyOn(reddit, 'getUserByUsername').mockImplementation(
    async (username: string) =>
      ({
        id: `t2_${username}`,
        username,
        getSnoovatarUrl: async () => 'https://example.com/snoo.png',
      }) as any
  );

  try {
    // Opt-in three users and set timezones (two in Eastern, one in IST)
    await Reminders.setReminderForUsername({ username: 'alice' });
    await Reminders.setReminderForUsername({ username: 'bob' });
    await Reminders.setReminderForUsername({ username: 'carol' });

    await Timezones.setTimezone({ username: 'alice', iana: 'America/New_York' });
    await Timezones.setTimezone({ username: 'bob', iana: 'Asia/Kolkata' });
    await Timezones.setTimezone({ username: 'carol', iana: 'America/New_York' });

    // Enqueue grouped notifications for a new challenge
    const res = await Notifications.enqueueNewChallengeByTimezone({
      challengeNumber: 100,
      postId: 't3_abc',
      postUrl: 'https://example.com',
      localSendHour: 9,
      localSendMinute: 0,
    });

    expect(res.scheduled).toBe(2);
    expect(scheduled.length).toBe(2);

    // Verify pending stats and payload content
    const stats = await Notifications.pendingStats();
    expect(stats.total).toBe(2);
    for (const n of stats.next) {
      const raw = await redis.hGet(PAYLOADS_KEY, n.groupId);
      expect(typeof raw).toBe('string');
      const payload = JSON.parse(String(raw));
      expect(Array.isArray(payload.recipients)).toBe(true);
      expect(payload.params.challengeNumber).toBe(100);
      expect(payload.params.postId).toBe('t3_abc');
    }

    // EST group should contain 2 recipients, IST group 1
    const raws = await Promise.all(stats.next.map((n) => redis.hGet(PAYLOADS_KEY, n.groupId)));
    const sizes = raws.map((r) => (JSON.parse(String(r)).recipients as any[]).length).sort();
    expect(sizes).toEqual([1, 2]);
  } finally {
    runJobSpy.mockRestore();
    getUserSpy.mockRestore();
    vi.useRealTimers();
  }
});

it('sendGroupNow sends bulk push and clears the group', async () => {
  await resetRedis();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T12:00:00.000Z'));

  const runJobSpy = vi.spyOn(scheduler, 'runJob').mockResolvedValue('job');
  const getUserSpy = vi.spyOn(reddit, 'getUserByUsername').mockImplementation(
    async (username: string) =>
      ({
        id: `t2_${username}`,
        username,
        getSnoovatarUrl: async () => 'https://example.com/snoo.png',
      }) as any
  );
  const bulkCalls: BulkPushNotifQueueOptions[] = [];
  const bulkSpy = vi
    .spyOn(pushnotif, 'enqueue')
    .mockImplementation(
      async (opts: BulkPushNotifQueueOptions): Promise<BulkPushNotifQueueResponse> => {
        bulkCalls.push(opts);
        return { successCount: opts.recipients.length, failureCount: 0, errors: [] };
      }
    );

  try {
    await Reminders.setReminderForUsername({ username: 'alice' });
    await Timezones.setTimezone({ username: 'alice', iana: 'America/New_York' });

    await Notifications.enqueueNewChallengeByTimezone({
      challengeNumber: 101,
      postId: 't3_post',
      postUrl: 'https://example.com/p',
      localSendHour: 9,
    });

    const s = await Notifications.pendingStats();
    expect(s.total).toBe(1);
    const gid = s.next[0]!.groupId;

    const result = await Notifications.sendGroupNow({ groupId: gid });
    expect(result.ok).toBe(true);
    expect(bulkCalls.length).toBe(1);
    expect(bulkCalls[0]!.body).toContain('Play #101 now.');
    expect(Array.isArray(bulkCalls[0]!.recipients)).toBe(true);
    expect(bulkCalls[0]!.recipients[0]!.userId).toBe('t2_alice');
    expect(String(bulkCalls[0]!.recipients[0]!.link)).toBe('t3_post');

    // Cleared
    const raw = await redis.hGet(PAYLOADS_KEY, gid);
    expect(raw == null || raw === '').toBe(true);
    const after = await Notifications.pendingStats();
    expect(after.total).toBe(0);
  } finally {
    runJobSpy.mockRestore();
    getUserSpy.mockRestore();
    bulkSpy.mockRestore();
    vi.useRealTimers();
  }
});

it('sendDueGroups processes only due groups', async () => {
  await resetRedis();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T12:00:00.000Z'));

  const runJobSpy = vi.spyOn(scheduler, 'runJob').mockResolvedValue('job');
  const getUserSpy = vi.spyOn(reddit, 'getUserByUsername').mockImplementation(
    async (username: string) =>
      ({
        id: `t2_${username}`,
        username,
        getSnoovatarUrl: async () => 'https://example.com/snoo.png',
      }) as any
  );
  let bulkCount = 0;
  const bulkSpy = vi
    .spyOn(pushnotif, 'enqueue')
    .mockImplementation(async (): Promise<BulkPushNotifQueueResponse> => {
      bulkCount++;
      return { successCount: 1, failureCount: 0, errors: [] };
    });

  try {
    await Reminders.setReminderForUsername({ username: 'alice' });
    await Reminders.setReminderForUsername({ username: 'bob' });
    await Timezones.setTimezone({ username: 'alice', iana: 'America/New_York' });
    await Timezones.setTimezone({ username: 'bob', iana: 'Asia/Kolkata' });

    await Notifications.enqueueNewChallengeByTimezone({
      challengeNumber: 102,
      postId: 't3_id',
      postUrl: 'https://example.com/2',
      localSendHour: 9,
    });

    const s = await Notifications.pendingStats();
    expect(s.total).toBe(2);

    // Force one group to be due now by adjusting its score
    const gid = s.next[0]!.groupId;
    await redis.zAdd(PENDING_KEY, { member: gid, score: Date.now() - 1 });

    const result = await Notifications.sendDueGroups({ limit: 10 });
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(bulkCount).toBe(1);

    const after = await Notifications.pendingStats();
    expect(after.total).toBe(1);
  } finally {
    runJobSpy.mockRestore();
    getUserSpy.mockRestore();
    bulkSpy.mockRestore();
    vi.useRealTimers();
  }
});

it('pendingStats and clearAllPending reflect queue state', async () => {
  await resetRedis();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T12:00:00.000Z'));

  vi.spyOn(scheduler, 'runJob').mockResolvedValue('job');
  vi.spyOn(reddit, 'getUserByUsername').mockImplementation(
    async (username: string) =>
      ({
        id: `t2_${username}`,
        username,
        getSnoovatarUrl: async () => 'https://example.com/snoo.png',
      }) as any
  );

  await Reminders.setReminderForUsername({ username: 'alice' });
  await Reminders.setReminderForUsername({ username: 'bob' });
  await Timezones.setTimezone({ username: 'alice', iana: 'America/New_York' });
  await Timezones.setTimezone({ username: 'bob', iana: 'Asia/Kolkata' });

  await Notifications.enqueueNewChallengeByTimezone({
    challengeNumber: 103,
    postId: 't3_z',
    postUrl: 'https://example.com/z',
    localSendHour: 9,
  });

  const before = await Notifications.pendingStats();
  expect(before.total).toBe(2);

  await Notifications.clearAllPending();
  const after = await Notifications.pendingStats();
  expect(after.total).toBe(0);
});

it('resumes from progress on retry and avoids duplicate sends', async () => {
  await resetRedis();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T12:00:00.000Z'));

  const runJobSpy = vi.spyOn(scheduler, 'runJob').mockResolvedValue('job');
  vi.spyOn(reddit, 'getUserByUsername').mockImplementation(
    async (username: string) =>
      ({
        id: `t2_${username}`,
        username,
        getSnoovatarUrl: async () => 'https://example.com/snoo.png',
      }) as any
  );

  // Prepare >1000 recipients (ensures at least two batches with maxBatchSize=1000)
  const total = 1100;
  for (let i = 0; i < total; i++) {
    const u = `user_${i}`;
    await Reminders.setReminderForUsername({ username: u });
    await Timezones.setTimezone({ username: u, iana: 'America/New_York' });
  }

  await Notifications.enqueueNewChallengeByTimezone({
    challengeNumber: 200,
    postId: 't3_retry',
    postUrl: 'https://example.com/retry',
    localSendHour: 9,
  });

  const s = await Notifications.pendingStats();
  expect(s.total).toBe(1);
  const gid = s.next[0]!.groupId;

  // First attempt: succeed first batch (1000) then fail on second batch
  let call = 0;
  const bulkSpy = vi
    .spyOn(pushnotif, 'enqueue')
    .mockImplementation(async (opts: BulkPushNotifQueueOptions) => {
      call++;
      if (call === 2) {
        throw new Error('simulated failure');
      }
      return { successCount: opts.recipients.length, failureCount: 0, errors: [] };
    });

  // Force a smaller batch size by temporarily monkey-patching maxBatchSize via spy if needed
  // Kick off send; with fake timers, we must advance timers to allow the inter-batch delay
  const sending = Notifications.sendGroupNow({ groupId: gid });
  await vi.advanceTimersByTimeAsync(500);
  await expect(sending).rejects.toThrow();

  // After failure, the group should be back in pending and progress recorded
  const mid = await Notifications.pendingStats();
  expect(mid.total).toBe(1);
  const progress = await redis.hGet(PROGRESS_KEY, gid);
  expect(Number(progress)).toBeGreaterThanOrEqual(1000);

  // Second attempt should resume from progress and complete without re-sending the first part
  bulkSpy.mockImplementation(async (opts: BulkPushNotifQueueOptions) => {
    return { successCount: opts.recipients.length, failureCount: 0, errors: [] };
  });
  const result = await Notifications.sendGroupNow({ groupId: gid });
  expect(result.ok).toBe(true);

  // Cleared from payload/progress and not pending
  const raw = await redis.hGet(PAYLOADS_KEY, gid);
  expect(raw == null || raw === '').toBe(true);
  const prog = await redis.hGet(PROGRESS_KEY, gid);
  expect(prog == null || prog === '').toBe(true);
  const end = await Notifications.pendingStats();
  expect(end.total).toBe(0);

  runJobSpy.mockRestore();
  bulkSpy.mockRestore();
  vi.useRealTimers();
});

it('does not double-send when sendGroupNow is invoked concurrently', async () => {
  await resetRedis();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2025-01-01T12:00:00.000Z'));

  const runJobSpy = vi.spyOn(scheduler, 'runJob').mockResolvedValue('job');
  const getUserSpy = vi.spyOn(reddit, 'getUserByUsername').mockImplementation(
    async (username: string) =>
      ({
        id: `t2_${username}`,
        username,
        getSnoovatarUrl: async () => 'https://example.com/snoo.png',
      }) as any
  );

  const bulkCalls: BulkPushNotifQueueOptions[] = [];
  const bulkSpy = vi
    .spyOn(pushnotif, 'enqueue')
    .mockImplementation(async (opts: BulkPushNotifQueueOptions) => {
      bulkCalls.push(opts);
      return { successCount: opts.recipients.length, failureCount: 0, errors: [] };
    });

  try {
    await Reminders.setReminderForUsername({ username: 'dana' });
    await Timezones.setTimezone({ username: 'dana', iana: 'America/New_York' });

    await Notifications.enqueueNewChallengeByTimezone({
      challengeNumber: 300,
      postId: 't3_concurrent',
      postUrl: 'https://example.com/concurrent',
      localSendHour: 9,
    });

    const s = await Notifications.pendingStats();
    expect(s.total).toBe(1);
    const gid = s.next[0]!.groupId;

    const [r1, r2] = await Promise.all([
      Notifications.sendGroupNow({ groupId: gid }),
      Notifications.sendGroupNow({ groupId: gid }),
    ]);

    const oks = [r1, r2].filter((r) => r.ok).length;
    expect(oks).toBe(1);
    expect(bulkCalls.length).toBe(1);

    const after = await Notifications.pendingStats();
    expect(after.total).toBe(0);
    const raw = await redis.hGet(PAYLOADS_KEY, gid);
    expect(raw == null || raw === '').toBe(true);
  } finally {
    runJobSpy.mockRestore();
    getUserSpy.mockRestore();
    bulkSpy.mockRestore();
    vi.useRealTimers();
  }
});

it('schedules delivery at correct local times for IANA timezones', async () => {
  await resetRedis();
  vi.useFakeTimers();
  // Fixed base: 2025-01-01T12:00:00Z
  vi.setSystemTime(new Date('2025-01-01T12:00:00.000Z'));

  vi.spyOn(scheduler, 'runJob').mockResolvedValue('job');
  vi.spyOn(reddit, 'getUserByUsername').mockImplementation(
    async (username: string) =>
      ({
        id: `t2_${username}`,
        username,
        getSnoovatarUrl: async () => 'https://example.com/snoo.png',
      }) as any
  );

  try {
    await Reminders.setReminderForUsername({ username: 'est' });
    await Timezones.setTimezone({ username: 'est', iana: 'America/New_York' });
    await Reminders.setReminderForUsername({ username: 'ist' });
    await Timezones.setTimezone({ username: 'ist', iana: 'Asia/Kolkata' });

    const res = await Notifications.enqueueNewChallengeByTimezone({
      challengeNumber: 400,
      postId: 't3_time',
      postUrl: 'https://example.com/time',
      localSendHour: 9,
      localSendMinute: 0,
      dryRun: true,
    });

    expect(res.groups.length).toBe(2);

    // Expected due times:
    // America/New_York: local 07:00 at base → schedule same day 09:00 local = 2025-01-01T14:00:00Z
    // Asia/Kolkata: local 17:30 at base → schedule next day 09:00 local = 2025-01-02T03:30:00Z
    const expectedUtc = [
      Date.parse('2025-01-01T14:00:00.000Z'),
      Date.parse('2025-01-02T03:30:00.000Z'),
    ].sort((a, b) => a - b);

    const debug = res.groups
      .map((g) => ({
        zone: g.zone,
        dueAtMs: g.dueAtMs,
        iso: new Date(g.dueAtMs).toISOString(),
      }))
      .sort((a, b) => a.dueAtMs - b.dueAtMs);
    // Helpful diagnostics if this ever fails on CI environments with differing Intl data
    console.log('[tz-test] baseUtc', new Date('2025-01-01T12:00:00.000Z').toISOString());
    console.log('[tz-test] groups', debug);
    const actualUtc = debug.map((d) => d.dueAtMs);
    expect(actualUtc).toEqual(expectedUtc);
  } finally {
    vi.useRealTimers();
  }
});
