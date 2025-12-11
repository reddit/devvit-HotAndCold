import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['src/*'],
    reporters: ['dot'],
    setupFiles: [],
    coverage: {
      enabled: true,
      provider: 'v8',
      all: true,
      reporter: ['text-summary', 'html'],
    },
  },
});
