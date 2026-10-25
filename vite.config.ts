import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwind from '@tailwindcss/vite';
import { devvit } from '@devvit/start/vite';

export default defineConfig({
  resolve: {
    alias: [
      // Devvit analytics imports both builds. Share its no-external build so we
      // don't ship a second PostHog instance or allow external script loading.
      { find: /^posthog-js$/, replacement: 'posthog-js/dist/module.no-external' },
    ],
  },
  plugins: [
    preact(),
    tailwind(),
    devvit({
      client: {
        build: {
          rollupOptions: {
            output: {
              // Entrypoints and lazy chunks can share a basename. Keep their maps distinct.
              sourcemapFileNames: '[name]-[hash].js.map',
            },
          },
        },
      },
    }),
  ],
});
