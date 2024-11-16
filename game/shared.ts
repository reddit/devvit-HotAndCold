export type Page =
  | "splash"
  | "play"
  | "leaderboard"
  | "stats"
  | "win"
  | "lose";

export type WebviewToBlockMessage = {
  type: "WORD_SUBMITTED";
  value: string;
} | {
  type: "SHOW_TOAST";
  string: string;
};

export type BlocksToWebviewMessage =
  | {
    type: "WORD_SUBMITTED_RESPONSE";
    payload: {
      word: string;
      success: true;
      hasSolved: boolean;
      finalScore?: number;
      similarity: number;
    };
  }
  | {
    type: "WORD_SUBMITTED_RESPONSE";
    payload: {
      success: false;
      error: string;
    };
  }
  | { type: "UI"; payload: { modal: string } };

export type DevvitMessage = {
  type: "devvit-message";
  data: { message: BlocksToWebviewMessage };
};
