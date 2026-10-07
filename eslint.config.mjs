import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.expo/**', '**/*.generated.ts', 'fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.es2022 } } },
  { files: ['apps/mobile/**'], languageOptions: { globals: { ...globals.browser, __DEV__: 'readonly', jest: 'readonly', describe: 'readonly', it: 'readonly', expect: 'readonly', beforeEach: 'readonly', afterEach: 'readonly' } } },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      // Nutrient values are decimal strings; a stray `+` or `Number()` on one is
      // exactly the bug the engine exists to prevent.
      'no-restricted-globals': ['error', { name: 'parseFloat', message: 'Use dec()/num() from @nt/core for nutrient values.' }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['apps/mobile/**/*.tsx', 'apps/mobile/**/*.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
  {
    // Metro config is CommonJS, Jest mocks are require-based, and Metro asset
    // resolution (`require('…/catalog.sqlite')`) only works through require.
    files: ['**/*.mjs', '**/scripts/**', '**/metro.config.js', '**/jest.setup.ts', '**/__mocks__/**', 'apps/mobile/src/db/provider.tsx'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
