export type ClientConfig = {
  POSTHOG_KEY: string;
};

/**
 * Bootstraps a client config for a given environment.
 *
 * DO NOT PUT SERVER SECRETS HERE.
 */
export const makeClientConfig = (isProd: boolean) => {
  return isProd
    ? {
        POSTHOG_KEY: 'phc_zA6oWzORb5vsuSlHdZgKIDWJRb7MYHKgbSBuZdaTxHO',
      }
    : {
        POSTHOG_KEY: 'phc_RykFR129TMVpFBYWTL94g2jIBWAzru3C6vbH356TjxW',
      };
};
