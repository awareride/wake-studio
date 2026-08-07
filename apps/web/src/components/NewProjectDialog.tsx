/**
 * New project dialog (epic #53 P6).
 *
 * Shared by the ProjectBar (workspace header) and the TopBar "Recent
 * projects" dropdown so both open the exact same create flow. The dialog
 * fields + texts are e2e-pinned (smoke: "Project name" / "Wake word" /
 * "Create") — do not rename them.
 */

import * as React from 'react'
import { useProjects, PROJECT_DOMAINS } from '../projects'
import type { ProjectDomain } from '../projects'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui'
import { useToast } from './toast'
import { cn } from './cn'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function NewProjectDialog({ open, onOpenChange }: Props) {
  const { createProject, busy } = useProjects()
  const { toast } = useToast()
  const [draft, setDraft] = React.useState({
    name: '',
    targetWord: '',
    domain: 'high-performance' as ProjectDomain,
    targetChip: '',
  })

  const submitCreate = async () => {
    try {
      await createProject(draft)
      onOpenChange(false)
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
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            onClick={() => onOpenChange(false)}
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
  )
}
