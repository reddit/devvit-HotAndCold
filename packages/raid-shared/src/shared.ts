export type Page = 'loading' | 'play' | 'win';

export type Guess = {
  word: string;
  timestamp: number;
  similarity: number;
  normalizedSimilarity: number;
  rank: number;
  username?: string;
  snoovatar?: string;
};

export type Game = {
  number: number;
  challengeStatus: 'ACTIVE' | 'COMPLETED';
  userAvailableGuesses: number;
  challengeInfo: {
    // Only send if the challenge is solved
    word?: string | null;
    totalGuesses?: number | null;
    totalUniqueGuesses?: number | null;
    totalPlayers?: number | null;
    startedAtMs: number | null;
    solvedAtMs?: number | null;
    solvingUser?: string | null;
    solvingUserSnoovatar?: string | null;
  };
  challengeUserInfo: {
    startedPlayingAtMs?: number | null;
    guesses?: Guess[] | undefined;
    username: string;
  };
  challengeTopGuesses: Guess[];
};

export type GameResponse = Game;

export type UserSettings = {
  sortDirection: 'ASC' | 'DESC';
  sortType: 'SIMILARITY' | 'TIMESTAMP';
  layout: 'CONDENSED' | 'EXPANDED';
  isUserOptedIntoReminders: boolean;
};

export type WebviewToBlocksMessage =
  | { type: 'GAME_INIT' }
  | {
      type: 'WORD_SUBMITTED';
      value: string;
    }
  | {
      type: 'SHOW_TOAST';
      string: string;
    }
  | {
      type: 'TOGGLE_USER_REMINDER';
      payload: {};
    };

export type FeedbackResponse = {
  feedback: string;
  action?: {
    message: string;
    type: 'NONE';
  };
};

export type BlocksToWebviewMessage =
  | {
      type: 'INIT';
      payload: GameResponse;
    }
  | {
      type: 'GAME_INIT_RESPONSE';
      payload: GameResponse;
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
      type: 'FAUCET_REPLENISH';
      payload: {
        availableGuesses: number;
      };
    }
  | {
      type: 'FEEDBACK';
      payload: FeedbackResponse;
    }
  | {
      type: 'NEW_GUESS_FROM_GUESS_STREAM';
      payload: {
        guess: Guess;
      };
    }
  | {
      type: 'NEW_PLAYER_COUNT';
      payload: {
        playerCount: number;
      };
    }
  | {
      type: 'RAID_SOLVED';
      payload: {
        challengeInfo: Game['challengeInfo'];
      };
    };

export type DevvitMessage = {
  type: 'devvit-message';
  data: { message: BlocksToWebviewMessage };
};
