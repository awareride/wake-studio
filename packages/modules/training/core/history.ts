/**
 * Training history — the train list + news feed (issue #105).
 *
 * Pure model + derivation helpers for the jobs the console's train list and
 * news feed show (status / module / method / params / timestamps / artifact
 * ref). Persistence lives in history-store.ts (IndexedDB); this module keeps
 * the shape and the derivation rules headless and L1-testable.
 */

import type { TrainingJob } from './job'
import { normalizeMethod, type TrainMethodId } from './methods'
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
  /**
   * The Colab tunnel URL for this run (generated when the notebook runs,
   * issue #105). User-pasted in the details pane or picked up on import when
   * the notebook wrote it (Cloudflare API in Settings → auto-detect).
   */
  tunnelUrl?: string
  /**
   * The studio-backend endpoint this job is tracked on (ADR-036 §3): the
   * Settings `backend.endpoint` for self-hosted jobs, or the tunnel URL for
   * Colab jobs once connected. When set, the console polls / streams the
   * job and exposes live actions (issue #122).
   */
  endpoint?: string
  /** True once the job has been submitted to its endpoint (POST /jobs). */
  submitted?: boolean
  /** Live progress 0..1 reported by the backend (issue #122). */
  progress?: number
  /** Live metric values reported by the backend (loss etc.). */
  logTail?: string[]
  /** Last checkpoint reported by the backend (resume point). */
  checkpoint?: string
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
      return 'studio-backend'
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
    // Auto-detect: the notebook may have written the tunnel URL into the
    // bundle params (user-provided Cloudflare API in Settings).
    ...(input.metadata.params.tunnelUrl ? { tunnelUrl: input.metadata.params.tunnelUrl } : {}),
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
// Per-job notifications (issue #105 — messages live with the train, not a
// global news feed)
// ---------------------------------------------------------------------------

export interface TrainMessage {
  kind: 'started' | 'succeeded' | 'imported' | 'failed' | 'canceled'
  message: string
  atMs: number
}

/**
 * The messages/notifications for ONE job, chronological: it was recorded,
 * then its outcome (imported results, succeeded, failed…). Shown in the
 * train details pane; the latest one is the note on the train-list item.
 */
export function deriveMessages(job: HistoryJob): TrainMessage[] {
  const messages: TrainMessage[] = []
  const m = normalizeMethod(job.method)
  const method =
    m === 'colab' ? 'Colab' : m === 'studio-backend' ? 'studio-backend' : 'CI'

  messages.push({
    kind: 'started',
    message: `Train saved — ${method} (${job.moduleId})`,
    atMs: job.startedAtMs,
  })

  if (job.status === 'succeeded') {
    messages.push({
      kind: job.artifactRef ? 'imported' : 'succeeded',
      message: job.artifactRef
        ? 'Results imported — the model is ready to test in-browser.'
        : 'Train finished successfully.',
      atMs: job.finishedAtMs ?? job.startedAtMs,
    })
  } else if (job.status === 'failed' || job.status === 'canceled') {
    messages.push({
      kind: job.status,
      message: job.error ? `Train ${job.status}: ${job.error}` : `Train ${job.status}.`,
      atMs: job.finishedAtMs ?? job.startedAtMs,
    })
  }

  return messages.sort((a, b) => a.atMs - b.atMs)
}

/** The latest message for a job (the train-list note), if any. */
export function latestMessage(job: HistoryJob): TrainMessage | undefined {
  const messages = deriveMessages(job)
  return messages[messages.length - 1]
}