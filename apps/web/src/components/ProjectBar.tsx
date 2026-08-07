/**
 * Project bar - select/create the active project in the workspace.
 *
 * Shows the current project (name, target word, domain) with a dropdown to
 * switch, and a "New project" dialog (Radix). Project data lives in the
 * project context (IndexedDB).
 */

import * as React from 'react'
import { useProjects, PROJECT_DOMAINS } from '../projects'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui'
import { NewProjectDialog } from './NewProjectDialog'

export function ProjectBar() {
  const { projects, current, selectProject } = useProjects()
  const [createOpen, setCreateOpen] = React.useState(false)

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-ink-3">
          Project
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 rounded-lg border border-line bg-surface-3 px-2.5 py-1.5 text-sm font-medium text-ink-1 hover:bg-surface-4">
              {current ? (
                <>
                  <span className="max-w-40 truncate">{current.name}</span>
                  <span className="text-ink-3">▾</span>
                </>
              ) : (
                <span className="text-ink-3">No project selected</span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            {projects.length === 0 && (
              <div className="px-2.5 py-2 text-xs text-ink-3">No projects yet</div>
            )}
            {projects.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => selectProject(p.id)}>
                <span className="flex-1 truncate">{p.name}</span>
                {current?.id === p.id && <span className="text-brand-600">✓</span>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
              <span className="text-brand-600">+ New project…</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {current && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
          <span>
            Target:{' '}
            <span className="font-medium text-ink-1">{current.targetWord || '—'}</span>
          </span>
          <span>
            Domain:{' '}
            <span className="font-medium text-ink-1">
              {PROJECT_DOMAINS.find((d) => d.value === current.domain)?.label ?? current.domain}
            </span>
          </span>
          {current.targetChip && (
            <span>
              Chip: <span className="font-medium text-ink-1">{current.targetChip}</span>
            </span>
          )}
        </div>
      )}

      {/* New project dialog (shared with the TopBar recent-projects menu). */}
      <NewProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
