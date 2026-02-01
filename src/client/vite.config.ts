import { defineConfig } from 'vite';
import tailwind from '@tailwindcss/vite';
import preact from '@preact/preset-vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [preact(), tailwind()],
  build: {
    outDir: '../../dist/client',
    sourcemap: true,
    rollupOptions: {
      input: {
        classic: 'classic.html',
        horde: 'horde.html',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
        sourcemapFileNames: '[name].js.map',
      },
    },
  },
});
