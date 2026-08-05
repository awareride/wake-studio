import { defineConfig } from 'vitest/config'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * module-kit vitest config.
 * - L1: spec validator + panel generator (tests/*.test.{ts,tsx})
 * - jsx-runtime needs react resolvable; alias to the workspace react.
 */
export default defineConfig({
  resolve: {
    alias: {
      react: resolve(here, 'node_modules/react'),
      'react-dom': resolve(here, 'node_modules/react-dom'),
      'react/jsx-runtime': resolve(here, 'node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': resolve(here, 'node_modules/react/jsx-dev-runtime.js'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
  },
})
