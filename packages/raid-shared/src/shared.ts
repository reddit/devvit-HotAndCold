export type Page = 'loading' | 'play' | 'win';

export type Guess = {
  word: string;
  timestamp: number;
  similarity: number;
  normalizedSimilarity: number;
  rank: number;
};

export type Game = {
  number: number;
  challengeStatus: 'ACTIVE' | 'COMPLETED';
  userAvailableGuesses: number;
  challengeInfo: {
    // DO NOT SEND THE WORD HERE!
    // THAT WOULD BE SILLY
    totalGuesses?: number | null;
    totalUniqueGuesses?: number | null;
    totalPlayers?: number | null;
    startedAtMs: number | null;
    solvedAtMs?: number | null;
  };
  challengeUserInfo: {
    startedPlayingAtMs?: number | null;
    guesses?: Guess[] | undefined;
    username: string;
  };
  challengeTopGuesses: {
    username: string;
    guess: Guess;
  }[];
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
    };

export type DevvitMessage = {
  type: 'devvit-message';
  data: { message: BlocksToWebviewMessage };
};
