import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** rnnoise module eslint config (flat, ESLint 9). */
export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'assets', 'web/vendor', 'node'] },
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
