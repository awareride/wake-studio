/**
 * Managed training backends (Backends menu).
 *
 * A backend is a studio-backend endpoint the user manages: long-term (their
 * own server / `uv run wake-service`) or short-term (an ephemeral Colab
 * runtime behind a trycloudflare tunnel). The training wizard's
 * Studio-backend method picks one of these (replacing the old single
 * Settings `backend.endpoint`).
 */

export type ManagedBackendKind = 'long-term' | 'short-term'

export type ManagedBackendStatus = 'unknown' | 'checking' | 'online' | 'offline'

export interface ManagedBackend {
  /** Stable id (uuid). */
  id: string
  /** User label, e.g. "My server" / "Colab T4 #2". */
  name: string
  /** Base URL: http://127.0.0.1:4824 or https://xxx.trycloudflare.com */
  baseUrl: string
  /** Token for mutating endpoints (ADR-036 §5); stored locally only. */
  token?: string
  /** long-term = persistent; short-term = ephemeral (Colab runtime). */
  kind: ManagedBackendKind
  /** Last health-check result (unknown until first check). */
  status: ManagedBackendStatus
  /** When the backend last answered /health (ms). */
  lastSeenMs?: number
  createdAtMs: number
}
