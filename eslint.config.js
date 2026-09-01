import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Deliberately small. The type checker already catches most of what a linter
 * would, and rules nobody agrees with get disabled inline until they mean
 * nothing. These are the ones that catch real defects in this codebase.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'docs/openapi.json',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: false },
      globals: { console: 'readonly', process: 'readonly', Buffer: 'readonly', fetch: 'readonly' },
    },
    rules: {
      // An unused variable is usually a half-finished edit.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // `any` erases exactly the guarantees this product relies on. Warn rather
      // than error where third-party shapes genuinely are unknown.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Swallowing an error silently is how a deletion "succeeds" without
      // deleting anything.
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-console': 'off',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Scripts and tests legitimately log and use loose shapes.
    files: ['**/test/**', '**/tests/**', '**/evals/**', '**/cli/**', '**/*.config.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
