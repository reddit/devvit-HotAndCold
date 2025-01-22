import { Devvit } from '@devvit/public-api';
import { ChallengeToStatus } from '../core/challengeToStatus.js';
import { processInChunks } from '@hotandcold/shared/utils';
import { ChallengeFaucet } from '../core/challengeFaucet.js';

Devvit.addSchedulerJob({
  name: 'FAUCET_REFRESH_ALL_ACTIVE_CHALLENGES',
  onRun: async (_, context) => {
    const activeChallenges = await ChallengeToStatus.getChallengesByStatus({
      redis: context.redis,
      status: 'ACTIVE',
    });

    await processInChunks({
      items: activeChallenges,
      chunkSize: 25,
      promiseGenerator: async ({ challenge }) => {
        await ChallengeFaucet.replenishFaucet({
          redis: context.redis,
          challenge,
        });
      },
      onError: (error) => {
        console.error(`Error replenishing faucet:`, error);
      },
    });
  },
});
