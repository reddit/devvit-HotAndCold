import { z } from 'zod';
import { fn } from '../../shared/fn';
import { redis, scheduler } from '@devvit/web/server';
import { Reminders } from './reminder';
import { pushnotif } from '@devvit/pushnotif';
import type { BulkPushNotifQueueOptions } from '@devvit/pushnotif';
import { User } from './user';
import { Timezones } from './timezones';

export namespace Notifications {
  // GroupPayloadsKey: HASH groupId -> JSON payload (params, recipients[], dueAtMs)
  //   Purpose: Store full group payloads outside the ZSET to keep time scans fast.
  export const GroupPayloadsKey = () => `notifications:groups:payloads` as const;
  // GroupPendingKey: ZSET groupId -> dueAtMs
  //   Purpose: Schedule/claim groups by due time and atomically claim via zRem.
  export const GroupPendingKey = () => `notifications:groups:pending` as const;
  // GroupProgressKey: HASH groupId -> nextIndex
  //   Purpose: Track per-group send progress to avoid re-sending on retries.
  export const GroupProgressKey = () => `notifications:groups:progress` as const;

  // Notification delivery architecture
  // - enqueueNewChallengeByTimezone creates one notification "group" per timezone cohort and:
  //   (a) stores the group's payload in a HASH keyed by groupId, and
  //   (b) adds the groupId to a ZSET scored by dueAtMs for ordered scans.
  // - For precise delivery, we also schedule a one-off job (notifications-send-group) at dueAtMs
  //   that POSTs back with { groupId }. This is the primary/happy-path executor.
  // - For resilience, an hourly backup sweep (see /internal/scheduler/process-notifications)
  //   scans the ZSET by score<=now and sends any due-but-missed groups. This protects against
  //   transient failures, deploys, or handler errors that could cause a one-off job to be missed.
  // - To prevent double sends when both triggers fire around the same time, sendGroupNow first
  //   atomically "claims" the group by removing its member from the ZSET. Only the caller that
  //   successfully removes the member proceeds to send; others exit early.
  // - To avoid re-sending already delivered recipients on retry, we track per-group progress in a
  //   HASH (groupId -> nextIndex). We advance the index after each successful batch. On failure we
  //   requeue the group; the next attempt resumes from the saved index.

  type Recipient = { userId: string; link: string; data: Record<string, string> };
  type NotificationType = 'NEW_CHALLENGE';
  type GroupPayload = {
    type: NotificationType;
    params: { challengeNumber: number; postId: string; postUrl: string };
    recipients: Recipient[];
    dueAtMs: number;
  };

  export function getIanaOffsetMinutesAt(timeZone: string, utcMs: number): number {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'shortOffset',
        hour: '2-digit',
        hour12: false,
      }).formatToParts(new Date(utcMs));
      const tz = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00';
      const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(tz);
      if (!m) return 0;
      const sign = m[1] === '-' ? -1 : 1;
      const hh = Number(m[2]);
      const mm = Number(m[3] ?? '0');
      return sign * (hh * 60 + mm);
    } catch {
      return 0;
    }
  }

  /**
   * Compute the next UTC instant corresponding to a target local wall time in an IANA timezone.
   *
   * Invariant: the returned time is never in the past relative to baseUtcMs. If the current local
   * time is after or equal to the target (e.g., 23:00 when target is 09:00), we first advance the
   * local calendar day (by 24h) and then convert that next-day local wall time back to UTC. This
   * guarantees dueAtMs >= baseUtcMs across DST changes (23–25h days) and fractional offsets
   * (e.g., +05:30, +05:45, +08:45).
   */
  function nextLocalSendTimeUtcMsIana(opts: {
    baseUtcMs: number;
    timeZone: string; // IANA
    hourLocal: number; // 0-23
    minuteLocal?: number; // 0-59
  }): number {
    const { baseUtcMs, timeZone, hourLocal, minuteLocal = 0 } = opts;
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const partsToObj = (ms: number) =>
      Object.fromEntries(dtf.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    const nowL = partsToObj(baseUtcMs);
    const y = Number(nowL.year),
      m = Number(nowL.month),
      d = Number(nowL.day);
    const h = Number(nowL.hour),
      min = Number(nowL.minute);
    let ty = y,
      tm = m,
      td = d;
    if (h > hourLocal || (h === hourLocal && min >= minuteLocal)) {
      const tomorrowL = partsToObj(baseUtcMs + 24 * 60 * 60 * 1000);
      ty = Number(tomorrowL.year);
      tm = Number(tomorrowL.month);
      td = Number(tomorrowL.day);
    }
    const localAsUtc = Date.UTC(ty, tm - 1, td, hourLocal, minuteLocal, 0, 0);
    let guess = localAsUtc;
    for (let i = 0; i < 2; i++) {
      const offMin = getIanaOffsetMinutesAt(timeZone, guess);
      guess = localAsUtc - offMin * 60_000;
    }
    return guess;
  }

  function generateGroupId(zone: string): string {
    return `grp_${zone}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  }

  function assertValidZoneString(s: string): void {
    if (s.includes('/')) return; // IANA-like
    if (/^UTC[+-]\d{2}:\d{2}$/.test(s)) return; // offset label
    throw new Error(`Invalid timezone string: ${s}`);
  }

  function utcOffsetLabelAt(timeZone: string, utcMs: number): string {
    const off = getIanaOffsetMinutesAt(timeZone, utcMs);
    const sign = off >= 0 ? '+' : '-';
    const abs = Math.abs(off);
    const hh = String(Math.floor(abs / 60)).padStart(2, '0');
    const mm = String(abs % 60).padStart(2, '0');
    return `UTC${sign}${hh}:${mm}`;
  }

  // Concurrency utility for fast Redis-bound workflows
  async function parallelLimit<T, R>(
    items: readonly T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    async function worker(): Promise<void> {
      for (;;) {
        const i = next++;
        if (i >= items.length) break;
        const item = items[i];
        if (item === undefined) continue;
        results[i] = await mapper(item as T, i);
      }
    }
    const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
    await Promise.all(workers);
    return results;
  }

  export const enqueueNewChallengeByTimezone = fn(
    z.object({
      challengeNumber: z.number().int().gt(0),
      postId: z.string().min(1), // e.g., t3_...
      postUrl: z.string().min(1),
      localSendHour: z.number().int().min(0).max(23).default(9),
      localSendMinute: z.number().int().min(0).max(59).default(0),
      dryRun: z.boolean().default(false).optional(),
    }),
    async ({
      challengeNumber,
      postId,
      postUrl,
      localSendHour,
      localSendMinute,
      dryRun = false,
    }) => {
      const createdAtMs = Date.now();
      const startMs = createdAtMs;
      console.log('[Notifications] enqueueNewChallengeByTimezone start', {
        challengeNumber,
        localSendHour,
        localSendMinute,
        dryRun,
        createdAtIso: new Date(createdAtMs).toISOString(),
      });
      const tFetchRecipientsStart = Date.now();
      const recipients = await Reminders.getAllUsersOptedIntoReminders();
      const usernames = recipients.map((r) => r.member);
      console.log('[Notifications] reminder recipients fetched', {
        usernames: usernames.length,
        elapsedMs: Date.now() - tFetchRecipientsStart,
      });

      const zoneToRecipients = new Map<string, Recipient[]>();
      const totals = {
        totalRecipients: usernames.length,
        resolvedIds: 0,
        missingIds: 0,
        cachedId: 0,
        apiLookupId: 0,
        apiLookupFailures: 0,
        timezoneHits: 0,
        timezoneMissing: 0,
        defaultedTimezone: 0,
      };
      const tMapStart = Date.now();
      // Stage 1: Resolve user ids from Redis mapping only (no Reddit API fallbacks)
      const idResults = await parallelLimit(usernames, 1000, async (username) => {
        const id = await User.lookupIdByUsername(username);
        return { username, userId: id };
      });
      const withIds = idResults.filter((r) => r.userId !== null) as Array<{
        username: string;
        userId: string;
      }>;
      totals.resolvedIds = withIds.length;
      totals.missingIds = usernames.length - withIds.length;
      totals.cachedId = withIds.length; // all ids came from cache
      totals.apiLookupId = 0;
      totals.apiLookupFailures = 0;

      // Stage 2: Fetch timezones in parallel with 1000-concurrency and group
      const tzResults = await parallelLimit(withIds, 1000, async ({ username, userId }) => {
        const tTzStart = Date.now();
        const iana = await Timezones.getUserTimezone({ username });
        const tzLookupMs = Date.now() - tTzStart;
        return { username, userId, iana, tzLookupMs };
      });

      let slowTzLookups = 0;
      for (const r of tzResults) {
        if (r.tzLookupMs > 200) slowTzLookups++;
        const zone = r.iana ?? 'America/New_York';
        if (r.iana) totals.timezoneHits++;
        else {
          totals.timezoneMissing++;
          totals.defaultedTimezone++;
        }
        const arr = zoneToRecipients.get(zone) ?? [];
        arr.push({ userId: r.userId, link: postId, data: { username: r.username } });
        zoneToRecipients.set(zone, arr);
      }
      if (slowTzLookups > 0) {
        console.log('[Notifications] slow timezone lookups', { count: slowTzLookups });
      }

      // Log grouping distribution summary
      const groupingSummary: Array<{ zone: string; size: number }> = [];
      for (const [z, rs] of zoneToRecipients.entries()) {
        groupingSummary.push({ zone: z, size: rs.length });
      }
      groupingSummary.sort((a, b) => b.size - a.size);
      const topZones = groupingSummary.slice(0, Math.min(10, groupingSummary.length));
      console.log('[Notifications] timezone grouping summary', {
        uniqueZones: zoneToRecipients.size,
        topZones,
        totals,
        mapElapsedMs: Date.now() - tMapStart,
      });

      const scheduled: Array<{ groupId: string; zone: string; dueAtMs: number; size: number }> = [];

      // Coalesce by offset-at-due-time to ensure a single group per offset/dueAt
      const buckets = new Map<
        string,
        { label: string; dueAtMs: number; recipients: Recipient[] }
      >();
      for (const [iana, recipients] of zoneToRecipients.entries()) {
        if (recipients.length === 0) continue;
        const dueAtMs = nextLocalSendTimeUtcMsIana({
          baseUtcMs: createdAtMs,
          timeZone: iana,
          hourLocal: localSendHour,
          minuteLocal: localSendMinute,
        });
        const label = utcOffsetLabelAt(iana, dueAtMs);
        const key = `${label}|${dueAtMs}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.recipients.push(...recipients);
        else buckets.set(key, { label, dueAtMs, recipients: recipients.slice() });
      }

      for (const { label, dueAtMs, recipients } of buckets.values()) {
        assertValidZoneString(label);
        const groupId = generateGroupId(label);
        const dueAtIso = new Date(dueAtMs).toISOString();
        if (dryRun) {
          console.log('[Notifications] group prepared (dry-run)', {
            groupId,
            zone: label,
            size: recipients.length,
            dueAtIso,
          });
        }
        if (!dryRun) {
          const payload: GroupPayload = {
            type: 'NEW_CHALLENGE',
            params: { challengeNumber, postId, postUrl },
            recipients,
            dueAtMs,
          };
          const tStoreStart = Date.now();
          await redis.hSet(GroupPayloadsKey(), { [groupId]: JSON.stringify(payload) });
          const tHsetMs = Date.now() - tStoreStart;
          const tZaddStart = Date.now();
          await redis.zAdd(GroupPendingKey(), { member: groupId, score: dueAtMs });
          const tZaddMs = Date.now() - tZaddStart;
          const tSchedStart = Date.now();
          await scheduler.runJob({
            name: 'notifications-send-group',
            runAt: new Date(dueAtMs),
            data: { groupId },
          });
          const tSchedMs = Date.now() - tSchedStart;
          console.log('[Notifications] scheduled group', {
            groupId,
            zone: label,
            size: recipients.length,
            dueAtMs,
            runAtIso: new Date(dueAtMs).toISOString(),
            timingsMs: { hset: tHsetMs, zadd: tZaddMs, schedule: tSchedMs },
          });
        }
        scheduled.push({ groupId, zone: label, dueAtMs, size: recipients.length });
      }

      // Sort by due time for nicer presentation
      scheduled.sort((a, b) => a.dueAtMs - b.dueAtMs);
      const totalRecipients = scheduled.reduce((acc, g) => acc + g.size, 0);
      const elapsedMs = Date.now() - startMs;
      console.log('[Notifications] enqueueNewChallengeByTimezone completed', {
        groups: scheduled.length,
        totalRecipients,
        elapsedMs,
        dryRun,
        firstRunAtIso: scheduled[0]?.dueAtMs
          ? new Date(scheduled[0].dueAtMs).toISOString()
          : undefined,
        totals,
      });
      return {
        groups: scheduled,
        totalRecipients,
        scheduled: dryRun ? 0 : scheduled.length,
      } as const;
    }
  );

  function resolveCopyFor(type: NotificationType, params: any): { title: string; body: string } {
    switch (type) {
      case 'NEW_CHALLENGE': {
        const n = Number(params?.challengeNumber ?? 0) || 0;
        return {
          title: `Today's puzzle is here!`,
          body: `Play #${n} now.`,
        };
      }
      default:
        return { title: 'Notification', body: '' };
    }
  }

  export const sendGroupNow = fn(z.object({ groupId: z.string().min(1) }), async ({ groupId }) => {
    const startMs = Date.now();
    console.log('[Notifications] sendGroupNow start', { groupId });
    // Claim: remove the group from the pending ZSET first to avoid double sends.
    // Only one caller will successfully remove the member (returns 1). All others bail.
    const claimed = await redis.zRem(GroupPendingKey(), [groupId]);
    if (!claimed) {
      console.log('[Notifications] sendGroupNow skipped (already claimed or sent)', {
        groupId,
        elapsedMs: Date.now() - startMs,
      });
      return { ok: false, reason: 'already-claimed' } as const;
    }
    const raw = await redis.hGet(GroupPayloadsKey(), groupId);
    if (!raw) {
      console.log('[Notifications] sendGroupNow missing payload', {
        groupId,
        elapsedMs: Date.now() - startMs,
      });
      return { ok: false, reason: 'missing' } as const;
    }
    const payload = JSON.parse(raw) as GroupPayload;
    const progressStr = await redis.hGet(GroupProgressKey(), groupId);
    const startIndex = Number.parseInt(progressStr || '0', 10) || 0;
    const totalRecipients = Array.isArray(payload.recipients) ? payload.recipients.length : 0;
    if (!Array.isArray(payload.recipients) || payload.recipients.length === 0) {
      await redis.hDel(GroupPayloadsKey(), [groupId]);
      await redis.hDel(GroupProgressKey(), [groupId]);
      console.log('[Notifications] sendGroupNow empty group', {
        groupId,
        type: payload.type,
        zone: payload?.params ? undefined : undefined,
        elapsedMs: Date.now() - startMs,
      });
      return { ok: false, reason: 'empty' } as const;
    }
    const { title, body } = resolveCopyFor(payload.type, payload.params);
    const count = totalRecipients - startIndex;
    console.log('[Notifications] sending group', {
      groupId,
      type: payload.type,
      count,
      dueAtMs: payload.dueAtMs,
      runAtIso: new Date().toISOString(),
    });
    const mappedRecipientsAll = payload.recipients.map((r) => ({
      userId: r.userId as `t2_${string}`,
      link: payload.params.postId as `t3_${string}`,
      data: r.data,
    }));
    const mappedRecipients = mappedRecipientsAll.slice(startIndex);
    const maxBatchSize = 1000;
    try {
      let nextIndex = startIndex;
      for (let i = 0; i < mappedRecipients.length; i += maxBatchSize) {
        const batchRecipients = mappedRecipients.slice(i, i + maxBatchSize);
        const bulk: BulkPushNotifQueueOptions = {
          title,
          body,
          recipients: batchRecipients,
        };
        await pushnotif.bulkQueue(bulk);
        nextIndex += batchRecipients.length;
        await redis.hSet(GroupProgressKey(), { [groupId]: String(nextIndex) });
      }
    } catch (error) {
      console.error('[Notifications] error queuing push notifications', { groupId, error });
      // Re-queue on failure to preserve eventual delivery. We already "claimed" by
      // removing from the ZSET; add it back at its original dueAtMs for the backup sweep.
      await redis.zAdd(GroupPendingKey(), { member: groupId, score: payload.dueAtMs });
      throw error;
    }
    await redis.hDel(GroupProgressKey(), [groupId]);
    await redis.hDel(GroupPayloadsKey(), [groupId]);
    console.log('[Notifications] sendGroupNow completed', {
      groupId,
      sent: count,
      elapsedMs: Date.now() - startMs,
    });
    return { ok: true } as const;
  });

  export const sendDueGroups = fn(
    z.object({ limit: z.number().int().min(1).max(1000).default(10) }),
    async ({ limit }) => {
      const startMs = Date.now();
      const now = Date.now();
      console.log('[Notifications] sendDueGroups start', {
        limit,
        nowIso: new Date(now).toISOString(),
      });
      const due = await redis.zRange(GroupPendingKey(), 0, now, { by: 'score' });
      console.log('[Notifications] due groups fetched', {
        totalDue: due.length,
        sample: due.slice(0, Math.min(5, due.length)).map((x) => x.member),
      });
      if (due.length === 0) {
        console.log('[Notifications] nothing to send (no groups due)');
      }
      const toSend = due.slice(0, limit).map((x) => x.member);
      let sent = 0;
      for (const gid of toSend) {
        const result = await sendGroupNow({ groupId: gid });
        if (result?.ok) sent++;
      }
      const elapsedMs = Date.now() - startMs;
      console.log('[Notifications] sendDueGroups completed', {
        processed: toSend.length,
        sent,
        elapsedMs,
      });
      return { processed: toSend.length, sent } as const;
    }
  );

  export const pendingStats = fn(z.void(), async () => {
    const startMs = Date.now();
    const total = await redis.zCard(GroupPendingKey());
    const sample = await redis.zRange(GroupPendingKey(), 0, Math.min(10, total - 1), {
      by: 'rank',
    });
    const result = {
      total,
      next: sample.map((x) => ({ groupId: x.member, dueAtMs: x.score })),
    } as const;
    console.log('[Notifications] pendingStats', {
      total: result.total,
      sampleCount: result.next.length,
      elapsedMs: Date.now() - startMs,
    });
    return result;
  });

  export const clearAllPending = fn(z.void(), async () => {
    const startMs = Date.now();
    const ids = await redis.zRange(GroupPendingKey(), 0, -1, { by: 'rank' });
    const members = ids.map((x) => x.member);
    console.log('[Notifications] clearAllPending start', { count: members.length });
    if (members.length > 0) await redis.hDel(GroupPayloadsKey(), members);
    if (members.length > 0) await redis.zRem(GroupPendingKey(), members);
    console.log('[Notifications] clearAllPending completed', {
      cleared: members.length,
      elapsedMs: Date.now() - startMs,
    });
  });

  export const sendSingleNow = fn(
    z.object({
      username: z.string().min(1),
      postId: z.string().min(1),
      title: z.string().min(1),
      body: z.string().min(1),
    }),
    async ({ username, postId, title, body }) => {
      const startMs = Date.now();
      console.log('[Notifications] sendSingleNow start', { username, postId });
      const userId = await User.lookupIdByUsername(username);
      if (!userId) {
        console.log('[Notifications] sendSingleNow user not found', { username });
        return { ok: false as const, reason: 'user-not-found' as const };
      }
      const isOptedIn = await Reminders.isUserOptedIntoReminders({ username });
      if (!isOptedIn) {
        console.log('[Notifications] sendSingleNow user not opted-in', { username });
        throw new Error('User is not opted into push notifications');
      }
      try {
        const recipients: NonNullable<BulkPushNotifQueueOptions['recipients']> = [
          {
            userId: userId as `t2_${string}`,
            link: postId as `t3_${string}`,
            data: { username },
          },
        ];
        await pushnotif.bulkQueue({ title, body, recipients });
        console.log('[Notifications] sendSingleNow completed', {
          username,
          postId,
          elapsedMs: Date.now() - startMs,
        });
        return { ok: true as const };
      } catch (error) {
        console.error('[Notifications] sendSingleNow error', { username, postId, error });
        throw error;
      }
    }
  );

  // Test-only exports for internal time calculations
  export const __test__ = {
    nextLocalSendTimeUtcMsIana,
    getIanaOffsetMinutesAt,
    utcOffsetLabelAt,
  } as const;
}
