/**
 * Backends — managed studio-backend endpoints (training execution targets).
 *
 * Trains-style layout (mirrors the Training console): a header with the
 * `New` + `Free On Google Colab` toolbar, a left rail of backend cards
 * (collapsible; mobile drawer), and a right details pane (health, jobs,
 * logs — read-only). The layout stays top + left + right even when empty.
 *
 * - `New` opens a FULL-panel editor (like the Trains wizard): name /
 *   endpoint URL / access token. The **kind** (long-term vs short-term) is
 *   detected from `GET /health` (`instance`) — the Colab launcher starts
 *   with `--instance short-term` — no manual kind field.
 * - `Free On Google Colab` shows a clear step guide (Download → Open Google
 *   Colab → Upload → Run all → copy URL+token) with a `Preview` button that
 *   opens the generated notebook full-panel (Trains-style preview-on-demand).
 * - Health: `GET /health` on mount + every 30s + manual refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, IconButton } from '@radix-ui/themes'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui'
import { useAppSettings } from '../settings'
import { createStudioClient } from '../training/studio-client'
import type { StudioJob } from '../training/studio-client'
import type { ManagedBackend, ManagedBackendStatus } from '../backends/types'
import { cn } from '../components/cn'
import { IconMenu } from '../components/icons'
import {
  BACKEND_NOTEBOOK_FILENAME,
  downloadBackendNotebook,
} from '../backends/backend-notebook'
import { NotebookReviewView } from '../training/console/NotebookReviewView'
import { useIsDesktop } from '../training/console/useIsDesktop'
import { ConfirmDialog } from '../training/console/ConfirmDialog'

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

const KIND_STYLE: Record<ManagedBackend['kind'], string> = {
  'long-term': 'bg-surface-3 text-ink-2',
  'short-term': 'bg-amber-500/15 text-amber-700',
}

interface EditorInput {
  name: string
  baseUrl: string
  token: string
}

/** Full-panel editor (Trains-wizard style): header + form + pinned footer. */
function BackendEditor({
  mode,
  initial,
  onSave,
  onCancel,
}: {
  mode: 'new' | 'edit'
  initial: EditorInput
  onSave: (input: EditorInput) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [token, setToken] = useState(initial.token)

  const urlValid = /^https?:\/\/.+/.test(baseUrl.trim())
  const valid = name.trim() !== '' && urlValid

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[24rem] flex-col gap-6">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-1">
            {mode === 'new' ? 'New backend' : 'Edit backend'}
          </h3>
          <p className="mt-0.5 text-xs text-ink-3">
            {mode === 'new'
              ? 'Endpoint URL + access token of a studio-backend (long-term server or a short-term Colab tunnel). The kind is detected from /health — no need to pick it.'
              : 'Update the endpoint, token or name.'}
          </p>
        </div>
        <Button type="button" onClick={onCancel} variant="outline" size="1" className="text-xs">
          Cancel
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <div className="max-w-2xl space-y-4 rounded-xl border border-line bg-surface-2 p-4">
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
              <span className="font-normal text-ink-3">
                (optional; for job mutations, ADR-036 §5)
              </span>
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
            detected automatically from the service's{' '}
            <code className="font-mono">/health</code> — the Colab launcher reports{' '}
            <code className="font-mono">instance: short-term</code>.
          </p>
        </div>
      </div>

      {/* Pinned footer (same position as the wizard's Save/Start). */}
      <div className="shrink-0 space-y-2 border-t border-line pt-4">
        <div className="flex items-center justify-end gap-2">
          <Button type="button" onClick={onCancel} variant="outline" size="2">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => onSave({ name: name.trim(), baseUrl: baseUrl.trim(), token: token.trim() })}
            disabled={!valid}
            size="2"
          >
            {mode === 'new' ? 'Add' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  )
}

const COLAB_STEPS: Array<[string, string]> = [
  ['Download the notebook', 'the button above saves studio-backend.ipynb.'],
  [
    'Open Google Colab',
    'colab.research.google.com in your browser — the notebook runs there for free.',
  ],
  [
    'Upload notebook',
    'File → Upload notebook, or drag the .ipynb file into the Colab file picker.',
  ],
  ['Run all', 'Runtime → Run all: the cells install the service and start the tunnel (~1–2 min).'],
  [
    'Copy URL + token',
    'the last cell prints the tunnel URL and a token — paste both into Backends → New (the kind is detected automatically).',
  ],
]

/** The "Free On Google Colab" guide: clear steps + preview on demand. */
function ColabGuide({
  blobUrl,
  onBack,
  onPreview,
}: {
  blobUrl: string
  onBack: () => void
  onPreview: () => void
}) {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[24rem] flex-col gap-6">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink-1">Free on Google Colab</h3>
          <p className="mt-0.5 text-xs text-ink-3">
            A short-term studio-backend on a free Colab runtime behind a trycloudflare tunnel
            (ADR-023 amendment) — no server, no keys, only your Google account.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {blobUrl && (
            <a
              href={blobUrl}
              download={BACKEND_NOTEBOOK_FILENAME}
              className="rounded-lg bg-brand-9 px-3 py-1.5 text-xs font-semibold text-ink-1 hover:bg-brand-8"
            >
              Download
            </a>
          )}
          <Button type="button" variant="outline" size="1" onClick={onPreview}>
            Preview notebook
          </Button>
          <Button type="button" variant="ghost" size="1" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              How to use it
            </h4>
            <ol className="mt-2 list-decimal space-y-2 pl-4">
              {COLAB_STEPS.map(([title, detail], i) => (
                <li key={i} className="text-xs leading-relaxed text-ink-2">
                  <span className="font-medium text-ink-1">{title}</span> — {detail}
                </li>
              ))}
            </ol>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                What the notebook does
              </h4>
              <p className="mt-2 text-xs leading-relaxed text-ink-2">
                It installs the studio-backend service from this repo (pinned to main) and starts
                it with the Colab launcher: the service runs in a background thread, cloudflared
                opens a free tunnel, and{' '}
                <code className="font-mono text-[11px]">/health</code> reports{' '}
                <code className="font-mono text-[11px]">instance: short-term</code> — that's how
                the Backends panel knows the kind. The registry is empty in this generic runtime;
                module train scripts (openwakeword etc.) run in their own notebooks.
              </p>
            </div>
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
              <h4 className="text-xs font-semibold text-amber-700">Ephemeral — by design</h4>
              <p className="mt-1.5 text-xs leading-relaxed text-amber-700/90">
                Colab may recycle the runtime at any time. After a reconnect, re-run the last
                cell: a fresh URL is printed. Training jobs checkpoint/resume across drops
                (ADR-023 amendment), and the Backends badge flips to offline when /health stops
                answering.
              </p>
            </div>
          </div>
        </div>
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

type BackendsViewMode =
  | { kind: 'list' }
  | { kind: 'new-editor'; mode: 'new' | 'edit'; backendId?: string }
  | { kind: 'colab-guide' }
  | { kind: 'colab-preview' }

export function BackendsView() {
  const { backends, upsertBackend, removeBackend } = useAppSettings()
  const [view, setView] = useState<BackendsViewMode>({ kind: 'list' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  const isDesktop = useIsDesktop()
  const [railCollapsed, setRailCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Health checks: mount + every 30s + manual refresh (list read via ref).
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

  // Blob URL for the generated notebook lives as long as the colab modes.
  useEffect(() => {
    if (view.kind === 'colab-guide' && !blobUrl) setBlobUrl(downloadBackendNotebook())
    if (view.kind !== 'colab-guide' && view.kind !== 'colab-preview' && blobUrl) {
      URL.revokeObjectURL(blobUrl)
      setBlobUrl(null)
    }
  }, [view.kind, blobUrl])

  const selected = backends.find((b) => b.id === selectedId) ?? null

  const handleRailToggle = useCallback(() => {
    if (isDesktop) setRailCollapsed((c) => !c)
    else setDrawerOpen(true)
  }, [isDesktop])

  // --- Full-panel modes (editor / colab guide / preview) ------------------
  if (view.kind === 'new-editor') {
    const editingBackend = view.backendId
      ? backends.find((b) => b.id === view.backendId) ?? null
      : null
    return (
      <BackendEditor
        mode={view.mode}
        initial={{
          name: editingBackend?.name ?? '',
          baseUrl: editingBackend?.baseUrl ?? '',
          token: editingBackend?.token ?? '',
        }}
        onSave={(input) => {
          if (view.mode === 'new') {
            upsertBackend({
              id: newId(),
              name: input.name,
              baseUrl: input.baseUrl,
              token: input.token || undefined,
              kind: 'long-term', // replaced by /health detection on first check
              status: 'unknown',
              createdAtMs: Date.now(),
            })
          } else if (editingBackend) {
            upsertBackend({ ...editingBackend, ...input })
          }
          setView({ kind: 'list' })
        }}
        onCancel={() => setView({ kind: 'list' })}
      />
    )
  }

  if (view.kind === 'colab-guide') {
    return (
      <ColabGuide
        blobUrl={blobUrl ?? ''}
        onBack={() => setView({ kind: 'list' })}
        onPreview={() => setView({ kind: 'colab-preview' })}
      />
    )
  }

  if (view.kind === 'colab-preview' && blobUrl) {
    return (
      <div className="flex h-[calc(100dvh-7.5rem)] min-h-[24rem] flex-col">
        <NotebookReviewView
          fileName={BACKEND_NOTEBOOK_FILENAME}
          rawUrl={blobUrl}
          onBack={() => setView({ kind: 'colab-guide' })}
        />
      </div>
    )
  }

  // --- List mode: header + left rail + right details (Trains-style) --------
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[24rem] flex-col gap-6">
      {/* Header (hidden in editor/colab modes — they have their own chrome). */}
      <div className="flex shrink-0 items-start justify-between gap-4">
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
          <Button type="button" size="2" variant="soft" onClick={() => setView({ kind: 'colab-guide' })}>
            Free On Google Colab
          </Button>
          <Button
            type="button"
            size="2"
            onClick={() => setView({ kind: 'new-editor', mode: 'new' })}
          >
            New
          </Button>
        </div>
      </div>

      {/* Split-scroll: left rail + right details (mirrors the Training console). */}
      <div className="flex min-h-0 flex-1 gap-6">
        {!railCollapsed && (
          <aside className="hidden min-h-0 w-72 shrink-0 flex-col border-r border-line lg:flex">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                {backends.length} backend{backends.length === 1 ? '' : 's'}
              </h3>
              <Button type="button" size="1" variant="ghost" onClick={() => void runHealthChecks()}>
                Check health
              </Button>
            </div>
            <ul className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-3">
              {backends.length === 0 && (
                <li className="rounded-lg border border-dashed border-line px-3 py-3 text-xs text-ink-3">
                  No backends yet — press{' '}
                  <span className="font-medium text-ink-1">New</span> to add one, or{' '}
                  <span className="font-medium text-ink-1">Free On Google Colab</span> for a
                  short-term runtime.
                </li>
              )}
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
                          <span
                            className={cn(
                              'rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                              KIND_STYLE[b.kind],
                            )}
                          >
                            {b.kind === 'short-term' ? 'short-term' : 'long-term'}
                          </span>
                        </div>
                        <p className="mt-1 truncate font-mono text-[11px] text-ink-3">{b.baseUrl}</p>
                      </div>
                      <span
                        className={cn(
                          'mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                          STATUS_STYLE[b.status],
                        )}
                      >
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
                          onClick={() =>
                            setView({ kind: 'new-editor', mode: 'edit', backendId: b.id })
                          }
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
        )}

        {/* Right details pane (own scroll). */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Re-open the rail when hidden (Trains-style toggle). */}
          {(!isDesktop || railCollapsed) && (
            <div className="mb-2 flex shrink-0 items-center gap-2">
              <IconButton
                type="button"
                onClick={handleRailToggle}
                aria-label={isDesktop ? 'Show backend list' : 'Open backend list'}
                variant="ghost"
                size="1"
                className="text-ink-3"
              >
                <IconMenu className="h-4 w-4" />
              </IconButton>
              <span className="text-[11px] text-ink-3">Backend list</span>
            </div>
          )}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {selected ? (
              <BackendDetail key={selected.id} backend={selected} />
            ) : (
              <div className="rounded-xl border border-line bg-surface-2 p-8 text-center">
                <p className="text-sm font-medium text-ink-1">No backend selected</p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-3">
                  Pick a backend from the left to see its jobs and logs (read-only). Use{' '}
                  <span className="font-medium text-ink-2">New</span> to add an endpoint, or{' '}
                  <span className="font-medium text-ink-2">Free On Google Colab</span> to
                  generate a short-term runtime notebook.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile drawer (matches the shell's sidebar pattern). */}
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent
          centered={false}
          className="drawer-content left-0 top-0 h-screen w-[min(80vw,18rem)] max-w-[calc(100vw-2rem)] rounded-r-xl border-l border-t-0 border-r-0 border-b-0 p-0 data-[state=open]:animate-[drawer-in_180ms_ease-out] data-[state=closed]:animate-[drawer-out_160ms_ease-in]"
        >
          <DialogTitle className="sr-only">Backend list</DialogTitle>
          <DialogDescription className="sr-only">Your managed backends</DialogDescription>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">
              Backend list
            </span>
            <IconButton
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close backend list"
              variant="ghost"
              size="1"
              className="text-ink-3"
            >
              ✕
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto">
            <ul className="space-y-2 p-3">
              {backends.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(b.id)
                      setDrawerOpen(false)
                    }}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-left text-xs',
                      selected?.id === b.id
                        ? 'border-brand-9/50 bg-brand-9/5'
                        : 'border-line bg-surface-2',
                    )}
                  >
                    <span className="block font-medium text-ink-1">{b.name}</span>
                    <span className="block truncate font-mono text-[10px] text-ink-3">
                      {b.baseUrl}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete this backend?"
        message="Removes it from the Backends menu. Jobs already started on it keep their recorded endpoint in the Training list; live tracking stops if the backend is gone."
        confirmLabel="Delete"
        onConfirm={() => {
          if (confirmDelete) {
            removeBackend(confirmDelete)
            if (selectedId === confirmDelete) setSelectedId(null)
          }
          setConfirmDelete(null)
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

export default BackendsView
