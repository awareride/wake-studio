/**
 * Model reachability probe.
 *
 * HEADs a model URL (resolved against the deploy base) to report reachable /
 * actual content length. Used by the Model Library "Verify" action. Never
 * downloads the body.
 */

import { resolveAsset } from '../config'

export type ProbeState = 'idle' | 'probing' | 'ok' | 'error'

export interface ProbeResult {
  state: ProbeState
  /** Actual bytes reported by the server, when known. */
  sizeBytes: number | null
  status?: number
  error?: string
}

export async function probeModelUrl(url: string): Promise<ProbeResult> {
  const target = resolveAsset(url)
  try {
    const res = await fetch(target, { method: 'HEAD', mode: 'cors' })
    if (!res.ok) {
      return {
        state: 'error',
        sizeBytes: null,
        status: res.status,
        error: `HTTP ${res.status}`,
      }
    }
    const len = res.headers.get('content-length')
    return {
      state: 'ok',
      sizeBytes: len ? Number(len) : null,
      status: res.status,
    }
  } catch (err) {
    return {
      state: 'error',
      sizeBytes: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
