/**
 * Placeholder views for shell completeness (Phase 1).
 *
 * Settings / Device SDK land in later phases; these keep the shell navigable
 * without dead links. Projects shows a scaffold list (real CRUD lands with
 * the project store in Phase 2).
 */

import { useProjects } from '../projects'

export function ComingSoonView({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-full bg-brand-9/10 px-3 py-1 text-xs font-medium text-brand-11">
        Coming soon
      </div>
      <h2 className="text-lg font-semibold text-ink-1">{title}</h2>
      <p className="max-w-md text-sm text-ink-2">{description}</p>
    </div>
  )
}

export function ProjectsView() {
  const { projects } = useProjects()
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink-1">Projects</h2>
        <p className="mt-1 text-sm text-ink-2">
          Wake-word projects: target word, domain, config snapshots, samples
          and prototypes.
        </p>
      </div>
      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface-2/50 p-10 text-center text-sm text-ink-3">
          No projects yet — create one from the Workspace.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {projects.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-line bg-surface-2 p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-semibold text-ink-1">
                  {p.name}
                </h3>
                <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
                  {p.domain}
                </span>
              </div>
              <dl className="mt-2 space-y-1 text-xs text-ink-2">
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-ink-3">Wake word</dt>
                  <dd className="truncate">{p.targetWord || '—'}</dd>
                </div>
                {p.targetChip && (
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-ink-3">Chip</dt>
                    <dd className="truncate">{p.targetChip}</dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-ink-3">Samples</dt>
                  <dd>{p.sampleIds.length}</dd>
                </div>
              </dl>
              <p className="mt-2 text-[11px] text-ink-3">
                Updated {new Date(p.updatedAtMs).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
