// Shared realtime message types and helpers for HORDE mode

export type HordeGuessBatchItem = {
  word: string;
  similarity: number;
  rank: number;
  atMs: number;
  username?: string;
};

export type HordeGameUpdate = {
  challengeNumber: number;
  totalPlayers?: number;
  totalGuesses?: number;
  currentHordeLevel?: number;
  timeRemainingMs?: number;
  status?: 'running' | 'lost' | 'won';
  winners?: string[]; // winners per wave, index = wave-1
  topGuesses?: Array<{ word: string; bestRank: number; authors: string[] }>;
  topGuessers?: Array<{ username: string; count: number }>;
};

export type HordeMessage =
  | { type: 'guess_batch'; guesses: HordeGuessBatchItem[]; challengeNumber: number }
  | { type: 'game_update'; update: HordeGameUpdate }
  | {
      type: 'wave_cleared';
      challengeNumber: number;
      wave: number; // wave that was cleared
      winner: string;
      timeRemainingMs: number;
      nextWave: number; // wave index after increment
    };

export const hordeChannelName = (challengeNumber: number) =>
  `horde-challenge-${challengeNumber}` as const;
