/**
 * The four-stage far-field front-end (ADR-001), driven by the module specs.
 *
 * Order is fixed: AEC -> BSS -> NS -> KWS. Each stage's identity comes from
 * its owning module spec (afe/aec, afe/bss, afe/graph (NS via rnnoise),
 * kws-engine) rather than hand-maintained marketing strings - the specs are
 * the single source of truth (ADR-025). The status is a console-level
 * progress flag (not part of any spec).
 */

import type { ModuleSpec } from '@wake-studio/contracts'
import afeGraphSpec from '@wake-studio/module-afe-graph/spec'
import kwsEngineSpec from '@wake-studio/module-kws-engine/spec'

export type StageId = 'aec' | 'bss' | 'ns' | 'kws'

export interface PipelineStage {
  id: StageId
  abbr: string
  /** Stage name from the owning module spec meta.name. */
  name: string
  /** Short role blurb (console-level copy; module specs own the details). */
  role: string
  browserRuntime: string
  exportRuntime: string
  status: 'pending' | 'in-progress' | 'done'
}

/** Resolve a spec's meta.name; falls back to a plain label for stages that
 *  share a spec (NS uses the rnnoise module's spec, which is afe-category). */
function stageName(spec: ModuleSpec, fallback: string): string {
  const name = spec?.meta?.name
  return typeof name === 'string' && name.length > 0 ? name : fallback
}

const afeSpec = afeGraphSpec as unknown as ModuleSpec
const kwsSpec = kwsEngineSpec as unknown as ModuleSpec

/** The four-stage pipeline (ADR-001). Order is fixed. */
export const PIPELINE: readonly PipelineStage[] = [
  {
    id: 'aec',
    abbr: 'AEC',
    name: stageName(afeSpec, 'AEC'),
    role: 'Removes loudspeaker / echo feedback from the microphone signal.',
    browserRuntime: 'Passthrough (v1) · AEC3 deferred to v1.x',
    exportRuntime: 'WebRTC audio_processing / SpeexDSP',
    status: 'in-progress',
  },
  {
    id: 'bss',
    abbr: 'BSS',
    name: stageName(afeSpec, 'BSS'),
    role: 'Separates the target source from a mixture without a known mixing model.',
    browserRuntime: '2-mic beamforming approximation',
    exportRuntime: 'Vendor BSS (ESP-SR) / portable ICA',
    status: 'pending',
  },
  {
    id: 'ns',
    abbr: 'NS',
    name: 'NS',
    role: 'Spectral post-filter that suppresses stationary / non-stationary noise.',
    browserRuntime: 'RNNoise (WASM, AudioWorklet) · vendored prebuilt',
    exportRuntime: 'RNNoise (C) / vendor Deep NS',
    status: 'in-progress',
  },
  {
    id: 'kws',
    abbr: 'KWS',
    name: stageName(kwsSpec, 'KWS'),
    role: 'Detects the wake word and raises a trigger.',
    browserRuntime: 'onnxruntime-web (WebGPU / WASM) · Web Worker',
    exportRuntime: 'TFLite-Micro / ONNX Runtime',
    status: 'in-progress',
  },
]
