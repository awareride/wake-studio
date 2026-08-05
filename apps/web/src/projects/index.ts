/**
 * Projects - public exports.
 */

export {
  DEFAULT_PROJECT_NAME,
  PROJECT_DOMAINS,
} from './types'
export type {
  ProjectConfigSnapshot,
  ProjectDomain,
  ProjectDraft,
  WakeWordProject,
} from './types'
export {
  clearProjects,
  deleteProject,
  getProject,
  listProjects,
  saveProject,
} from './store'
export { ProjectProvider, useProjects, defaultConfigSnapshot } from './context'
export { useProjectStageConfig, type ProjectStage } from './useProjectStageConfig'
