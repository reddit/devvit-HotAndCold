import { defineConfig } from 'vitest/config';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwind()],
  optimizeDeps: {
    include: ['preact', 'preact/jsx-dev-runtime', 'preact/test-utils'],
  },
  test: {
    css: true,
    browser: {
      enabled: true,
      provider: 'playwright',
      headless: true,
      instances: [{ browser: 'chromium' }],
    },
    setupFiles: ['./test-setup.ts'],
  },
});
