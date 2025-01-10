import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  root: path.join(__dirname), // Point to your app directory
  build: {
    outDir: path.join(__dirname, '../../', 'webroot'), // Specify your desired output directory
    emptyOutDir: true, // Clean the output directory before each build
    copyPublicDir: true, // Copies over assets
    sourcemap: true, // Enable sourcemaps
  },
});
