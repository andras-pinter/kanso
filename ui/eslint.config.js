import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import noUnstableZustandSelector from './eslint-rules/no-unstable-zustand-selector.js';

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'coverage', 'eslint-rules/__tests__']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'kanso/no-unstable-zustand-selector': 'error',
    },
    plugins: {
      kanso: { rules: { 'no-unstable-zustand-selector': noUnstableZustandSelector } },
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      // tests sometimes need throw-aways
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
]);
