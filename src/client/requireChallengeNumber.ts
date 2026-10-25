import { context } from '@devvit/web/client';
import { getActiveTestRun } from './playtest/run';

export function requireChallengeNumber(): number {
  const challengeNumber = getActiveTestRun()?.challengeNumber ?? context.postData?.challengeNumber;
  if (!challengeNumber) {
    throw new Error('No challenge number');
  }
  return Number(challengeNumber);
}
