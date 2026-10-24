import { defineConfig } from 'vitest/config';

export default defineConfig({
  optimizeDeps: {
    include: ['preact', 'preact/jsx-dev-runtime', 'preact/test-utils'],
  },
  test: {
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
    setupFiles: ['./test-setup.ts'],
  },
});
