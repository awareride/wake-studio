/**
 * Reachability probe for registry model URLs (ADR-011).
 *
 * HEAD-requests a model URL to report size/availability before the app
 * commits to a full download. Moved from `apps/web/src/data/probe.ts` (§6.1).
 *
 * The `idle`/`probing` states are the UI's local probe-run lifecycle
 * (`ModelLibraryView`'s ProbeButton); the probe function itself only returns
 * `ok | error`.
 */

export type ProbeState = 'idle' | 'probing' | 'ok' | 'error'

export interface ProbeResult {
  state: ProbeState
  status?: number
  /** Present on ok; null while idle/probing (the UI's local lifecycle). */
  sizeBytes?: number | null
  error?: string
}

/** HEAD a model URL; report state, HTTP status and content-length. */
export async function probeModelUrl(url: string): Promise<ProbeResult> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    if (!res.ok) {
      return { state: 'error', status: res.status }
    }
    const len = res.headers.get('content-length')
    return {
      state: 'ok',
      status: res.status,
      sizeBytes: len !== null ? Number(len) : undefined,
    }
  } catch (err) {
    return { state: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}
