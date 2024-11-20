export type Page =
  | "splash"
  | "play"
  | "leaderboard"
  | "stats"
  | "win"
  | "lose";

export type Guess = {
  word: string;
  timestamp: number;
  similarity: number;
  normalizedSimilarity: number;
  rank: number;
  isHint: boolean;
};

export type Game = {
  number: number;
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
    finalScore?: number | undefined;
    startedPlayingAtMs?: number | undefined;
    solvedAtMs?: number | undefined;
    totalGuesses?: number | undefined;
    gaveUpAtMs?: number | undefined;
    guesses?: Guess[] | undefined;
  };
};

export type GameResponse = Game;

export type UserSettings = {
  sortDirection: "ASC" | "DESC";
  sortType: "SIMILARITY" | "TIMESTAMP";
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
  };

export type BlocksToWebviewMessage =
  // TODO: Just make `GAME_RESPONSE`?
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
    type: "GAME_INIT_RESPONSE";
    payload: GameResponse;
  };

export type DevvitMessage = {
  type: "devvit-message";
  data: { message: BlocksToWebviewMessage };
};
