import posthog from 'posthog-js';

import { CONFIG, IS_PROD } from '../config';
import { beforeSend } from '../../shared/posthogUtils';
import { context } from '@devvit/web/client';
import { hash } from '../../shared/hash';
import { experiments } from '../../shared/experiments/experiments';

let initialized = false;

export const initPosthog = ({ mode }: { mode: 'classic' | 'horde' }) => {
  if (initialized) {
    console.warn('Posthog already initialized');
    return;
  }
  initialized = true;

  posthog.init(CONFIG.POSTHOG_KEY, {
    api_host: window.location.origin + '/api/collect',
    defaults: '2025-05-24',
    capture_exceptions: true,
    disable_surveys: true,
    autocapture: false,
    disable_session_recording: true,
    enable_heatmaps: false,
    capture_heatmaps: false,
    disable_persistence: true,
    capture_performance: false,
    before_send: beforeSend(IS_PROD),
  });

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
    if (context.userId) {
      const hashed = await hash(context.userId);
      // Identify sends an event, so you may want to limit how often you call it
      posthog.identify(hashed);
      console.log('DEBUG: user', JSON.stringify({ hashed, userId: context.userId }, null, 2));
    }
  };

  void identify();
};
