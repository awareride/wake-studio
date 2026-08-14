/**
 * Backends — managed studio-backend endpoints (training execution targets).
 *
 * Trains-style layout (mirrors the Training console): a header with the
 * `New` + `Free On Google Colab` toolbar, a left rail of backend cards, and
 * a right details pane (health, jobs, logs — read-only).
 *
 * - `New`: name / baseUrl / token. The **kind** (long-term vs short-term) is
 *   detected from the API — `GET /health` reports `instance` (the Colab
 *   launcher starts with `--instance short-term`), and the health check
 *   updates the badge automatically. No manual kind field.
 * - `Free On Google Colab`: generates a standalone studio-backend notebook
 *   (client-side, no repo asset) the user can review + download; run it in
 *   Colab, paste the printed URL + token into `New`.
 * - Health: `GET /health` on mount + every 30s + manual refresh.
 * - Detail (read-only): jobs (`GET /jobs`) + per-job logs
 *   (`GET /jobs/{id}/logs`). Actions stay in the Training view.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, IconButton } from '@radix-ui/themes'
import { useAppSettings } from '../settings'
import { createStudioClient } from '../training/studio-client'
import type { StudioJob } from '../training/studio-client'
import type { ManagedBackend, ManagedBackendKind, ManagedBackendStatus } from '../backends/types'
import { cn } from '../components/cn'
import {
  BACKEND_NOTEBOOK_FILENAME,
  downloadBackendNotebook,
} from '../backends/backend-notebook'
import { NotebookReviewView } from '../training/console/NotebookReviewView'

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

const KIND_HINT: Record<ManagedBackendKind, string> = {
  'long-term': 'persistent server',
  'short-term': 'ephemeral Colab runtime',
}

interface EditorState {
  mode: 'new' | 'edit'
  id: string
  name: string
  baseUrl: string
  token: string
}

function BackendEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: EditorState
  onSave: (input: { name: string; baseUrl: string; token: string }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [token, setToken] = useState(initial.token)

  const urlValid = /^https?:\/\/.+/.test(baseUrl.trim())
  const valid = name.trim() !== '' && urlValid

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-2 p-4">
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
        <span className="block text-xs font-medium text-ink-2">Endpoint URL</span>
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
          Access token{' '}
          <span className="font-normal text-ink-3">(optional; for job mutations, ADR-036 §5)</span>
        </span>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="leave empty for read-only (health/jobs/logs are open)"
          className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-ink-1 outline-none placeholder:text-ink-3 focus:border-brand-8"
        />
      </label>
      <p className="text-[11px] leading-relaxed text-ink-3">
        The <span className="font-medium text-ink-2">kind</span> (long-term / short-term) is
        detected automatically from the service's <code className="font-mono">/health</code> — no
        need to pick it here.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" size="1" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          size="1"
          disabled={!valid}
          onClick={() => onSave({ name: name.trim(), baseUrl: baseUrl.trim(), token: token.trim() })}
        >
          {initial.mode === 'new' ? 'Add backend' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}

/** The "Free On Google Colab" guide: instructions + notebook review + download. */
function ColabGuide({ onBack }: { onBack: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  useEffect(() => {
    setBlobUrl(downloadBackendNotebook())
    return () => {
      setBlobUrl((url) => {
        if (url) URL.revokeObjectURL(url)
        return null
      })
    }
  }, [])

  const steps = useMemo(
    () => [
      ['Download the notebook', 'the button below saves studio-backend.ipynb.'],
      ['Open it in Google Colab', 'colab.research.google.com → File → Upload notebook (drag it in).'],
      ['Runtime → Run all', 'the cells install the service and start the tunnel (~1–2 min).'],
      ['Copy URL + token', 'the last cell prints the tunnel URL and a token.'],
      ['Backends → New', 'paste both here and save — the kind (short-term) is detected automatically.'],
    ],
    [],
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-1">Free on Google Colab</h3>
          <p className="mt-0.5 text-xs text-ink-3">
            A short-term studio-backend, running on a free Colab runtime behind a trycloudflare
            tunnel (ADR-023 amendment). No server, no keys — only your Google account.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {blobUrl && (
            <a
              href={blobUrl}
              download={BACKEND_NOTEBOOK_FILENAME}
              className="rounded-lg bg-brand-9 px-3 py-1.5 text-xs font-semibold text-ink-1 hover:bg-brand-8"
            >
              Download notebook
            </a>
          )}
          <Button type="button" variant="outline" size="1" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>

      <div className="grid shrink-0 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            How to use it
          </h4>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4">
            {steps.map(([title, detail], i) => (
              <li key={i} className="text-xs leading-relaxed text-ink-2">
                <span className="font-medium text-ink-1">{title}</span> — {detail}
              </li>
            ))}
          </ol>
          <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-700">
            The runtime is ephemeral — Colab may recycle it. After a reconnect, re-run the last
            cell: a fresh URL is printed. Jobs checkpoint/resume across drops (ADR-023 amendment).
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            What the notebook does
          </h4>
          <p className="mt-2 text-xs leading-relaxed text-ink-2">
            It installs the studio-backend service from this repo (pinned to main) and starts it
            with the Colab launcher: the service runs in a background thread, cloudflared opens a
            free tunnel, and <code className="font-mono text-[11px]">/health</code> reports{' '}
            <code className="font-mono text-[11px]">instance: short-term</code> — that's how the
            Backends panel knows the kind. The registry is empty in this generic runtime; module
            train scripts (openwakeword etc.) run in their own notebooks.
          </p>
        </div>
      </div>

      {blobUrl && (
        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line">
          <NotebookReviewView
            fileName={BACKEND_NOTEBOOK_FILENAME}
            rawUrl={blobUrl}
            onBack={onBack}
          />
        </div>
      )}
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

function QuickStart({ onAdd, onColab }: { onAdd: () => void; onColab: () => void }) {
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
        <Button type="button" size="1" className="mt-3" onClick={onAdd}>
          Add my local backend
        </Button>
      </div>

      <div className="rounded-xl border border-line bg-surface-2 p-5">
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide', KIND_STYLE['short-term'])}>
          Short-term · Colab
        </span>
        <h3 className="mt-2 text-sm font-semibold text-ink-1">Free on Google Colab</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-2">
          Generate a standalone notebook that starts the same service inside a free Colab runtime
          and exposes it through a trycloudflare tunnel — no server, no keys.
        </p>
        <Button type="button" size="1" variant="soft" className="mt-3" onClick={onColab}>
          Generate the notebook
        </Button>
      </div>
    </div>
  )
}

export function BackendsView() {
  const { backends, upsertBackend, removeBackend } = useAppSettings()
  const [mode, setMode] = useState<'list' | 'colab-guide'>('list')
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
          const health = await createStudioClient(b.baseUrl, b.token).health()
          return { id: b.id, ok: true, kind: health.instance ?? null }
        } catch {
          return { id: b.id, ok: false, kind: null }
        }
      }),
    )
    const ok = new Map(results.filter((r) => r.ok).map((r) => [r.id, r.kind]))
    for (const b of list) {
      const kind = ok.get(b.id)
      upsertBackend({
        ...b,
        status: ok.has(b.id) ? 'online' : 'offline',
        kind: kind && (kind === 'long-term' || kind === 'short-term') ? kind : b.kind,
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

  if (mode === 'colab-guide') {
    return <ColabGuide onBack={() => setMode('list')} />
  }

  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col gap-5 p-6">
      {/* Header + toolbar (Trains-style). */}
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink-1">Backends</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-2">
            Your studio-backend endpoints for the{' '}
            <span className="font-medium text-ink-1">Studio-backend</span> train method (ADR-036).
            Health is checked automatically; kind (long-term / short-term) is detected from the
            service. Jobs and logs here are read-only — train and control jobs from the Training
            view.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="2"
            variant="soft"
            onClick={() => setMode('colab-guide')}
          >
            Free On Google Colab
          </Button>
          <Button
            type="button"
            size="2"
            onClick={() => setEditing({ mode: 'new', id: '', name: '', baseUrl: '', token: '' })}
          >
            New
          </Button>
        </div>
      </div>

      {backends.length === 0 && !editing ? (
        <QuickStart
          onAdd={() => setEditing({ mode: 'new', id: '', name: '', baseUrl: '', token: '' })}
          onColab={() => setMode('colab-guide')}
        />
      ) : (
        /* Split-scroll: left rail + right details (mirrors the Training console). */
        <div className="flex min-h-0 flex-1 gap-6">
          <aside className="flex min-h-0 w-72 shrink-0 flex-col border-r border-line pr-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                {backends.length} backend{backends.length === 1 ? '' : 's'}
              </h3>
              <Button type="button" size="1" variant="ghost" onClick={() => void runHealthChecks()}>
                Check health
              </Button>
            </div>
            <ul className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto">
              {backends.map((b) => (
                <li key={b.id}>
                  <div
                    className={cn(
                      'rounded-xl border p-3 transition-colors',
                      selected?.id === b.id
                        ? 'border-brand-9/50 bg-brand-9/5'
                        : 'border-line bg-surface-2 hover:border-brand-9/30',
                    )}
                  >
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-2 text-left"
                      onClick={() => setSelectedId(b.id === selected?.id ? null : b.id)}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-ink-1">{b.name}</span>
                          <span className={cn('rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide', KIND_STYLE[b.kind])} title={KIND_HINT[b.kind]}>
                            {b.kind === 'short-term' ? 'short-term' : 'long-term'}
                          </span>
                        </div>
                        <p className="mt-1 truncate font-mono text-[11px] text-ink-3">{b.baseUrl}</p>
                      </div>
                      <span className={cn('mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide', STATUS_STYLE[b.status])}>
                        {b.status}
                      </span>
                    </button>
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
                      <span className="text-[10px] text-ink-3">
                        {b.lastSeenMs ? `seen ${formatTime(b.lastSeenMs)}` : 'not checked yet'}
                      </span>
                      <div className="flex gap-1">
                        <IconButton
                          type="button"
                          size="1"
                          variant="ghost"
                          aria-label="Edit backend"
                          onClick={() => setEditing({ mode: 'edit', id: b.id, name: b.name, baseUrl: b.baseUrl, token: b.token ?? '' })}
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
                  </div>
                </li>
              ))}
            </ul>
          </aside>

          {/* Right details pane (own scroll). */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
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
                      kind: 'long-term', // replaced by /health detection on first check
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

            {selected ? (
              <BackendDetail key={selected.id} backend={selected} />
            ) : (
              <p className="rounded-xl border border-line bg-surface-2 p-4 text-xs text-ink-3">
                Select a backend on the left to see its jobs and logs (read-only).
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
