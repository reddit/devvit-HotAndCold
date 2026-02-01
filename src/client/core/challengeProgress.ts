import { trpc } from '../trpc';

export type PlayerProgress = {
  username: string;
  progress: number;
  isPlayer: boolean;
  avatar?: string;
};

/**
 * Fetches the nearest players around the current user by start-time for a given challenge.
 * Window sizes control how many before/after the user to include. Defaults to 10 on each side.
 */
export async function getNearestPlayersByStartTime(params: {
  challengeNumber: number;
  windowBefore?: number;
  windowAfter?: number;
}): Promise<PlayerProgress[]> {
  const { challengeNumber, windowBefore = 10, windowAfter = 10 } = params;
  const neighbors = await trpc.progress.nearestByStartTime.query({
    challengeNumber,
    windowBefore,
    windowAfter,
  });

  // Map server response → PlayerProgress expected by UI
  // Avatars can be enriched later; default to local placeholder
  return neighbors.map((n) => ({
    username: n.username,
    progress: n.progress,
    isPlayer: n.isPlayer,
    avatar: n.avatar ?? '/assets/default_snoovatar.png',
  }));
}
