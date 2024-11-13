export type Page =
    | "splash"
    | "play"
    | "leaderboard"
    | "stats"
    | "win"
    | "lose";

export type PostMessageEvent = { type: "NAVIGATE"; value: Page } | {
    type: "WORD_SUBMITTED";
    value: string;
};
