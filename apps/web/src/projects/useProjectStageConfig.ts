/**
 * Project-config bridge (Phase 2.2).
 *
 * Wires a panel's local config state to the active project's config snapshot:
 *  - initial value comes from the project snapshot (per stage: afe/kws/fewShot)
 *  - changes are written back to the project via saveCurrent (IndexedDB)
 *  - switching projects remounts the panel (via key), so the new snapshot
 *    becomes the initial value.
 *
 * The panel keeps its own state (no controlled refactor); this hook only
 * seeds and syncs.
 */

import * as React from 'react'
import { useProjects } from './context'
import type { ProjectConfigSnapshot } from './types'

/** Stage keys in the project config snapshot. */
export type ProjectStage = keyof ProjectConfigSnapshot

export function useProjectStageConfig<S extends ProjectStage>(
  stage: S,
): {
  /** The stage snapshot from the active project (may be undefined). */
  projectConfig: ProjectConfigSnapshot[S] | undefined
  /** Call with a partial patch to persist into the project. */
  persist: (patch: Partial<ProjectConfigSnapshot[S]>) => void
  /** Whether an active project is selected. */
  hasProject: boolean
} {
  const { current, saveCurrent } = useProjects()

  const projectConfig = current?.config?.[stage]

  const persist = React.useCallback(
    (patch: Partial<ProjectConfigSnapshot[S]>) => {
      if (!current) return
      saveCurrent({
        config: {
          ...current.config,
          [stage]: { ...current.config[stage], ...patch },
        },
      })
    },
    [current, saveCurrent, stage],
  )

  return { projectConfig, persist, hasProject: !!current }
}
