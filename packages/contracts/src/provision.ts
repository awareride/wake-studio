/**
 * Provisioning contract (ADR-033) - pure data types, no engine imports.
 *
 * Producing "the wake-word artifact a backend needs" is one abstract behavior
 * with different input collection per driver:
 *
 *   | kind       | backend example | input (collect)      | artifact           |
 *   |------------|-----------------|----------------------|--------------------|
 *   | prototype  | plixkws         | mic recordings       | prototype vector(s)|
 *   | list       | sherpa-onnx-kws | keyword text         | keyword list       |
 *   | train      | openwakeword    | dataset -> train-runner | classifier onnx |
 *
 * These payloads are the wire + persistence form (Float32Array -> number[]),
 * shared by hosts, driver modules and the future train-runner (Phase 5).
 *
 * @see DECISIONS.md ADR-033
 */

/** Which kind of wake-word artifact a backend provisions. Extensible. */
export type ProvisionKind = 'prototype' | 'list' | 'train'

/** Serialized few-shot prototype (enrollment output; number[] = wire form). */
export interface ProvisionPrototypePayload {
  id: string
  word: string
  vector: number[]
  /** Negative-class prototype (open-set rejection, issue #69). */
  negativeVector?: number[]
  /** Ids of the enrolled sample clips that produced this prototype. */
  sampleIds: string[]
  createdAtMs: number
}

/** Keyword-list artifact (e.g. sherpa-onnx-kws keyword list). */
export interface ProvisionListPayload {
  /**
   * Driver-formatted keyword text. sherpa expects one
   * `spaced tokens @display name` per line; other list drivers define their
   * own format in their capability spec.
   */
  keywords: string
}

/**
 * Training artifact (declared for Phase 5; no driver implements it yet).
 * A trained model's URLs plus an optional registry entry to upsert (ADR-027).
 */
export interface ProvisionTrainPayload {
  /** Artifact URLs produced by training (e.g. classifier onnx, manifest). */
  urls: Record<string, string>
  /** Optional model-registry entry id to upsert (ADR-027). */
  registryEntry?: string
}

/** The artifact a provisioning capability produces. */
export type ProvisionArtifact =
  | { kind: 'prototype'; backendId: string; payload: ProvisionPrototypePayload }
  | { kind: 'list'; backendId: string; payload: ProvisionListPayload }
  | { kind: 'train'; backendId: string; payload: ProvisionTrainPayload }

/**
 * Narrow a provision artifact to a specific kind. Hosts use this to read the
 * typed payload (e.g. for persistence) without importing any driver module.
 */
export function isProvisionArtifactKind<K extends ProvisionKind>(
  artifact: ProvisionArtifact,
  kind: K,
): artifact is Extract<ProvisionArtifact, { kind: K }> {
  return artifact.kind === kind
}
