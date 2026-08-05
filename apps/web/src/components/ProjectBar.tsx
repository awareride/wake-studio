/**
 * Project bar - select/create the active project in the workspace.
 *
 * Shows the current project (name, target word, domain) with a dropdown to
 * switch, and a "New project" dialog (Radix). Project data lives in the
 * project context (IndexedDB).
 */

import * as React from 'react'
import { useProjects, PROJECT_DOMAINS } from '../projects'
import type { ProjectDomain } from '../projects'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui'
import { useToast } from './toast'
import { cn } from './cn'

export function ProjectBar() {
  const { projects, current, selectProject, createProject, busy } = useProjects()
  const { toast } = useToast()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [draft, setDraft] = React.useState({
    name: '',
    targetWord: '',
    domain: 'high-performance' as ProjectDomain,
    targetChip: '',
  })

  const submitCreate = async () => {
    try {
      await createProject(draft)
      setCreateOpen(false)
      setDraft({ name: '', targetWord: '', domain: 'high-performance', targetChip: '' })
      toast({ title: 'Project created', description: draft.name || 'Untitled project' })
    } catch (err) {
      toast({
        title: 'Failed to create project',
        description: err instanceof Error ? err.message : String(err),
        variant: 'error',
      })
    }
  }

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

      {/* New project dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Create a wake-word project: target word, domain and target chip.
          </DialogDescription>
          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="text-ink-2">Project name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Hey Studio"
                className="mt-1 w-full rounded-lg border border-line bg-surface-3 px-3 py-2 text-sm text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink-2">Wake word</span>
              <input
                value={draft.targetWord}
                onChange={(e) => setDraft((d) => ({ ...d, targetWord: e.target.value }))}
                placeholder="e.g. hey studio"
                className="mt-1 w-full rounded-lg border border-line bg-surface-3 px-3 py-2 text-sm text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              />
            </label>
            <label className="block text-sm">
              <span className="text-ink-2">Domain</span>
              <select
                value={draft.domain}
                onChange={(e) => setDraft((d) => ({ ...d, domain: e.target.value as ProjectDomain }))}
                className="mt-1 w-full rounded-lg border border-line bg-surface-3 px-3 py-2 text-sm text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              >
                {PROJECT_DOMAINS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-ink-2">Target chip (optional)</span>
              <input
                value={draft.targetChip}
                onChange={(e) => setDraft((d) => ({ ...d, targetChip: e.target.value }))}
                placeholder="e.g. rpi4, esp32-s3, linux-x64"
                className="mt-1 w-full rounded-lg border border-line bg-surface-3 px-3 py-2 text-sm text-ink-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
              />
            </label>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setCreateOpen(false)}
              className={cn('rounded-lg border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-3')}
            >
              Cancel
            </button>
            <button
              onClick={submitCreate}
              disabled={busy}
              className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-ink-1 hover:bg-brand-400 disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
