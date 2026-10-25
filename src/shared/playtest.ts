export const DEFAULT_TEST_WORD = 'apple';
export const PLAYTEST_CHALLENGE_BASE = 1_000_000_000;
export const PLAYTEST_RUN_TTL_SECONDS = 3 * 24 * 60 * 60;

// Devvit adds a fourth version component for playtest builds and removes it
// when uploading a release. Fail closed when the request context is missing.
export function isPlaytestContext(value: { appVersion?: string; subredditName?: string }) {
  return (
    /^\d+\.\d+\.\d+\.\d+$/.test(value.appVersion ?? '') &&
    Boolean(value.subredditName) &&
    value.subredditName?.toLowerCase() !== 'hotandcold'
  );
}

export function isTestChallengeNumber(number: number) {
  return Number.isSafeInteger(number) && number >= PLAYTEST_CHALLENGE_BASE;
}

export type TestRun = {
  challengeNumber: number;
  word: string;
  postUrl: string;
};
