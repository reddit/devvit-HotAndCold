import { vi } from 'vitest';

export const setupTests = () => {
  // Mock config to avoid Reddit context issues during tests
  vi.mock('./config', () => ({
    CONFIG: {
      POSTHOG_KEY: 'test_key',
      GAME_MODE: 'classic',
    },
    IS_PROD: false,
  }));

  // Mock posthog to avoid initialization side effects
  vi.mock('./posthog', () => ({
    posthog: {
      capture: vi.fn(),
      init: vi.fn(),
      identify: vi.fn(),
      reset: vi.fn(),
      register: vi.fn(),
      people: {
        set: vi.fn(),
      },
      _isIdentified: vi.fn().mockReturnValue(true),
      captureException: vi.fn(),
      setPersonProperties: vi.fn(),
    },
    initPosthog: vi.fn(),
    configurePosthog: vi.fn(),
  }));
};

setupTests();
