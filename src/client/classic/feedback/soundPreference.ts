import type { Signal } from '@preact/signals';
import { context } from '@devvit/web/client';
import { trpc } from '../../trpc';
import { soundEnabled } from './audio';

export function createSoundPreference({
  enabled,
  load,
  save,
}: {
  enabled: Signal<boolean>;
  load: () => Promise<boolean | null>;
  save: (enabled: boolean) => Promise<unknown>;
}) {
  let revision = 0;
  let writes = Promise.resolve();
  let pendingRead: Promise<void> | undefined;
  return {
    restore() {
      if (pendingRead) return pendingRead;
      const before = revision;
      const cached = enabled.value;
      pendingRead = (async () => {
        try {
          const stored = await load();
          // A late response must not undo a toggle made while the request was in flight.
          if (stored !== null && revision === before && enabled.value === cached)
            enabled.value = stored;
        } catch {
          // Keep the per-account browser preference when the server is unavailable.
        } finally {
          pendingRead = undefined;
        }
      })();
      return pendingRead;
    },
    choose(value: boolean) {
      revision++;
      enabled.value = value;
      let saved = true;
      // Serialize rapid toggles so the last choice is also the last server write.
      writes = writes.then(async () => {
        try {
          await save(value);
        } catch {
          saved = false;
        }
      });
      return writes.then(() => saved);
    },
  };
}

export const soundPreference = createSoundPreference({
  enabled: soundEnabled,
  load: async () => (context.userId ? (await trpc.audioSettings.get.query()).enabled : null),
  save: async (enabled) => {
    if (context.userId) await trpc.audioSettings.set.mutate({ enabled });
  },
});
