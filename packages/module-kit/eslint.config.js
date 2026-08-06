import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * module-kit package eslint config (flat, ESLint 9).
 * Has JSX/React (panel generator + Ui controls); vitest runs in Node, so
 * both browser and node globals are needed.
 */
export default tseslint.config(
  { ignores: ['node_modules', 'dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
)
