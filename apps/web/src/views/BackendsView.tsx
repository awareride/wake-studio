/**
 * Backends — managed studio-backend endpoints (training execution targets).
 *
 * Manages the user's studio-backend instances: long-term (their own server,
 * `uv run wake-service`) or short-term (an ephemeral Colab runtime behind a
 * trycloudflare tunnel). The training wizard's Studio-backend method picks
 * one of these (replacing the old single Settings backend endpoint).
 *
 * - Health: each backend is pinged via GET /health on mount + every 30s +
 *   manual refresh; status/lastSeen are stored back.
 * - Detail (read-only): the backend's jobs (GET /jobs) and per-job logs
 *   (GET /jobs/{id}/logs). Actions stay in the train details pane.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, IconButton } from '@radix-ui/themes'
import { useAppSettings } from '../settings'
import { createStudioClient } from '../training/studio-client'
import type { StudioJob } from '../training/studio-client'
import type { ManagedBackend, ManagedBackendKind, ManagedBackendStatus } from '../backends/types'
import { cn } from '../components/cn'

const HEALTH_POLL_MS = 30_000

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `backend-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function formatTime(ms: number | undefined): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleString()
}

const STATUS_STYLE: Record<ManagedBackendStatus, string> = {
  unknown: 'bg-surface-3 text-ink-3',
  checking: 'bg-brand-9/15 text-brand-11',
  online: 'bg-emerald-500/15 text-emerald-700',
  offline: 'bg-danger/15 text-danger',
}

const KIND_STYLE: Record<ManagedBackendKind, string> = {
  'long-term': 'bg-surface-3 text-ink-2',
  'short-term': 'bg-amber-500/15 text-amber-700',
}

interface EditorState {
  mode: 'new' | 'edit'
  id: string
  name: string
  baseUrl: string
  token: string
  kind: ManagedBackendKind
}

function BackendEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: EditorState
  onSave: (input: { name: string; baseUrl: string; token: string; kind: ManagedBackendKind }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [token, setToken] = useState(initial.token)
  const [kind, setKind] = useState<ManagedBackendKind>(initial.kind)

  const urlValid = /^https?:\/\/.+/.test(baseUrl.trim())
  const valid = name.trim() !== '' && urlValid

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="block text-xs font-medium text-ink-2">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My server / Colab T4 #2"
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-1 outline-none placeholder:text-ink-3 focus:border-brand-8"
          />
        </label>
        <label className="block space-y-1">
          <span className="block text-xs font-medium text-ink-2">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ManagedBackendKind)}
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-1 outline-none focus:border-brand-8"
          >
            <option value="long-term">Long-term (persistent server)</option>
            <option value="short-term">Short-term (ephemeral — Colab runtime)</option>
          </select>
        </label>
      </div>
      <label className="block space-y-1">
        <span className="block text-xs font-medium text-ink-2">Base URL</span>
        <input
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="http://127.0.0.1:4824  ·  https://xxxx.trycloudflare.com"
          className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink-1 outline-none placeholder:text-ink-3 focus:border-brand-8"
        />
        {baseUrl !== '' && !urlValid && (
          <span className="block text-[11px] text-danger">Must start with http(s)://</span>
        )}
      </label>
      <label className="block space-y-1">
        <span className="block text-xs font-medium text-ink-2">
          Token <span className="font-normal text-ink-3">(optional; for job mutations, ADR-036 §5)</span>
        </span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="leave empty for read-only (health/jobs/logs are open)"
          className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink-1 outline-none placeholder:text-ink-3 focus:border-brand-8"
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" size="1" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="1"
          disabled={!valid}
          onClick={() => onSave({ name: name.trim(), baseUrl: baseUrl.trim(), token: token.trim(), kind })}
        >
          {initial.mode === 'new' ? 'Add backend' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}

function QuickStart({ onAdd }: { onAdd: (kind: ManagedBackendKind) => void }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-line bg-surface-2 p-5">
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', KIND_STYLE['long-term'])}>
          Long-term
        </span>
        <h3 className="mt-2 text-sm font-semibold text-ink-1">Run it on your own machine</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-2">
          Start the WakeStudio studio-backend locally (Python/FastAPI job manager, ADR-036):
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-1 px-3 py-2 font-mono text-[11px] text-ink-2">
          {`uv run --project apps/studio-backend wake-service`}
        </pre>
        <p className="mt-2 text-xs leading-relaxed text-ink-2">
          Defaults to <code className="font-mono text-[11px]">http://127.0.0.1:4824</code>. Add it
          as a backend, then train with the <span className="font-medium text-ink-1">Studio-backend</span> method.
        </p>
        <Button type="button" size="1" className="mt-3" onClick={() => onAdd('long-term')}>
          Add my local backend
        </Button>
      </div>

      <div className="rounded-xl border border-line bg-surface-2 p-5">
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', KIND_STYLE['short-term'])}>
          Short-term · Colab
        </span>
        <h3 className="mt-2 text-sm font-semibold text-ink-1">Quick-start one on Google Colab</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-2">
          Open the openwakeword notebook and run <span className="font-medium text-ink-1">Step 1.5</span>{' '}
          (tunnel, ADR-023 amendment): it starts the same service inside the Colab runtime and
          prints a free trycloudflare URL + token.
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-ink-2">
          <li>Open the notebook in Colab (Training → New → OpenWakeWord → Review).</li>
          <li>Run all cells up to <span className="font-medium">Step 1.5</span>.</li>
          <li>Copy the printed URL + token and save them here.</li>
        </ol>
        <Button type="button" size="1" variant="soft" className="mt-3" onClick={() => onAdd('short-term')}>
          Add a Colab backend
        </Button>
      </div>
    </div>
  )
}

function BackendDetail({ backend }: { backend: ManagedBackend }) {
  const [jobs, setJobs] = useState<StudioJob[] | null>(null)
  const [logs, setLogs] = useState<{ jobId: string; lines: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const client = createStudioClient(backend.baseUrl, backend.token)

  const loadJobs = useCallback(async () => {
    setError(null)
    try {
      setJobs(await client.listJobs())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setJobs(null)
    }
  }, [client])

  useEffect(() => {
    setLogs(null)
    void loadJobs()
  }, [loadJobs])

  const openLogs = useCallback(
    async (jobId: string) => {
      setError(null)
      try {
        setLogs({ jobId, lines: await client.getLogs(jobId) })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [client],
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Jobs on {backend.name}
        </h4>
        <Button type="button" size="1" variant="ghost" onClick={() => void loadJobs()}>
          Refresh
        </Button>
      </div>

      {error && (
        <p className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[11px] text-danger">
          {error}
        </p>
      )}

      {jobs === null ? (
        <p className="text-xs text-ink-3">Loading jobs…</p>
      ) : jobs.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink-3">
          No jobs on this backend yet — start one from the Training view.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {jobs.map((j) => (
            <li key={j.id}>
              <button
                type="button"
                onClick={() => void openLogs(j.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs',
                  logs?.jobId === j.id
                    ? 'border-brand-9/50 bg-brand-9/5'
                    : 'border-line bg-surface-2 hover:border-brand-9/30',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    j.status === 'succeeded'
                      ? 'bg-emerald-500'
                      : j.status === 'failed'
                        ? 'bg-danger'
                        : j.status === 'running'
                          ? 'bg-brand-9'
                          : 'bg-ink-3/50',
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate font-mono text-ink-1">{j.id}</span>
                <span className="text-[10px] uppercase tracking-wide text-ink-3">{j.status}</span>
                {typeof j.progress === 'number' && (
                  <span className="font-mono text-[10px] text-ink-3">
                    {Math.round(j.progress * 100)}%
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {logs && (
        <div className="space-y-1.5">
          <h5 className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
            Logs · {logs.jobId}
          </h5>
          <pre className="max-h-56 overflow-auto rounded-lg border border-line bg-surface-1 px-3 py-2 font-mono text-[10px] leading-relaxed text-ink-2">
            {logs.lines.length ? logs.lines.join('\n') : '(no log lines)'}
          </pre>
        </div>
      )}
    </div>
  )
}

export function BackendsView() {
  const { backends, upsertBackend, removeBackend } = useAppSettings()
  const [editing, setEditing] = useState<EditorState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // Health checks: mount + every 30s + manual refresh. The backends list is
  // read via a ref so the poll interval does not restart on every upsert.
  const backendsRef = useRef(backends)
  backendsRef.current = backends

  const runHealthChecks = useCallback(async () => {
    const list = backendsRef.current
    if (list.length === 0) return
    for (const b of list) upsertBackend({ ...b, status: 'checking' })
    const results = await Promise.all(
      list.map(async (b) => {
        try {
          await createStudioClient(b.baseUrl, b.token).health()
          return { id: b.id, ok: true }
        } catch {
          return { id: b.id, ok: false }
        }
      }),
    )
    const ok = new Set(results.filter((r) => r.ok).map((r) => r.id))
    for (const b of list) {
      upsertBackend({
        ...b,
        status: ok.has(b.id) ? 'online' : 'offline',
        lastSeenMs: ok.has(b.id) ? Date.now() : b.lastSeenMs,
      })
    }
  }, [upsertBackend])

  useEffect(() => {
    void runHealthChecks()
    const timer = setInterval(() => void runHealthChecks(), HEALTH_POLL_MS)
    return () => clearInterval(timer)
  }, [runHealthChecks])

  const selected = backends.find((b) => b.id === selectedId) ?? null
  const editingBackend = editing ? backends.find((b) => b.id === editing.id) ?? null : null

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-5 p-6">
      <div>
        <h2 className="text-lg font-semibold text-ink-1">Backends</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-2">
          Your studio-backend endpoints for the <span className="font-medium text-ink-1">Studio-backend</span>{' '}
          train method (ADR-036). Health is checked automatically; jobs and logs are read-only
          here — train and control jobs from the Training view.
        </p>
      </div>

      {backends.length === 0 ? (
        <QuickStart onAdd={(kind) => setEditing({ mode: 'new', id: '', name: '', baseUrl: '', token: '', kind })} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          {/* List + editor */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                {backends.length} backend{backends.length === 1 ? '' : 's'}
              </h3>
              <div className="flex gap-1.5">
                <Button type="button" size="1" variant="ghost" onClick={() => void runHealthChecks()}>
                  Check health
                </Button>
                <Button
                  type="button"
                  size="1"
                  onClick={() => setEditing({ mode: 'new', id: '', name: '', baseUrl: '', token: '', kind: 'long-term' })}
                >
                  Add
                </Button>
              </div>
            </div>

            {editing && (
              <BackendEditor
                initial={editing}
                onSave={(input) => {
                  if (editing.mode === 'new') {
                    upsertBackend({
                      id: newId(),
                      name: input.name,
                      baseUrl: input.baseUrl,
                      token: input.token || undefined,
                      kind: input.kind,
                      status: 'unknown',
                      createdAtMs: Date.now(),
                    })
                    setEditing(null)
                  } else if (editingBackend) {
                    upsertBackend({ ...editingBackend, ...input })
                    setEditing(null)
                  }
                }}
                onCancel={() => setEditing(null)}
              />
            )}

            <ul className="space-y-2">
              {backends.map((b) => (
                <li key={b.id}>
                  <div
                    className={cn(
                      'rounded-xl border p-3 transition-colors',
                      selected?.id === b.id
                        ? 'border-brand-9/50 bg-brand-9/5'
                        : 'border-line bg-surface-2',
                    )}
                  >
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-2 text-left"
                      onClick={() => setSelectedId(b.id === selected?.id ? null : b.id)}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-ink-1">{b.name}</span>
                          <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide', KIND_STYLE[b.kind])}>
                            {b.kind === 'short-term' ? 'short-term' : 'long-term'}
                          </span>
                          <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide', STATUS_STYLE[b.status])}>
                            {b.status}
                          </span>
                        </div>
                        <p className="mt-1 truncate font-mono text-[11px] text-ink-3">{b.baseUrl}</p>
                        {b.lastSeenMs && (
                          <p className="mt-0.5 text-[10px] text-ink-3">
                            last seen {formatTime(b.lastSeenMs)}
                          </p>
                        )}
                      </div>
                    </button>
                    <div className="mt-2 flex justify-end gap-1.5">
                      <IconButton
                        type="button"
                        size="1"
                        variant="ghost"
                        aria-label="Edit backend"
                        onClick={() => setEditing({ mode: 'edit', id: b.id, name: b.name, baseUrl: b.baseUrl, token: b.token ?? '', kind: b.kind })}
                      >
                        ✎
                      </IconButton>
                      <IconButton
                        type="button"
                        size="1"
                        variant="ghost"
                        color="red"
                        aria-label="Delete backend"
                        onClick={() => setConfirmDelete(b.id)}
                      >
                        ✕
                      </IconButton>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Detail (read-only): jobs + logs */}
          <div className="min-w-0 rounded-xl border border-line bg-surface-2 p-4">
            {selected ? (
              <BackendDetail key={selected.id} backend={selected} />
            ) : (
              <p className="text-xs text-ink-3">
                Select a backend to see its jobs and logs (read-only).
              </p>
            )}
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface-2 p-5">
            <h3 className="text-sm font-semibold text-ink-1">Delete this backend?</h3>
            <p className="text-xs leading-relaxed text-ink-2">
              Removes it from the Backends menu. Jobs already started on it keep their recorded
              endpoint in the Training list; live tracking stops if the backend is gone.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" size="1" variant="ghost" onClick={() => setConfirmDelete(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                size="1"
                color="red"
                onClick={() => {
                  removeBackend(confirmDelete)
                  if (selectedId === confirmDelete) setSelectedId(null)
                  setConfirmDelete(null)
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default BackendsView
