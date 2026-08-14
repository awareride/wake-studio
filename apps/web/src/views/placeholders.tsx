/**
 * Placeholder views for shell completeness (Phase 1).
 *
 * Settings / Device SDK land in later phases; these keep the shell navigable
 * without dead links. Projects moved to its own list-detail view
 * (`views/ProjectsView.tsx`, shared ConsolePanel layout).
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
      <div className="rounded-full bg-brand-9/10 px-3 py-1 text-xs font-medium text-brand-11">
        Coming soon
      </div>
      <h2 className="text-lg font-semibold text-ink-1">{title}</h2>
      <p className="max-w-md text-sm text-ink-2">{description}</p>
    </div>
  )
}
