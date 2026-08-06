/**
 * Project context - the current project + CRUD surface for the workspace.
 *
 * Wraps the IndexedDB store so any view (project bar, pipeline canvas, config
 * panels) reads/writes the same project. Phase 2 scope: create/select/save;
 * delete + rename arrive with the fuller CRUD UI.
 */

import * as React from 'react'
import type { WakeWordProject, ProjectDraft, ProjectConfigSnapshot } from './types'
import { DEFAULT_PROJECT_NAME } from './types'
import { DEFAULT_CONFIG as AFE_DEFAULTS } from '@wake-studio/module-afe-graph'
import { DEFAULT_CONFIG as KWS_DEFAULTS } from '@wake-studio/module-kws-engine'
import { DEFAULT_CONFIG as FS_DEFAULTS } from '@wake-studio/module-few-shot'
import { listProjects, saveProject } from './store'

const LAST_PROJECT_KEY = 'wake-studio:last-project'

function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function defaultConfigSnapshot(): ProjectConfigSnapshot {
  return {
    afe: { ...AFE_DEFAULTS },
    kws: { ...KWS_DEFAULTS },
    fewShot: { ...FS_DEFAULTS },
  }
}

interface ProjectContextValue {
  projects: WakeWordProject[]
  current: WakeWordProject | null
  /** Load projects from the store (once on mount, then on demand). */
  refresh: () => Promise<void>
  /** Create a new project from a draft and select it. */
  createProject: (draft: ProjectDraft) => Promise<WakeWordProject>
  selectProject: (id: string) => void
  /** Persist the current project (config snapshot + metadata). */
  saveCurrent: (patch?: Partial<WakeWordProject>) => Promise<void>
  busy: boolean
}

const ProjectContext = React.createContext<ProjectContextValue | null>(null)

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = React.useState<WakeWordProject[]>([])
  const [current, setCurrent] = React.useState<WakeWordProject | null>(null)
  const [busy, setBusy] = React.useState(false)

  const refresh = React.useCallback(async () => {
    try {
      const all = await listProjects()
      setProjects(all)
      // Keep the current selection if it still exists; otherwise restore the
      // last-selected project (persisted across reloads).
      setCurrent((prev) => {
        if (prev) {
          const found = all.find((p) => p.id === prev.id)
          return found ? { ...found } : null
        }
        const lastId = localStorage.getItem(LAST_PROJECT_KEY)
        const found = lastId ? all.find((p) => p.id === lastId) : undefined
        return found ? { ...found } : null
      })
    } catch (err) {
      console.error('[projects] refresh failed:', err)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const createProject = React.useCallback(
    async (draft: ProjectDraft): Promise<WakeWordProject> => {
      const now = Date.now()
      const project: WakeWordProject = {
        id: uid(),
        name: draft.name.trim() || DEFAULT_PROJECT_NAME,
        targetWord: draft.targetWord.trim(),
        domain: draft.domain,
        targetChip: draft.targetChip?.trim() || undefined,
        notes: draft.notes?.trim() || undefined,
        config: defaultConfigSnapshot(),
        sampleIds: [],
        prototypeIds: [],
        createdAtMs: now,
        updatedAtMs: now,
      }
      setBusy(true)
      try {
        await saveProject(project)
        localStorage.setItem(LAST_PROJECT_KEY, project.id)
        setProjects((prev) => [project, ...prev])
        setCurrent(project)
        return project
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const selectProject = React.useCallback((id: string) => {
    localStorage.setItem(LAST_PROJECT_KEY, id)
    setCurrent((prev) => {
      if (prev && prev.id === id) return prev
      const found = projects.find((p) => p.id === id)
      return found ? { ...found } : prev
    })
  }, [projects])

  const saveCurrent = React.useCallback(
    async (patch?: Partial<WakeWordProject>) => {
      setCurrent((prev) => {
        if (!prev) return prev
        const next = { ...prev, ...patch, updatedAtMs: Date.now() }
        void saveProject(next)
        setProjects((all) =>
          all.map((p) => (p.id === next.id ? next : p)).sort((a, b) => b.updatedAtMs - a.updatedAtMs),
        )
        return next
      })
    },
    [],
  )

  return (
    <ProjectContext.Provider
      value={{ projects, current, refresh, createProject, selectProject, saveCurrent, busy }}
    >
      {children}
    </ProjectContext.Provider>
  )
}

export function useProjects(): ProjectContextValue {
  const ctx = React.useContext(ProjectContext)
  if (!ctx) throw new Error('useProjects must be used within ProjectProvider')
  return ctx
}
