import { localStorageSignal } from '../../utils/localStorageSignal';
import { requireChallengeNumber } from '../../requireChallengeNumber';

export type PageName = 'play' | 'win';

export const page = localStorageSignal<PageName>({
  key: `nav-page:${String(requireChallengeNumber())}`,
  storage: localStorage,
  initialValue: () => {
    const challengeNumber = requireChallengeNumber();
    try {
      const solved =
        typeof window !== 'undefined'
          ? window.sessionStorage.getItem(storageKeySolved(challengeNumber))
          : null;
      if (solved && Number.isFinite(Number(solved))) {
        return 'win';
      }
    } catch {
      // ignore
    }
    return 'play';
  },
});

function getChallengeNumber(): number {
  return requireChallengeNumber();
}

function storageKeySolved(challengeNumber: number): string {
  return `guess-solvedAt:${String(challengeNumber)}`;
}

/**
 * Initialize navigation for the current challenge.
 * - Defaults to 'win' when local cache indicates the user already solved
 * - Otherwise defaults to 'play'
 * - Never blocks initial render
 */
// Navigation is now initialized via the signal's initialValue above
export function initNavigation(): void {}

export function navigate(next: PageName): void {
  page.value = next;
}

export function markSolvedForCurrentChallenge(atMs: number): void {
  try {
    const challengeNumber = getChallengeNumber();
    window.sessionStorage.setItem(storageKeySolved(challengeNumber), String(atMs));
    // Default navigation to win page when solved
    page.value = 'win';
  } catch {
    // ignore
  }
}
