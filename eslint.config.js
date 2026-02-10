import { defineConfig } from 'eslint/config';
import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import drizzle from 'eslint-plugin-drizzle';
import { enforceInstallationId } from './tools/eslint-rules/enforce-installation-id.js';

const localDrizzle = {
  rules: {
    'enforce-installation-id': enforceInstallationId,
  },
};

export default defineConfig([
  tseslint.configs.recommended,
  { ignores: ['webroot'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/devvit/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['tools/**/*.{ts,tsx,mjs,cjs,js}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/server/**/*.{ts,tsx,mjs,cjs,js}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
    },
    plugins: { drizzle, 'local-drizzle': localDrizzle },
    rules: {
      'drizzle/enforce-delete-with-where': [
        'error',
        { drizzleObjectName: ['db'] },
      ],
      'drizzle/enforce-update-with-where': [
        'error',
        { drizzleObjectName: ['db'] },
      ],
      'local-drizzle/enforce-installation-id': [
        'error',
        { drizzleObjectName: ['db'], columnName: 'installationId' },
      ],
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/shared/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      // Shared code can run in both browser and node contexts
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/client/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {},
    rules: {
      'no-irregular-whitespace': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['off'],
      '@typescript-eslint/no-explicit-any': ['off'],
      '@typescript-eslint/no-namespace': ['off'],
      'no-unused-vars': ['off'],
    },
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      'eslint.config.js',
      '**/vite.config.ts',
      '**/drizzle.config.ts',
      'devvit.config.ts',
    ],
    languageOptions: {
      parserOptions: {
        project: [
          './tsconfig.json',
          './src/*/tsconfig.json',
          './src/*/tsconfig.test.json',
          './tools/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { js },
    extends: ['js/recommended'],
  },
]);
