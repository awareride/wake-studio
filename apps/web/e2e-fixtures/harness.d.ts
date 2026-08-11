/**
 * Ambient types shared by the e2e harness page and the specs that drive it.
 *
 * The harness (`e2e-fixtures/kws-streaming-harness.ts`) attaches helpers to
 * `window` so Playwright can exercise the real driver; both sides need the same
 * declaration, so it lives here rather than inside either file.
 */

export interface KwsHarnessDriveResult {
  /** EP the driver actually created the session with. */
  reportedEp: string | null
  /** First non-null score from processFrame, or null if none ever came. */
  score: number | null
  /** How many 10 ms frames were needed before a score appeared. */
  framesToScore: number | null
  /** Number of labels in the loaded manifest. */
  labelCount: number | null
  error?: string
}

declare global {
  interface Window {
    kwsHarness: {
      driveBackend: (
        name: string,
        requestedEp?: 'webgpu' | 'wasm',
      ) => Promise<KwsHarnessDriveResult>
    }
  }
}
