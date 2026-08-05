/**
 * Placeholder views for shell completeness (Phase 1).
 *
 * Settings / Device SDK land in later phases; these keep the shell navigable
 * without dead links. Projects shows a scaffold list (real CRUD lands with
 * the project store in Phase 2).
 */

export function ComingSoonView({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <div className="rounded-full bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-700">
        Coming soon
      </div>
      <h2 className="text-lg font-semibold text-ink-1">{title}</h2>
      <p className="max-w-md text-sm text-ink-2">{description}</p>
    </div>
  )
}

export function ProjectsView() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink-1">Projects</h2>
        <p className="mt-1 text-sm text-ink-2">
          Wake-word projects: target word, domain, config snapshots, samples
          and prototypes. Project CRUD lands with the workspace store (Phase 2).
        </p>
      </div>
      <div className="rounded-xl border border-dashed border-line bg-surface-2/50 p-10 text-center text-sm text-ink-3">
        No projects yet — create one from the Workspace.
      </div>
    </div>
  )
}
