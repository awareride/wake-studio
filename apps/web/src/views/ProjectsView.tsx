/**
 * Projects — list-detail console on the shared ConsolePanel (Trains-style).
 *
 * Left rail: the project list (name, domain badge, last-updated). Right
 * pane: the selected project's details (wake word, target, samples,
 * prototypes, notes) — read-only; project creation stays in the Workspace.
 * Selection is shared with the workspace via the projects context
 * (selectProject/current).
 */

import { useMemo, useState } from 'react'
import { Button } from '@radix-ui/themes'
import { ConsolePanel } from '../components/ConsolePanel'
import { useProjects } from '../projects'
import { ConfirmDialog } from '../training/console/ConfirmDialog'
import { cn } from '../components/cn'

const DOMAIN_STYLE: Record<string, string> = {
  mcu: 'bg-surface-3 text-ink-2',
  'app-class': 'bg-brand-9/10 text-brand-11',
  linux: 'bg-emerald-500/10 text-emerald-700',
}

export function ProjectsView() {
  const { projects, current, selectProject, deleteProject } = useProjects()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const ordered = useMemo(
    () => [...projects].sort((a, b) => b.updatedAtMs - a.updatedAtMs),
    [projects],
  )

  return (
    <>
      <ConsolePanel
      title="Projects"
      description="Wake-word projects: target word, domain, config snapshots, samples and prototypes. Select one to inspect; create new projects from the Workspace."
      railTitle="Projects"
      railCount={projects.length}
      rail={(close) => (
        <ul className="space-y-1 px-2 pb-4">
          {ordered.length === 0 && (
            <li className="rounded-lg border border-dashed border-line px-3 py-3 text-xs text-ink-3">
              No projects yet — create one from the Workspace.
            </li>
          )}
          {ordered.map((p) => {
            const selected = current?.id === p.id
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    selectProject(p.id)
                    close()
                  }}
                  aria-pressed={selected}
                  className={cn(
                    'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                    selected
                      ? 'border-brand-9/50 bg-brand-9/5'
                      : 'border-transparent hover:border-line hover:bg-surface-2',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                        DOMAIN_STYLE[p.domain] ?? 'bg-surface-3 text-ink-3',
                      )}
                    >
                      {p.domain}
                    </span>
                    <span className="text-[10px] text-ink-3">
                      {new Date(p.updatedAtMs).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs font-medium text-ink-1">{p.name}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-3">
                    <span className="truncate">{p.targetWord || 'no wake word'}</span>
                    <span aria-hidden>·</span>
                    <span>{p.sampleIds.length} samples</span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      details={
        current ? (
          <>
            <section className="rounded-xl border border-line bg-surface-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-ink-1">{current.name}</h3>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                  DOMAIN_STYLE[current.domain] ?? 'bg-surface-3 text-ink-3',
                )}
              >
                {current.domain}
              </span>
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Wake word</dt>
                <dd className="truncate font-mono text-ink-1">{current.targetWord || '—'}</dd>
              </div>
              {current.targetChip && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">Target chip</dt>
                  <dd className="truncate font-mono text-ink-1">{current.targetChip}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Samples</dt>
                <dd className="font-mono text-ink-1">{current.sampleIds.length}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Prototypes</dt>
                <dd className="font-mono text-ink-1">{current.prototypeIds.length}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Created</dt>
                <dd className="font-mono text-ink-1">
                  {new Date(current.createdAtMs).toLocaleString()}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-3">Updated</dt>
                <dd className="font-mono text-ink-1">
                  {new Date(current.updatedAtMs).toLocaleString()}
                </dd>
              </div>
            </dl>
            {current.notes && (
              <p className="mt-3 rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs leading-relaxed text-ink-2">
                {current.notes}
              </p>
            )}
            <p className="mt-3 text-[11px] text-ink-3">
              Edit samples, config and prototypes from the Workspace — this panel is read-only.
            </p>
            </section>
            {/* Operations (Trains/Backends-style). */}
            <section className="rounded-xl border border-danger/25 bg-surface-2 p-4">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                Operations
              </h4>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-ink-3">
                  Delete this project and its stored config, samples and prototypes.
                </p>
                <Button
                  type="button"
                  size="1"
                  variant="outline"
                  color="red"
                  className="shrink-0"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete
                </Button>
              </div>
            </section>
          </>
        ) : null
      }
      detailsEmpty={
        <div className="rounded-xl border border-line bg-surface-2 p-8 text-center">
          <p className="text-sm font-medium text-ink-1">No project selected</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-3">
            Pick a project from the left to inspect it (wake word, target, samples, prototypes).
            Create new projects from the Workspace.
          </p>
        </div>
      }
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this project?"
        message="Deletes the project and its stored config, samples and prototypes. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => {
          if (current) void deleteProject(current.id)
          setConfirmDelete(false)
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  )
}

export default ProjectsView
