import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Module layers (see AGENTS.md). Lower layers never import higher ones.
const coreModules =
  'src/{geo,schema,network,editor,routing,demand,sim,importers,project,fixtures}/**/*.ts';
const deterministicModules = 'src/{sim,routing,demand,editor,network}/**/*.ts';
const uiLibraries = ['react', 'react-dom', 'react/*', 'react-dom/*', 'zustand', 'zustand/*'];

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser } },
  },
  {
    files: [coreModules],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [...uiLibraries, 'pixi.js', 'pixi.js/*'],
              message: 'Core modules stay free of UI and renderer dependencies.',
            },
            {
              regex: '(^|/)(render|ui|host)(/|$)',
              message: 'Core modules must not depend on render, ui or host.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [deterministicModules],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded RNG (src/geo/random.ts).' },
        { object: 'Date', property: 'now', message: 'Simulation code uses simulation time only.' },
        {
          object: 'performance',
          property: 'now',
          message: 'Simulation code uses simulation time only.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"]',
          message: 'Simulation code uses simulation time only.',
        },
      ],
    },
  },
  {
    files: ['src/render/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: uiLibraries, message: 'The renderer does not depend on React or the store.' },
            { regex: '(^|/)ui(/|$)', message: 'The renderer must not depend on ui.' },
          ],
        },
      ],
    },
  },
]);
