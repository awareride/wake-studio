/**
 * New project dialog (epic #53 P6).
 *
 * Shared by the ProjectBar (workspace header) and the TopBar "Recent
 * projects" dropdown so both open the exact same create flow. The dialog
 * fields + texts are e2e-pinned (smoke: "Project name" / "Wake word" /
 * "Create") — do not rename them.
 */

import * as React from 'react'
import { Button, TextField } from '@radix-ui/themes'
import { useProjects, PROJECT_DOMAINS } from '../projects'
import type { ProjectDomain } from '../projects'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui'
import { useToast } from './toast'

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
            <TextField.Root
              className="mt-1"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="e.g. Hey Studio"
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-2">Wake word</span>
            <TextField.Root
              className="mt-1"
              value={draft.targetWord}
              onChange={(e) => setDraft((d) => ({ ...d, targetWord: e.target.value }))}
              placeholder="e.g. hey studio"
            />
          </label>
          <label className="block text-sm">
            <span className="text-ink-2">Domain</span>
            <select
              value={draft.domain}
              onChange={(e) => setDraft((d) => ({ ...d, domain: e.target.value as ProjectDomain }))}
              className="mt-1 w-full rounded-md border border-line bg-surface-3 px-2.5 py-1.5 text-sm text-ink-1 outline-none focus-visible:ring-2 focus-visible:ring-brand-8"
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
            <TextField.Root
              className="mt-1"
              value={draft.targetChip}
              onChange={(e) => setDraft((d) => ({ ...d, targetChip: e.target.value }))}
              placeholder="e.g. rpi4, esp32-s3, linux-x64"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            onClick={() => onOpenChange(false)}
            variant="outline"
            size="2"
          >
            Cancel
          </Button>
          <Button
            onClick={submitCreate}
            disabled={busy}
            size="2"
          >
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
