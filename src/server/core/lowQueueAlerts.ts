import { randomUUID } from 'node:crypto';
import { context, reddit, redis } from '@devvit/web/server';
import { LOW_QUEUE_THRESHOLD } from '../../shared/lowQueue';
import { WordQueue } from './wordQueue';

// Installation-scoped, tiny records: opt-in usernames, delivery receipts, and
// one refill generation. Never store queued words or puzzle answers here.
export namespace LowQueueAlerts {
  const subscribersKey = 'queueAlerts:subscribers';
  const receiptsKey = 'queueAlerts:receipts';
  const generationKey = 'queueAlerts:generation';
  const lockKey = 'queueAlerts:checkLock';

  export async function isEnabled(userId: string): Promise<boolean> {
    return Boolean(await redis.hGet(subscribersKey, userId));
  }

  // The caller must verify current moderator access and derive identity from
  // the request, never from client-supplied usernames or recipient IDs.
  export async function setEnabled(userId: string, username: string, enabled: boolean) {
    if (enabled) {
      await redis.hSet(subscribersKey, { [userId]: username });
    } else {
      await redis.hDel(subscribersKey, [userId]);
      await redis.hDel(receiptsKey, [userId]);
    }
    return { enabled };
  }

  export async function recordRefill(queueSize?: number): Promise<void> {
    try {
      if ((queueSize ?? (await WordQueue.size())) > LOW_QUEUE_THRESHOLD) {
        await redis.set(generationKey, randomUUID());
      }
    } catch (error) {
      // Run once after each bulk add, including legacy forms. Alert bookkeeping
      // must not turn a successful queue write into an error for the moderator.
      console.error('[LowQueueAlerts] Unable to rearm alerts', error);
    }
  }

  export async function check(queueSize: number): Promise<{ sent: number }> {
    if (queueSize > LOW_QUEUE_THRESHOLD) {
      await recordRefill(queueSize);
      return { sent: 0 };
    }
    const subscribers = await redis.hGetAll(subscribersKey);
    if (!Object.keys(subscribers).length) return { sent: 0 };

    // Suppress overlapping scheduler deliveries. The short lease expires on
    // crashes too; a failed delivery remains eligible on the next hourly run.
    const claimed = await redis.set(lockKey, 'checking', {
      nx: true,
      expiration: new Date(Date.now() + 5 * 60_000),
    });
    if (claimed !== 'OK') return { sent: 0 };
    const moderators = await reddit.getModerators({ subredditName: context.subredditName }).all();
    const currentMods = new Map(moderators.map((mod) => [mod.id, mod.username]));
    const generation = (await redis.get(generationKey)) ?? 'initial';
    const band = queueSize === 0 ? 'empty' : 'low';
    let sent = 0;
    for (const userId of Object.keys(subscribers)) {
      const username = currentMods.get(userId as `t2_${string}`);
      if (!username) {
        await setEnabled(userId, '', false);
        continue;
      }
      const receipt = await redis.hGet(receiptsKey, userId);
      if (receipt === `${generation}:empty` || receipt === `${generation}:${band}`) continue;
      if (!(await isEnabled(userId))) continue;
      try {
        await reddit.sendPrivateMessage({
          to: username,
          subject: `Hot and Cold: ${queueSize === 0 ? 'Word Queue Empty' : 'Word Queue Running Low'}`,
          text:
            `r/${context.subredditName} has **${queueSize} queued ${queueSize === 1 ? 'word' : 'words'}** remaining. ` +
            (queueSize === 0
              ? 'The next daily puzzle cannot post until more words are added. '
              : `That is about ${queueSize} ${queueSize === 1 ? 'day' : 'days'} at one puzzle per day; extra posts use words faster. `) +
            `Open **Moderator Settings (Experimental) → Words** in [r/${context.subredditName}](https://www.reddit.com/r/${context.subredditName}/) to add words.\n\n` +
            'You enabled Notify Low Queue. You can turn it off under Words in Moderator Settings. Alerts reset after the queue is refilled above seven words.',
        });
        await redis.hSet(receiptsKey, { [userId]: `${generation}:${band}` });
        sent++;
      } catch (error) {
        console.error('[LowQueueAlerts] Delivery failed', { userId, error });
      }
    }
    return { sent };
  }
}
