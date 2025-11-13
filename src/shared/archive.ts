export type ArchiveChallengeStatus = 'playing' | 'solved' | 'not_played';

export type ArchiveChallengeSummary = {
  challengeNumber: number;
  totalPlayers: number;
  totalSolves: number;
  totalGuesses: number;
  totalHints: number;
  totalGiveUps: number;
  status: ArchiveChallengeStatus;
  score: number | null;
  startedPlayingAtMs: number | null;
  solvedAtMs: number | null;
  gaveUpAtMs: number | null;
  postUrl: string | null;
  postId: string | null;
};

export type ArchiveListResponse = {
  items: ArchiveChallengeSummary[];
  nextCursor: number | null;
};
