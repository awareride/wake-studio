/**
 * Training history — the persistent history rail (issue #105).
 *
 * Pure model + derivation helpers for the jobs the console's history rail
 * lists (status / params / backend / timestamps / artifact ref). Persistence
 * lives in history-store.ts (IndexedDB); this module keeps the shape and the
 * derivation rules headless and L1-testable.
 */

import type { TrainingJob } from './job'
import type { ArtifactBundleMetadata, ArtifactProvenance } from './manifest'

/** A past training job shown in the history rail. */
export interface HistoryJob {
  /** Stable id (the run's job id, or a generated id for imports). */
  id: string
  /** Lifecycle status, shared with TrainingJob (ADR-013). */
  status: TrainingJob['status']
  /** The wake phrase trained ('' when unknown). */
  phrase: string
  /** Snapshot of the params the job ran with. */
  params: Record<string, string>
  backend: TrainingJob['backend']
  startedAtMs: number
  finishedAtMs?: number
  /** Artifact reference for in-browser test (`user:<modelId>` classifier ref). */
  artifactRef?: string
  /** Trained-model metrics (recall/accuracy/…) from the bundle. */
  metrics?: Record<string, number>
  /** Provenance license of the produced model ('user-owned' = exportable). */
  license?: string
  error?: string
}

/** Inputs for recording a run that just started ("Start training"). */
export interface StartedJobInput {
  id: string
  backend: TrainingJob['backend']
  params: Record<string, string>
  startedAtMs?: number
}

/** A job that just started: queued, no artifact yet. */
export function startedJob(input: StartedJobInput): HistoryJob {
  const now = input.startedAtMs ?? Date.now()
  return {
    id: input.id,
    status: 'queued',
    phrase: String(input.params.wakePhrase ?? ''),
    params: input.params,
    backend: input.backend,
    startedAtMs: now,
  }
}

/** Inputs for recording a successful Colab bundle import (issue #97). */
export interface ImportedJobInput {
  jobId: string
  metadata: ArtifactBundleMetadata
  provenance: ArtifactProvenance
  metrics?: Record<string, number>
  classifierRef: string
  importedAtMs?: number
}

/** A job derived from a successful Colab import (succeeded, artifact ref). */
export function importedJob(input: ImportedJobInput): HistoryJob {
  const now = input.importedAtMs ?? Date.now()
  return {
    id: input.jobId,
    status: 'succeeded',
    phrase: String(input.metadata.params.wakePhrase ?? ''),
    params: input.metadata.params,
    backend: input.metadata.backend,
    startedAtMs: input.metadata.trainedAtMs ?? now,
    finishedAtMs: now,
    artifactRef: input.classifierRef,
    metrics: input.metrics,
    license: input.provenance.license,
  }
}

/** Newest first (the rail's default order). */
export function sortJobsNewestFirst(jobs: readonly HistoryJob[]): HistoryJob[] {
  return [...jobs].sort((a, b) => b.startedAtMs - a.startedAtMs)
}

/** Insert or replace a job by id, preserving rail order. */
export function upsertJob(
  jobs: readonly HistoryJob[],
  job: HistoryJob,
): HistoryJob[] {
  return sortJobsNewestFirst([
    job,
    ...jobs.filter((existing) => existing.id !== job.id),
  ])
}