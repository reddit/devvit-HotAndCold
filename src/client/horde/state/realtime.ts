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
export const hordeWaveClear = signal<
  | {
      wave: number;
      winner: string;
      winnerSnoovatar?: string;
      word: string;
      visibleUntilMs: number;
      isFinalWave?: boolean;
    }
  | null
>(null);

function handleMessage(msg: HordeMessage) {
  if (msg.type === 'guess_batch') {
    // Only accept guesses for the currently active wave to avoid cross-wave flashes
    const currentWave = hordeGameUpdate.value?.currentHordeWave;
    const incoming = Array.isArray(msg.guesses)
      ? msg.guesses.filter((g) =>
          typeof currentWave === 'number' && Number.isFinite(currentWave)
            ? g.wave === currentWave
            : true
        )
      : [];
    // Append new guesses to the front; keep a modest cap to avoid unbounded growth
    const next = [...incoming.map((g) => ({ ...g }))];
    // Preserve existing items, de-duping by word+atMs+username tuple
    const seen = new Set(next.map((g) => `${g.word}:${g.atMs}:${g.username ?? ''}`));
    for (const existing of hordeTickerGuesses.value) {
      const key = `${existing.word}:${existing.atMs}:${existing.username ?? ''}`;
      if (!seen.has(key)) next.push(existing);
    }
    hordeTickerGuesses.value = next.slice(0, 50);
  } else if (msg.type === 'wave_cleared') {
    // Show a brief overlay and reset per-wave UI state
    const visibleForMs = 4000;
    const prev = hordeGameUpdate.value;
    const totalWavesFromUpdate = prev?.totalWaves;
    const totalWaves = Number.isFinite(msg.totalWaves) && msg.totalWaves > 0
      ? msg.totalWaves
      : Number.isFinite(totalWavesFromUpdate) && (totalWavesFromUpdate as number) > 0
        ? (totalWavesFromUpdate as number)
        : null;
    const isFinalWave = totalWaves != null ? msg.wave >= totalWaves : false;
    const overlay: NonNullable<typeof hordeWaveClear.value> = {
      wave: msg.wave,
      winner: msg.winner,
      word: msg.word,
      visibleUntilMs: Date.now() + visibleForMs,
      isFinalWave,
    };
    if (msg.winnerSnoovatar) overlay.winnerSnoovatar = msg.winnerSnoovatar;
    hordeWaveClear.value = overlay;
    hordeTickerGuesses.value = [];
    // Optimistically advance current wave and time remaining for immediate UX
    if (prev) {
      const nextWave = msg.nextWave;
      const next: HordeGameUpdate = {
        ...prev,
        currentHordeWave: isFinalWave ? msg.wave : nextWave,
        timeRemainingMs: msg.timeRemainingMs,
        currentWaveTopGuesses: [],
        waves: (() => {
          const list = Array.isArray(prev.waves) ? [...prev.waves] : [];
          const entry: HordeGameUpdate['waves'][number] = {
            wave: msg.wave,
            username: msg.winner,
            word: msg.word,
            clearedAtMs: msg.clearedAtMs,
          };
          if (msg.winnerSnoovatar) entry.snoovatar = msg.winnerSnoovatar;
          const existingIdx = list.findIndex((item) => item.wave === msg.wave);
          if (existingIdx >= 0) {
            list[existingIdx] = entry;
          } else {
            list.push(entry);
          }
          return list.sort((a, b) => a.wave - b.wave);
        })(),
      };
      next.hordeStatus = isFinalWave ? 'won' : prev.hordeStatus ?? 'running';
      if (totalWaves != null) next.totalWaves = totalWaves;
      hordeGameUpdate.value = next;
    }
    // Auto-hide overlay
    setTimeout(() => {
      if (hordeWaveClear.value && hordeWaveClear.value.visibleUntilMs <= Date.now()) {
        hordeWaveClear.value = null;
      }
    }, visibleForMs + 50);
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
          Array.isArray(update.currentWaveTopGuesses) &&
          update.currentWaveTopGuesses.length > 0
        ) {
          const next: HordeGuessBatchItem[] = update.currentWaveTopGuesses.map((guess) => ({
            word: guess.word,
            similarity: 0,
            rank: guess.rank,
            atMs: Date.now(),
            wave: Number(update.currentHordeWave ?? 1),
            username: guess.username,
            snoovatar: guess.snoovatar ?? null,
          }));
          hordeTickerGuesses.value = next;
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
