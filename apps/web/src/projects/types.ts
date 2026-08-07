/**
 * Project model - the unit of work in the WakeStudio console.
 *
 * A project captures everything needed to reproduce a wake-word effort:
 * the target word, target domain/chip, config snapshots for each pipeline
 * stage, enrolled samples, built prototypes, and an export record (Phase 4).
 *
 * Phase 2 scope: minimal model (config snapshots + samples + prototype ids);
 * CRUD UI arrives with the workspace store. Persisted in IndexedDB via
 * `store.ts` (generalizing the Few-Shot storage).
 */

import type { AFEConfig } from '@wake-studio/module-afe-graph'
import type { KWSConfig } from '@wake-studio/module-kws-engine'
import type { FewShotConfig } from '@wake-studio/module-few-shot'
import type { WorkspaceConfig } from '../workspace/types'

/** Target domain (mirrors the two-domain split in README / Domains). */
export type ProjectDomain = 'low-power-mcu' | 'high-performance'

/** Pipeline stage config snapshots (typed defaults from each module). */
export interface ProjectConfigSnapshot {
  afe: AFEConfig
  kws: KWSConfig
  fewShot: FewShotConfig
  /**
   * Workspace-level config (epic #53): component toggles, input source,
   * KWS preload, per-stage persistence. Optional so existing IndexedDB
   * projects load unchanged; filled by defaultConfigSnapshot() on new
   * projects and merged by the workspace view on read.
   */
  workspace?: WorkspaceConfig
}

export interface WakeWordProject {
  id: string
  name: string
  /** The wake word this project targets (free text for v1). */
  targetWord: string
  domain: ProjectDomain
  /** Optional target chip hint (e.g. 'esp32-s3', 'rpi4', 'linux-x64'). */
  targetChip?: string
  config: ProjectConfigSnapshot
  /** Enrolled sample ids (audio lives in the samples store). */
  sampleIds: string[]
  /** Built prototype ids. */
  prototypeIds: string[]
  /** Optional free-form notes. */
  notes?: string
  createdAtMs: number
  updatedAtMs: number
}

/** A draft project (pre-persistence); id/createdAt assigned on save. */
export interface ProjectDraft {
  name: string
  targetWord: string
  domain: ProjectDomain
  targetChip?: string
  notes?: string
}

export const PROJECT_DOMAINS: ReadonlyArray<{ value: ProjectDomain; label: string }> = [
  { value: 'low-power-mcu', label: 'Low-power / MCU' },
  { value: 'high-performance', label: 'High-performance (Linux / Pi / Android)' },
]

export const DEFAULT_PROJECT_NAME = 'Untitled project'
