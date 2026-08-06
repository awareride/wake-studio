import { defineConfig } from 'vitest/config'

/**
 * AFE graph module vitest config (ADR-026).
 *
 * DSP logic lives in @wake-studio/dsp (conformance + behavior tests there);
 * the graph module itself owns scheduling, which is browser-e2e tested
 * (L3). No L1 unit tests remain here, so passWithNoTests is enabled.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
  },
})
