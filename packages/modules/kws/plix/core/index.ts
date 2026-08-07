/**
 * kws-plix driver module - core exports.
 *
 * Registers the PLiX Few-Shot backend + the embed-provider factory into the
 * KWS engine (ADR-020/024). The backend is created lazily and configured with
 * the prototype at load time via `initWithPrototype` (the prototype comes from
 * enrollment, not from the registry, so it cannot be baked into registration).
 */

import {
  registerKwsBackend,
  registerEmbedProviderFactory,
} from '@wake-studio/module-kws-engine'
import type { EmbedProvider } from '@wake-studio/module-kws-engine'
import type { ModuleSpec } from '@wake-studio/contracts'
import { PlixKwsBackend } from './backend'
import { PlixKwsEmbedProvider } from '../encoders/plixkws-embed'
import type { WakeWordPrototype } from './prototype'
import plixSpec from '../spec/module.spec.json'

export { PlixKwsBackend } from './backend'
export { PlixKwsEmbedProvider } from '../encoders/plixkws-embed'
export {
  type WakeWordPrototype,
  meanPool,
  plixScore,
  squaredEuclidean,
} from './prototype'

// Embed-provider factory: the worker hosts the embed() scaffold via this seam
// without importing the plix module directly (ADR-024).
registerEmbedProviderFactory((url, runtime) => {
  return Promise.resolve(new PlixKwsEmbedProvider(url, runtime as never))
})

// Detection backend: created on demand, configured with the prototype at load.
registerKwsBackend({
  id: 'plixkws',
  label: 'PLiX Few-Shot (prototype distance)',
  category: 'few-shot',
  create: () => {
    const backend = new PlixKwsBackend(
      // The embedProvider is set via initWithPrototype; the constructor's
      // embedProvider is replaced then. Use a placeholder that throws if used
      // before init (the worker always inits before processing).
      null as unknown as EmbedProvider,
      // Placeholder prototype; replaced by initWithPrototype.
      { id: '', word: '', vector: new Float32Array(0), sampleIds: [], createdAtMs: 0 },
    )
    const withInit = backend as PlixKwsBackend & {
      initWithPrototype?: (
        proto: WakeWordPrototype,
        embed: EmbedProvider,
        opts?: { windowMs?: number; useNegative?: boolean },
      ) => void
    }
    withInit.initWithPrototype = (proto, embed, opts) => {
      // Reconstruct the backend with the real provider + prototype. The
      // workspace config (epic #53 P1) may override the hard-coded defaults
      // (1500 ms window / no negative prototype).
      const next = new PlixKwsBackend(
        embed,
        proto,
        opts?.windowMs ?? 1500,
        opts?.useNegative ?? false,
      )
      // Copy state that may already exist (none before load, but stay safe).
      Object.assign(backend, next, {
        _embedProvider: embed,
        _prototype: proto,
        _windowSamples: next['_windowSamples'],
        _ring: next['_ring'],
      })
    }
    return backend
  },
  browserFeasible: true,
  availabilityNote: 'Phase 3 (enrollment required)',
  // The driver's own spec (ADR-025): hosts render its params (encoder)
  // from the registry instead of hard-coding per-backend cases.
  spec: plixSpec as unknown as ModuleSpec,
})
