import { defineConfig } from 'vitest/config'

/**
 * Vitest configuration. Runs unit tests in Node (no browser needed for pure
 * DSP functions). The worklet + RNNoise WASM require a browser environment and
 * are tested via Playwright e2e (see playwright.config.ts fake-media options).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
})
