import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwind from '@tailwindcss/vite';
import { devvit } from '@devvit/start/vite';

export default defineConfig({
  plugins: [preact(), tailwind(), devvit()],
});
