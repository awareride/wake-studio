import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * test-kit package eslint config (flat, ESLint 9).
 * L2 wasm-runner helpers; Node environment.
 */
export default tseslint.config(
  { ignores: ['node_modules', 'dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
)
