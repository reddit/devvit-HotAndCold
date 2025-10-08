import { context } from '@devvit/web/client';
import { makeClientConfig, ClientConfig } from '../shared/makeClientConfig';

export const IS_PROD = context.subredditName === 'hotandcold';

console.log('IS_PROD:', IS_PROD);

export const CONFIG: ClientConfig = makeClientConfig(IS_PROD);

// Controls how frequently we sample guess events to PostHog
export const GUESS_SAMPLE_RATE = 10;
