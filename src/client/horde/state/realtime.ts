import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { connectRealtime } from '@devvit/web/client';
import { trpc } from '../../trpc';
import {
  hordeChannelName,
  type HordeMessage,
  type HordeGuessBatchItem,
  type HordeGameUpdate,
} from '../../../shared/realtime.horde';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

export const hordeConnectionStatus = signal<ConnectionStatus>('idle');
export const hordeTickerGuesses = signal<HordeGuessBatchItem[]>([]);
export const hordeGameUpdate = signal<HordeGameUpdate | null>(null);

function handleMessage(msg: HordeMessage) {
  if (msg.type === 'guess_batch') {
    // Append new guesses to the front; keep a modest cap to avoid unbounded growth
    const next = [...msg.guesses.map((g) => ({ ...g }))];
    // Preserve existing items, de-duping by word+atMs+username tuple
    const seen = new Set(next.map((g) => `${g.word}:${g.atMs}:${g.username ?? ''}`));
    for (const existing of hordeTickerGuesses.value) {
      const key = `${existing.word}:${existing.atMs}:${existing.username ?? ''}`;
      if (!seen.has(key)) next.push(existing);
    }
    hordeTickerGuesses.value = next.slice(0, 50);
  } else if (msg.type === 'game_update') {
    // Keep game meta in sync via realtime; ticker is primed on initial render
    hordeGameUpdate.value = msg.update;
  }
}

async function connectToChallenge(challengeNumber: number): Promise<() => Promise<void> | void> {
  const channel = hordeChannelName(challengeNumber);
  console.log('horde realtime connecting to channel', channel);
  const connection = await connectRealtime({
    channel,
    onConnect: () => {
      console.log('horde realtime connected');
      hordeConnectionStatus.value = 'connected';
    },
    onDisconnect: () => {
      console.log('horde realtime disconnected');
      hordeConnectionStatus.value = 'closed';
    },
    onMessage: (message: unknown) => {
      console.log('horde realtime message', message);
      const msg = message as HordeMessage;
      handleMessage(msg);
    },
  });
  return () => connection.disconnect();
}

export function useHordeRealtime(challengeNumber: number): void {
  useEffect(() => {
    if (!Number.isFinite(challengeNumber) || challengeNumber <= 0) return;
    hordeConnectionStatus.value = 'connecting';
    let disconnect: (() => Promise<void> | void) | null = null;
    void (async () => {
      // Prime initial state to avoid empty UI on refresh
      try {
        const update = await trpc.horde.game.state.query({ challengeNumber });
        hordeGameUpdate.value = update;
        if (
          hordeTickerGuesses.value.length === 0 &&
          Array.isArray(update.topGuesses) &&
          update.topGuesses.length > 0
        ) {
          hordeTickerGuesses.value = update.topGuesses.map((it) => ({
            word: it.word,
            similarity: 0,
            rank: it.bestRank,
            atMs: Date.now(),
          }));
        }
      } catch (e) {
        console.error('Failed to fetch initial HORDE game state', e);
      }

      try {
        disconnect = await connectToChallenge(challengeNumber);
      } catch (e) {
        console.error('Failed to connect to horde realtime', e);
        hordeConnectionStatus.value = 'error';
      }
    })();

    return () => {
      if (!disconnect) {
        hordeConnectionStatus.value = 'closed';
        return;
      }
      try {
        const result = disconnect();
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).catch(() => {});
        }
      } finally {
        hordeConnectionStatus.value = 'closed';
      }
    };
  }, [challengeNumber]);
}
