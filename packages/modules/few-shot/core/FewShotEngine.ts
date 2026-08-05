/**
 * Few-Shot engine - enrollment + prototype management controller.
 *
 * Wraps the KWS module's `embed()` for sample embedding, builds prototypes
 * (mean-pool), and persists them to IndexedDB. Live detection is delegated to
 * the KWS worker via a `PlixKwsBackend` adapter (ADR-020).
 *
 * Per ADR-013 amendment: prototype computation + cosine scoring are
 * enrollment/inference, not training - they stay 100% client-side.
 *
 * @see docs/modules/few-shot.md §4-§5
 */

import type { KWSEngine } from '@wake-studio/module-kws-engine'
import type { FewShotConfig, EnrolledSample, WakeWordPrototype } from './types'
import type { ParameterDescriptor } from './types'
import { DEFAULT_CONFIG } from './defaults'
import { describeParameters } from './defaults'
import { meanPool } from './dsp'
import { checkSampleQuality } from './dsp'
import {
  savePrototype,
  listPrototypes,
  deletePrototype,
  saveSample,
  deleteSample,
} from './storage'

/** Generate a unique id (crypto.randomUUID with fallback). */
function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export class FewShotEngine {
  private _kws: KWSEngine
  private _config: FewShotConfig = { ...DEFAULT_CONFIG }

  constructor(kws: KWSEngine) {
    this._kws = kws
  }

  get encoderReady(): boolean {
    return this._kws.ready
  }

  /** Ensure the PLiX encoder is loaded (delegates to the KWS engine). */
  async loadEncoder(): Promise<void> {
    // The KWS engine's load() must have been called with a plixkws URL.
    // If already loaded, this is a no-op (KWSEngine.load guards re-entry).
    if (this.encoderReady) return
    // The caller is responsible for calling kws.load() with the plixkws URL first.
    // This method just checks readiness.
    throw new Error(
      'PLiX encoder not loaded. Call KWSEngine.load() with a plixkws URL first.',
    )
  }

  /** Embed a recorded sample and compute its quality metrics. */
  async embedSample(
    samples: Float32Array,
    sampleRate: number,
  ): Promise<EnrolledSample> {
    if (!this.encoderReady) {
      throw new Error('PLiX encoder not ready.')
    }
    const embedding = await this._kws.embed(samples, sampleRate)
    const quality = checkSampleQuality(samples, sampleRate)
    return {
      id: uid(),
      samples,
      sampleRate,
      embedding,
      quality,
      recordedAtMs: Date.now(),
    }
  }

  /** Build a prototype from enrolled samples (mean-pool their embeddings). */
  buildPrototype(word: string, samples: EnrolledSample[]): WakeWordPrototype {
    if (samples.length === 0) {
      throw new Error('Cannot build a prototype from zero samples.')
    }
    const embeddings = samples.map((s) => s.embedding)
    const vector = meanPool(embeddings)
    return {
      id: uid(),
      word,
      vector,
      sampleIds: samples.map((s) => s.id),
      createdAtMs: Date.now(),
    }
  }

  /** Persist a prototype + its samples to IndexedDB. */
  async savePrototype(
    proto: WakeWordPrototype,
    samples: EnrolledSample[],
  ): Promise<void> {
    await savePrototype(proto)
    for (const s of samples) {
      await saveSample(s)
    }
  }

  /** List stored prototypes. */
  async listPrototypes(): Promise<WakeWordPrototype[]> {
    return listPrototypes()
  }

  /** Delete a prototype + its samples. */
  async deletePrototype(id: string, sampleIds: string[]): Promise<void> {
    await deletePrototype(id)
    for (const sid of sampleIds) {
      await deleteSample(sid)
    }
  }

  get config(): FewShotConfig {
    return this._config
  }

  setConfig(patch: Partial<FewShotConfig>): void {
    this._config = { ...this._config, ...patch }
  }

  describeParameters(): ReadonlyArray<ParameterDescriptor> {
    return describeParameters()
  }
}
