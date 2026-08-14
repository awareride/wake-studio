/**
 * Training module - common training-job interface (ADR-013).
 *
 * Backend-agnostic: the PWA presents the same "train a custom word" flow
 * regardless of where compute runs (Self-hosted Service / Cloud Provider /
 * Colab). Contract locked in docs/modules/training.md §2 (human-reviewed).
 * Backend adapters land in goal.plan Phase 5.
 */

/** A training job, shared across all backends. */
export interface TrainingJob {
  id: string
  moduleId: string
  params: Record<string, string>
  backend: 'self-hosted' | 'cloud' | 'colab'
  provider?: string
  status: 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'canceled'
  progress?: number
  artifactBundle?: ArtifactBundleRef
  error?: string
  createdAtMs: number
  updatedAtMs: number
}

/** Reference to a trained-artifact bundle (single retrieval contract, §4). */
export interface ArtifactBundleRef {
  manifestUrl: string
  sha256?: string
}

/** Backend capabilities (ADR-013): train-capable vs inference-only. */
export type BackendCapability = 'train' | 'inference-only'

export interface TrainingBackendDescriptor {
  id: TrainingJob['backend']
  label: string
  capability: BackendCapability
  /** Whether the backend requires user credentials (cloud). */
  requiresCredentials: boolean
}
