import { useEffect, useState } from 'preact/hooks';
import { context } from '@devvit/web/client';
import { trpc } from '../../trpc';

export type ModeratorStatus = { isModerator: boolean; queueSize: number | null };
export const queueStatusKey = `moderator-queue-size:${context.subredditId ?? context.subredditName}:${context.userId}`;

export function notifyQueueSize(size: number) {
  try {
    localStorage.setItem(queueStatusKey, String(size));
  } catch {
    // Focus refresh remains available when browser storage is unavailable.
  }
}

export function useModeratorStatus(): ModeratorStatus {
  const [status, setStatus] = useState<ModeratorStatus>({ isModerator: false, queueSize: null });
  useEffect(() => {
    if (!context.userId) return;
    let mounted = true;
    let pending = false;
    let countRevision = 0;
    const refresh = () => {
      if (pending || document.visibilityState !== 'visible') return;
      pending = true;
      const before = countRevision;
      void trpc.moderation.access
        .query()
        .then((result) => {
          if (mounted)
            setStatus((current) => ({
              isModerator: result.isModerator,
              queueSize: result.isModerator
                ? before === countRevision
                  ? (result.queueSize ?? null)
                  : current.queueSize
                : null,
            }));
        })
        .catch(() => {})
        .finally(() => {
          pending = false;
        });
    };
    const changed = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== queueStatusKey || !event.newValue)
        return;
      const size = Number(event.newValue);
      if (!Number.isSafeInteger(size) || size < 0) return;
      countRevision++;
      setStatus((current) => (current.isModerator ? { ...current, queueSize: size } : current));
    };
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('storage', changed);
    return () => {
      mounted = false;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('storage', changed);
    };
  }, []);
  return status;
}
