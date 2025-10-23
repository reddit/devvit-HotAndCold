import { RedisAPIDefinition } from '@devvit/protos';
import type { Config } from '@devvit/shared-types/Config.js';

// Minimal global devvit config with pushnotif and redis plugins mocked via devvitTest harness
// The tests will overwrite config.use() with the mocked Redis API where needed.

const makeConfig = (): Config => {
  return {
    assets: {},
    providedDefinitions: [],
    webviewAssets: {},
    getPermissions: () => [],

    export: () => ({}) as any,
    provides: () => {},
    addPermissions: () => {},

    use<T>(definition: { fullName: string }): T {
      if (definition.fullName === RedisAPIDefinition.fullName) {
        // Placeholder; tests provide a proper mock via devvitTest harness.
        throw new Error('Redis plugin not mocked in setupTests. Use devvitTest harness.');
      }
      // Allow pushnotif lookups; tests will stub pushnotif methods directly
      return {} as T;
    },

    uses(_definition: { fullName: string }): boolean {
      return true;
    },
  };
};

const installGlobalConfig = (config: Config): void => {
  (globalThis as any).devvit ??= {};
  (globalThis as any).devvit.config = config;
  (globalThis as any).devvit.compute ??= { platform: 'test' };
};

// Install a baseline config so constructors relying on getDevvitConfig() don't throw.
const cfg = makeConfig();
installGlobalConfig(cfg);
