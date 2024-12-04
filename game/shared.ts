export type Page =
  | "loading"
  | "play"
  | "stats"
  | "win";

export type Guess = {
  word: string;
  timestamp: number;
  similarity: number;
  normalizedSimilarity: number;
  rank: number;
  isHint: boolean;
};

export type PlayerProgress = {
  progress: number;
  avatar: string | null;
  username: string;
  isPlayer: boolean;
}[];

export type ScoreExplanation = {
  version: string;
  finalScore: number;
  breakdown: {
    solvingBonus: number;
    timeBonus: {
      points: number;
      timeInSeconds: number;
      isOptimal: boolean;
    };
    guessBonus: {
      points: number;
      numberOfGuesses: number;
      isOptimal: boolean;
    };
    hintPenalty: {
      numberOfHints: number;
      penaltyMultiplier: number;
    };
  };
};

export type Game = {
  number: number;
  // TODO: Need to get this
  // userStreak: number;
  // latestChallengeNumber: number;
  challengeInfo: {
    // DO NOT SEND THE WORD HERE!
    // THAT WOULD BE SILLY
    totalGuesses?: number | undefined;
    totalPlayers?: number | undefined;
    totalSolves?: number | undefined;
    totalHints?: number | undefined;
    totalGiveUps?: number | undefined;
  };
  challengeUserInfo: {
    score?: ScoreExplanation | undefined;
    startedPlayingAtMs?: number | undefined;
    solvedAtMs?: number | undefined;
    gaveUpAtMs?: number | undefined;
    guesses?: Guess[] | undefined;
    username: string;
  };
  challengeProgress: PlayerProgress;
};

export type GameResponse = Game;

export type UserSettings = {
  sortDirection: "ASC" | "DESC";
  sortType: "SIMILARITY" | "TIMESTAMP";
  layout: "CONDENSED" | "EXPANDED";
  isUserOptedIntoReminders: boolean;
};

export type ChallengeLeaderboardResponse = {
  // TODO: Community streak to see if the entire community can keep a solve per day going?
  userStreak: number;
  userRank: {
    score: number;
    timeToSolve: number;
  };
  leaderboardByScore: { member: string; score: number }[];
  leaderboardByFastest: { member: string; score: number }[];
};

export type WebviewToBlocksMessage =
  | { type: "GAME_INIT" }
  | {
    type: "WORD_SUBMITTED";
    value: string;
  }
  | { type: "HINT_REQUEST" }
  | { type: "GIVE_UP_REQUEST" }
  | {
    type: "SHOW_TOAST";
    string: string;
  }
  | { type: "LEADERBOARD_FOR_CHALLENGE" }
  | {
    type: "TOGGLE_USER_REMINDER";
    payload: {};
  };

export type BlocksToWebviewMessage =
  // TODO: Just make `GAME_RESPONSE`?
  | {
    type: "GAME_INIT_RESPONSE";
    payload: GameResponse;
  }
  | {
    type: "TOGGLE_USER_REMINDER_RESPONSE";
    payload: {
      isUserOptedIntoReminders: boolean;
    };
  }
  | {
    type: "WORD_SUBMITTED_RESPONSE";
    payload: GameResponse;
  }
  | {
    type: "HINT_RESPONSE";
    payload: GameResponse;
  }
  | {
    type: "GIVE_UP_RESPONSE";
    payload: GameResponse;
  }
  | {
    type: "PLAYER_PROGRESS_UPDATE";
    payload: { challengeProgress: GameResponse["challengeProgress"] };
  }
  | {
    type: "CHALLENGE_LEADERBOARD_RESPONSE";
    payload: ChallengeLeaderboardResponse;
  };

export type DevvitMessage = {
  type: "devvit-message";
  data: { message: BlocksToWebviewMessage };
};
