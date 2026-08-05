import { defineConfig } from 'vitest/config'

/**
 * RNNoise module vitest config (ADR-026).
 *   - L1: pure DSP (tests/dsp.test.ts)
 *   - L2: wasm runtime in Node (tests/wasm-runtime.test.ts) - the vendored
 *     emscripten glue supports ENVIRONMENT_IS_NODE, so the same artifact that
 *     boots in the browser boots here, in seconds.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
