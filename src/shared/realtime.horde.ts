// Shared realtime message types and helpers for HORDE mode

export type HordeGuessBatchItem = {
  word: string;
  similarity: number;
  rank: number;
  atMs: number;
  wave: number; // wave this guess belongs to
  username?: string;
  snoovatar?: string | null;
};

export type HordeGameUpdate = {
  challengeNumber: number;
  totalPlayers?: number;
  totalGuesses?: number;
  currentHordeWave?: number;
  timeRemainingMs?: number;
  hordeStatus?: 'running' | 'lost' | 'won';
  totalWaves?: number;
  waves: { wave: number; username: string; snoovatar?: string; word: string; clearedAtMs: number }[];
  currentWaveTopGuesses?: Array<{ word: string; rank: number; username: string; snoovatar?: string }>;
  topHordeGuessers?: Array<{ username: string; count: number; snoovatar?: string }>;
};

export type HordeMessage =
  | { type: 'guess_batch'; guesses: HordeGuessBatchItem[]; challengeNumber: number }
  | { type: 'game_update'; update: HordeGameUpdate }
  | {
      type: 'wave_cleared';
      challengeNumber: number;
      wave: number; // wave that was cleared
      winner: string;
      winnerSnoovatar?: string;
      word: string;
      clearedAtMs: number;
      timeRemainingMs: number;
      nextWave: number; // wave index after increment
      totalWaves: number;
    };

export const hordeChannelName = (challengeNumber: number) =>
  `horde-challenge-${challengeNumber}` as const;
