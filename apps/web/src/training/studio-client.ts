/**
 * Studio-backend client (issue #122, ADR-036).
 *
 * Talks to the Python job-manager API (docs/modules/training.md §3):
 *   POST /jobs (create+enqueue) · GET /jobs/{id} · lifecycle actions ·
 *   GET /jobs/{id}/logs · GET /artifacts/{job_id}/{name} · GET /stream (SSE)
 *
 * One client serves BOTH the self-hosted studio-backend (Settings
 * `backend.endpoint`) and the Colab tunnel (the notebook exposes the same
 * contract — ADR-023 amendment, "one HTTP client, N backends"). Read
 * endpoints are open; mutating endpoints carry the Settings token
 * (`backend.apiKey` / `backend.secret`) as Bearer when set (ADR-036 §5).
 */

import type { TrainingJob } from '@wake-studio/module-training'

/** Wire shape of a backend job (camelCase, docs/modules/training.md §3). */
export interface StudioJob {
  id: string
  moduleId: string
  params: Record<string, string>
  status: TrainingJob['status']
  progress: number | null
  metrics: Record<string, number>
  logTail: string[]
  error: string | null
  exitCode: number | null
  createdAtMs: number
  updatedAtMs: number
  startedAtMs: number | null
  finishedAtMs: number | null
  pid: number | null
  checkpoint: string | null
  artifacts: string[]
}

export type StudioJobPatch = {
  status: StudioJob['status']
  progress?: number
  metrics?: Record<string, number>
  error?: string
  exitCode?: number
  finishedAtMs?: number
  checkpoint?: string
  logTail?: string[]
}

export class StudioClientError extends Error {
  readonly status: number
  readonly body: unknown
  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.name = 'StudioClientError'
    this.status = status
    this.body = body
  }
}

export interface StudioClient {
  readonly baseUrl: string
  createJob(
    moduleId: string,
    params: Record<string, string>,
    id?: string,
  ): Promise<StudioJob>
  getJob(id: string): Promise<StudioJob>
  listJobs(): Promise<StudioJob[]>
  startJob(id: string): Promise<StudioJob>
  pauseJob(id: string): Promise<StudioJob>
  resumeJob(id: string): Promise<StudioJob>
  cancelJob(id: string): Promise<StudioJob>
  deleteJob(id: string): Promise<void>
  getLogs(id: string): Promise<string[]>
  artifactUrl(jobId: string, name: string): string
  /** Subscribe to a job's live updates: SSE when available, polling fallback.
   *  onMode reports which transport is active. */
  subscribe(
    id: string,
    onJob: (job: StudioJob) => void,
    onMode?: (mode: 'sse' | 'polling') => void,
  ): () => void
}

export function createStudioClient(baseUrl: string, token?: string): StudioClient {
  const normalized = baseUrl.trim().replace(/\/+$/, '')

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    let res: Response
    try {
      res = await fetch(`${normalized}${path}`, {
        ...init,
        headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
      })
    } catch (err) {
      throw new StudioClientError(
        `Cannot reach the studio-backend at ${normalized} — is it running? ` +
          `(local: \`uv run wake-service\`; Colab: paste the notebook's tunnel URL)`,
        0,
        err,
      )
    }
    if (!res.ok) {
      let body: unknown
      try {
        body = await res.json()
      } catch {
        body = await res.text().catch(() => null)
      }
      throw new StudioClientError(
        `studio-backend request failed (${res.status})`,
        res.status,
        body,
      )
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  function mutate(id: string, action: 'start' | 'pause' | 'resume' | 'cancel') {
    return request<StudioJob>(`/jobs/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
    })
  }

  return {
    baseUrl: normalized,
    createJob(moduleId, params, id) {
      return request<StudioJob>('/jobs', {
        method: 'POST',
        body: JSON.stringify({ moduleId, params, ...(id ? { id } : {}) }),
      })
    },
    getJob: (id) => request<StudioJob>(`/jobs/${encodeURIComponent(id)}`),
    listJobs: () =>
      request<{ jobs: StudioJob[] }>('/jobs').then((r) => r.jobs),
    startJob: (id) => mutate(id, 'start'),
    pauseJob: (id) => mutate(id, 'pause'),
    resumeJob: (id) => mutate(id, 'resume'),
    cancelJob: (id) => mutate(id, 'cancel'),
    async deleteJob(id) {
      await request<void>(`/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },
    async getLogs(id) {
      const res = await request<{ lines: string[] }>(`/jobs/${encodeURIComponent(id)}/logs`)
      return res.lines
    },
    artifactUrl(jobId, name) {
      return `${normalized}/artifacts/${encodeURIComponent(jobId)}/${encodeURIComponent(name)}`
    },
    subscribe(id, onJob, onMode) {
      const jobPath = `/jobs/${encodeURIComponent(id)}`
      let cancelled = false
      let es: EventSource | null = null
      let pollTimer: ReturnType<typeof setInterval> | null = null
      let received = false
      let fallbackFired = false

      const stopSSE = () => {
        if (es) {
          es.close()
          es = null
        }
      }
      const startPolling = () => {
        if (cancelled || pollTimer || fallbackFired) return
        fallbackFired = true
        stopSSE()
        onMode?.('polling')
        const poll = () => {
          if (cancelled) return
          request<StudioJob>(jobPath)
            .then((job) => {
              received = true
              onJob(job)
            })
            .catch(() => {
              /* endpoint unreachable - keep polling, UI shows last state */
            })
        }
        void poll()
        pollTimer = setInterval(poll, 2000)
      }

      if (typeof EventSource !== 'undefined') {
        es = new EventSource(`${normalized}/stream`)
        es.addEventListener('job', (ev) => {
          if (cancelled) return
          received = true
          onMode?.('sse')
          try {
            onJob(JSON.parse((ev as MessageEvent).data) as StudioJob)
          } catch {
            /* malformed event - ignore */
          }
        })
        // EventSource auto-reconnects on failure; if we never got an event
        // (tunnel/network issue), fall back to plain polling.
        es.onerror = () => {
          if (!received) startPolling()
        }
        window.setTimeout(() => {
          if (!received && !fallbackFired) startPolling()
        }, 6000)
      } else {
        startPolling()
      }

      return () => {
        cancelled = true
        stopSSE()
        if (pollTimer) clearInterval(pollTimer)
      }
    },
  }
}

/** Map a live backend job onto a HistoryJob patch (issue #122). */
export function studioJobPatch(job: StudioJob): StudioJobPatch {
  return {
    status: job.status,
    progress: job.progress ?? undefined,
    metrics: job.metrics,
    error: job.error ?? undefined,
    exitCode: job.exitCode ?? undefined,
    finishedAtMs: job.finishedAtMs ?? undefined,
    checkpoint: job.checkpoint ?? undefined,
    logTail: job.logTail,
  }
}
