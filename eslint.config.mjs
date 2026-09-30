// Lint for the whole monorepo, run once from the root (`pnpm lint`). Deliberately minimal: the recommended
// JS + TypeScript rules, no type-aware rules (tsc already runs via `pnpm typecheck`), plus the two classic
// React hooks rules for the desktop app.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next*/**',
      '**/.turbo/**',
      '**/coverage/**',
      '.local/**',
      'storage/**',
      'apps/desktop/src-tauri/**',
      // Out of scope this phase — left exactly as they are.
      'apps/tracker/**',
      'apps/mobile/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `const { a: _a, ...rest } = obj` is how the code drops keys; `_`-prefixed names are intentionally unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // French number formatting puts a no-break space inside template/string literals on purpose.
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true }],
    },
  },
  {
    // Plain JS files run under Node (scripts, jest configs).
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.cjs', 'apps/server/jest.*.config.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
  {
    // The UI smoke test also runs callbacks inside the browser page (page.evaluate).
    files: ['scripts/ui-smoke/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
