/**
 * Training history — the train list + news feed (issue #105).
 *
 * Pure model + derivation helpers for the jobs the console's train list and
 * news feed show (status / module / method / params / timestamps / artifact
 * ref). Persistence lives in history-store.ts (IndexedDB); this module keeps
 * the shape and the derivation rules headless and L1-testable.
 */

import type { TrainingJob } from './job'
import type { TrainMethodId } from './methods'
import type { ArtifactBundleMetadata, ArtifactProvenance } from './manifest'

/** A past training job shown in the train list. */
export interface HistoryJob {
  /** Stable id (the run's job id, or a generated id for imports). */
  id: string
  /** Lifecycle status, shared with TrainingJob (ADR-013). */
  status: TrainingJob['status']
  /** The wake phrase trained ('' when unknown). */
  phrase: string
  /** The trainable module being trained (spec meta.id, e.g. kws-openwakeword). */
  moduleId: string
  /** The train method (from the module's spec.train.invocation). */
  method: TrainMethodId
  /** Snapshot of the params the job ran with. */
  params: Record<string, string>
  /** Backend (ADR-013 contract value) the job ran on. */
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
  moduleId: string
  method: TrainMethodId
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
    moduleId: input.moduleId,
    method: input.method,
    backend: input.backend,
    startedAtMs: now,
  }
}

/** Map an artifact-bundle backend to a train method id. */
export function backendToMethod(backend: TrainingJob['backend']): TrainMethodId {
  switch (backend) {
    case 'colab':
      return 'colab'
    case 'self-hosted':
      return 'subprocess'
    default:
      return 'ci'
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
    moduleId: input.metadata.moduleId,
    method: backendToMethod(input.metadata.backend),
    backend: input.metadata.backend,
    startedAtMs: input.metadata.trainedAtMs ?? now,
    finishedAtMs: now,
    artifactRef: input.classifierRef,
    metrics: input.metrics,
    license: input.provenance.license,
  }
}

/** Newest first (the train list's default order). */
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

// ---------------------------------------------------------------------------
// Train news feed (tips for the end user, derived from the jobs)
// ---------------------------------------------------------------------------

export interface TrainNewsItem {
  /** Stable id (jobId + event kind). */
  id: string
  jobId: string
  kind: 'started' | 'succeeded' | 'imported' | 'failed' | 'canceled'
  /** Human-readable tip, e.g. "Train “hey studio” succeeded (kws-openwakeword)". */
  message: string
  atMs: number
}

/**
 * Derive the news feed from the recorded jobs: one tip per job reflecting
 * its outcome (queued = started, succeeded with artifact = imported),
 * newest first. No extra storage — the feed is a pure projection.
 */
export function deriveNews(jobs: readonly HistoryJob[]): TrainNewsItem[] {
  const items: TrainNewsItem[] = []
  for (const job of jobs) {
    const phrase = job.phrase ? `“${job.phrase}”` : 'a train'
    const module = job.moduleId
    if (job.status === 'succeeded') {
      items.push({
        id: `${job.id}:succeeded`,
        jobId: job.id,
        kind: job.artifactRef ? 'imported' : 'succeeded',
        message: `Train ${phrase} succeeded${job.artifactRef ? ' and was imported' : ''} (${module})`,
        atMs: job.finishedAtMs ?? job.startedAtMs,
      })
    } else if (job.status === 'failed' || job.status === 'canceled') {
      items.push({
        id: `${job.id}:${job.status}`,
        jobId: job.id,
        kind: job.status,
        message: `Train ${phrase} ${job.status} (${module})`,
        atMs: job.finishedAtMs ?? job.startedAtMs,
      })
    } else {
      items.push({
        id: `${job.id}:started`,
        jobId: job.id,
        kind: 'started',
        message: `Train ${phrase} queued on ${job.method} (${module})`,
        atMs: job.startedAtMs,
      })
    }
  }
  return items.sort((a, b) => b.atMs - a.atMs)
}