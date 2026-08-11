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
import { getPlixEncoderVariant } from '../encoders/plix-encoder'
import type { WakeWordPrototype } from './prototype'
import plixSpec from '../spec/module.spec.json'

export { PlixKwsBackend } from './backend'
export { PlixKwsEmbedProvider } from '../encoders/plixkws-embed'
export {
  type WakeWordPrototype,
  meanPool,
  plixScore,
  squaredEuclidean,
  l2Normalize,
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
        opts?: {
          windowMs?: number
          useNegative?: boolean
          /** RMS (dBFS) floor below which windows score 0 (silence gate). */
          silenceFloorDbfs?: number
        },
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
        opts?.silenceFloorDbfs,
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
  // Few-Shot encoder model role (ADR-024): the Model-source editor is
  // rendered from this; the URL mapping below lives in the driver.
  modelRoles: [
    { role: 'plix-encoder', label: 'PLiX encoder', fallbackId: 'plixkws' },
  ],
  // Few-Shot encoder URL resolution. The encoder variant + runtime are the
  // driver's spec params (ADR-025) and the variant->asset mapping lives in
  // the encoder module, so the host never names a PLiX variant or asset.
  resolveModelUrls: (ctx) => {
    const variant = getPlixEncoderVariant(
      (ctx.driverValues.encoder as 'base' | 'small' | undefined) ?? 'small',
    )
    if (!variant) {
      throw new Error(`Unknown PLiX variant: ${String(ctx.driverValues.encoder)}`)
    }
    const rt =
      (ctx.driverValues.runtime as 'onnx' | 'transformers' | undefined) ?? 'onnx'
    const selected = ctx.modelSources['plix-encoder']
    const customUrl =
      selected === 'custom' ? ctx.customUrls['plix-encoder']?.trim() : undefined
    let url: string
    if (rt === 'transformers') {
      url = variant.transformersLocalDir
    } else if (selected?.startsWith('user:')) {
      // User-library encoder (imported file / training artifact).
      const blobUrl = ctx.userBlobUrls['plix-encoder']
      if (!blobUrl) {
        throw new Error('Selected PLiX encoder is not in the model library.')
      }
      url = blobUrl
    } else if (customUrl) {
      // User-supplied encoder URL overrides the built-in variant asset.
      url = customUrl
    } else {
      url = variant.onnxUrl
    }
    return { plixkws: url, runtime: rt }
  },
  // Engine-card resources (ADR-024): the encoder model plus the persisted
  // enrollment artifacts. The data rows read the host-provided saved summary.
  resources: [
    { id: 'encoder', label: 'PLiX encoder', kind: 'model', urlKey: 'plixkws' },
    {
      id: 'prototypes',
      label: 'Enrolled prototypes',
      kind: 'data',
      state: (ctx) => {
        const protos = ctx.saved.prototypes as
          | Array<{ word?: string }>
          | undefined
        const words = (protos ?? [])
          .map((p) => p.word)
          .filter((w): w is string => Boolean(w))
        return { ready: words.length > 0, detail: words.join(', ') || 'none saved' }
      },
    },
    {
      id: 'samples',
      label: 'Enrolled samples',
      kind: 'data',
      state: (ctx) => ({
        ready: Number(ctx.saved.sampleCount) > 0,
        detail: `${Number(ctx.saved.sampleCount) || 0} sample(s) saved`,
      }),
    },
  ],
})
