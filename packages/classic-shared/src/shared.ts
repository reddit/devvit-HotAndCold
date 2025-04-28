export type Page = 'loading' | 'play' | 'stats' | 'win' | 'unlock-hardcore';

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
  mode: GameMode;
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
  sortDirection: 'ASC' | 'DESC';
  sortType: 'SIMILARITY' | 'TIMESTAMP';
  layout: 'CONDENSED' | 'EXPANDED';
  isUserOptedIntoReminders: boolean;
};

export type ChallengeLeaderboardResponse = {
  // TODO: Community streak to see if the entire community can keep a solve per day going?
  userRank: {
    score: number;
    timeToSolve: number;
  };
  leaderboardByScore: { member: string; score: number }[];
  leaderboardByFastest: { member: string; score: number }[];
};

export type HardcoreAccessStatus =
  | {
      status: 'active';
      expires?: number; // If no expiration, the player has lifetime access
    }
  | { status: 'inactive' };

export type WebviewToBlocksMessage =
  | { type: 'GAME_INIT' }
  | {
      type: 'WORD_SUBMITTED';
      value: string;
    }
  | { type: 'HINT_REQUEST' }
  | { type: 'GIVE_UP_REQUEST' }
  | {
      type: 'SHOW_TOAST';
      string: string;
    }
  | { type: 'LEADERBOARD_FOR_CHALLENGE' }
  | {
      type: 'TOGGLE_USER_REMINDER';
    }
  | {
      type: 'NAVIGATE_TO_LATEST_HARDCORE';
    }
  | {
      type: 'PURCHASE_PRODUCT';
      payload: {
        sku: string;
      };
    };

export type FeedbackResponse = {
  feedback: string;
  action?: {
    message: string;
    type: 'HINT' | 'GIVE_UP' | 'NONE';
  };
};

export type BlocksToWebviewMessage =
  // TODO: Just make `GAME_RESPONSE`?
  | {
      type: 'INIT';
      payload: GameResponse;
    }
  | {
      type: 'GAME_INIT_RESPONSE';
      payload: GameResponse;
    }
  | {
      type: 'HARDCORE_ACCESS_INIT_RESPONSE';
      payload: {
        hardcoreAccessStatus?: HardcoreAccessStatus;
      };
    }
  | {
      type: 'TOGGLE_USER_REMINDER_RESPONSE';
      payload: {
        isUserOptedIntoReminders: boolean;
      };
    }
  | {
      type: 'WORD_SUBMITTED_RESPONSE';
      payload: GameResponse;
    }
  | {
      type: 'HINT_RESPONSE';
      payload: GameResponse;
    }
  | {
      type: 'GIVE_UP_RESPONSE';
      payload: GameResponse;
    }
  | {
      type: 'PLAYER_PROGRESS_UPDATE';
      payload: { challengeProgress: GameResponse['challengeProgress'] };
    }
  | {
      type: 'CHALLENGE_LEADERBOARD_RESPONSE';
      payload: ChallengeLeaderboardResponse;
    }
  | {
      type: 'FEEDBACK';
      payload: FeedbackResponse;
    }
  | {
      type: 'PURCHASE_PRODUCT_SUCCESS_RESPONSE';
      payload: {
        access: HardcoreAccessStatus;
      };
    };

export type DevvitMessage = {
  type: 'devvit-message';
  data: { message: BlocksToWebviewMessage };
};

export type GameMode = 'regular' | 'hardcore';
