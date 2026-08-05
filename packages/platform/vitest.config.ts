import { defineConfig } from 'vitest/config'

/**
 * platform package vitest config.
 * - L1: pure logic (base-path resolver, registry loader + license gate).
 * No wasm/UI here, so a plain node environment suffices.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
})
