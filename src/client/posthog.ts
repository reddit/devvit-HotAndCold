import { createDevvitPosthog } from '@devvit/analytics/client/posthog';
import { context } from '@devvit/web/client';
import { experiments } from '../shared/experiments/experiments';
import { hash } from '../shared/hash';
import { CONFIG, IS_PROD } from './config';
import { beforeSend } from '../shared/posthogUtils';

export const posthog = createDevvitPosthog(CONFIG.POSTHOG_KEY, {
  sample_rate: IS_PROD ? 0.05 : 1,
  before_send: beforeSend,
});

let initialized = false;

export const configurePosthog = ({ mode }: { mode: 'classic' | 'horde' }) => {
  if (initialized) {
    return;
  }
  initialized = true;

  const allExperiments = context.userId ? experiments.evaluateAll(context.userId) : null;

  posthog.register({
    mode,
    challenge_number: context.postData?.challengeNumber ?? null,
    post_id: context.postId ?? null,
    app_version: context.appVersion ?? null,
    app_name: context.appName ?? null,
    // Just attach all experiments as properties and we'll figure it out on posthog
    ...Object.fromEntries(
      Object.entries(allExperiments ?? []).map(([key, value]) => [key, value.treatment])
    ),
  });

  const identify = async () => {
    if (context.userId && !posthog._isIdentified()) {
      // Make sure to use this hash function instead of the one from @devvit/analytics/client/posthog
      // because it is slightly different and the hash function we're using here is the original
      // one from before the other package existed. Otherwise, the temporal integrity of the
      // user will be broken and causes lots of tracking issues.
      const hashed = await hash(context.userId);
      // Identify sends an event, so you may want to limit how often you call it
      posthog.identify(hashed);
    }
  };

  void identify();
};
