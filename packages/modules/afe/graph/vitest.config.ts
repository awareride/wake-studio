import { defineConfig } from 'vitest/config'

/**
 * AFE graph module vitest config (ADR-026).
 *
 * L1 tests cover the module's own pure logic (defaults/constants/parameter
 * descriptors in tests/defaults.test.ts). DSP numerics are tested in
 * @wake-studio/dsp (conformance + behavior), not here - graph imports them.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
