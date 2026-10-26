import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwind from '@tailwindcss/vite';
import { devvit } from '@devvit/start/vite';
import { readFileSync } from 'node:fs';

export default defineConfig({
  resolve: {
    alias: [
      // Devvit analytics imports both builds. Share its no-external build so we
      // don't ship a second PostHog instance or allow external script loading.
      { find: /^posthog-js$/, replacement: 'posthog-js/dist/module.no-external' },
    ],
  },
  plugins: [
    {
      name: 'inline-loading-splash-styles',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          // The first loading frame must stay centered before external CSS arrives.
          return html.replace(
            '<link rel="stylesheet" href="./shared/loadingSplash.css" />',
            () =>
              `<style data-loading-splash>${readFileSync(new URL('./src/client/shared/loadingSplash.css', import.meta.url), 'utf8')}</style>`
          );
        },
      },
    },
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
