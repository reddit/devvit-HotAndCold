import { context } from '@devvit/web/client';

export function requireChallengeNumber(): number {
  const challengeNumber = context.postData?.challengeNumber;
  if (!challengeNumber) {
    throw new Error('No challenge number');
  }
  return Number(challengeNumber);
}
