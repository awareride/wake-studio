/**
 * Recent projects menu (epic #53 P6) — moved into the Workspace content.
 *
 * Lists up to 5 recent projects (MRU via updatedAtMs desc) with an
 * "updated …" caption; selecting switches the active project and navigates
 * to /workspace when not already there. "+ New project…" opens the same
 * dialog as the ProjectBar (shared NewProjectDialog).
 */

import * as React from 'react'
import { useProjects } from '../projects'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui'
import { NewProjectDialog } from './NewProjectDialog'
import { ChevronDownIcon, ListBulletIcon } from '@radix-ui/react-icons'

/** Relative "updated …" caption for the recent-projects menu. */
function formatUpdated(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'updated just now'
  if (diff < 3_600_000) return `updated ${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `updated ${Math.floor(diff / 3_600_000)}h ago`
  return `updated ${new Date(ms).toLocaleDateString()}`
}

export function RecentProjectsMenu() {
  const { projects, current, selectProject } = useProjects()
  const [createOpen, setCreateOpen] = React.useState(false)

  const recent = projects.slice(0, 5)
  const label = current?.name ?? 'No project selected'

  const openProject = (id: string) => {
    selectProject(id)
    if (window.location.hash !== '#/workspace') {
      window.location.hash = '#/workspace'
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex max-w-48 items-center gap-1.5 rounded-lg border border-line bg-surface-3 px-2.5 py-1.5 text-sm font-medium text-ink-1 hover:bg-surface-4"
            title="Recent projects"
          >
            <ListBulletIcon className="h-3.5 w-3.5 shrink-0 text-ink-3" />
            <span className="truncate">{label}</span>
            <ChevronDownIcon className="h-3 w-3 shrink-0 text-ink-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-60">
          {recent.length === 0 && (
            <div className="px-2.5 py-2 text-xs text-ink-3">No projects yet</div>
          )}
          {recent.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => openProject(p.id)}>
              <span className="flex flex-1 flex-col">
                <span className="truncate text-sm text-ink-1">{p.name}</span>
                <span className="text-[10px] text-ink-3">
                  {formatUpdated(p.updatedAtMs)}
                </span>
              </span>
              {current?.id === p.id && (
                <span className="text-brand-600">✓</span>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <span className="text-brand-600">+ New project…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  )
}
