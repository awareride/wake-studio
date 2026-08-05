/**
 * test-kit - L2 wasm-runtime helpers (ADR-026).
 *
 * Provides a small harness for loading emscripten/onnx artifacts in Node and
 * asserting they boot + produce output. Module L2 tests use these helpers so
 * the "artifact boots" gate is uniform across modules.
 */

/** Assert a function resolves without throwing; returns the value. */
export async function expectResolves<T>(p: Promise<T> | T, label: string): Promise<T> {
  try {
    return await p
  } catch (err) {
    throw new Error(`L2 boot check failed (${label}): ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Simple numeric range assertion for VAD/probability outputs. */
export function assertInRange(value: number, min: number, max: number, label: string): void {
  if (value < min || value > max) {
    throw new Error(`L2 range check failed (${label}): ${value} not in [${min}, ${max}]`)
  }
}

/** Detect the Node environment (useful for L2-only test guards). */
export function isNode(): boolean {
  return typeof process !== 'undefined' && !!process.versions?.node
}
