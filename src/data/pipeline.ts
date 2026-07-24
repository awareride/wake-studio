export type StageId = 'aec' | 'bss' | 'ns' | 'kws'

export interface PipelineStage {
  id: StageId
  abbr: string
  name: string
  role: string
  browserRuntime: string
  exportRuntime: string
  status: 'pending' | 'in-progress' | 'done'
}

/**
 * The four-stage far-field voice front-end (ADR-001).
 * Order is fixed: AEC -> BSS -> NS -> KWS.
 */
export const PIPELINE: readonly PipelineStage[] = [
  {
    id: 'aec',
    abbr: 'AEC',
    name: 'Acoustic Echo Cancellation',
    role: 'Removes loudspeaker / echo feedback from the microphone signal.',
    browserRuntime: 'WebRTC AEC3 (WASM)',
    exportRuntime: 'WebRTC audio_processing / SpeexDSP',
    status: 'pending',
  },
  {
    id: 'bss',
    abbr: 'BSS',
    name: 'Blind Source Separation',
    role: 'Separates the target source from a mixture without a known mixing model.',
    browserRuntime: '2-mic beamforming approximation',
    exportRuntime: 'Vendor BSS (ESP-SR) / portable ICA',
    status: 'pending',
  },
  {
    id: 'ns',
    abbr: 'NS',
    name: 'Noise Suppression',
    role: 'Spectral post-filter that suppresses stationary / non-stationary noise.',
    browserRuntime: 'RNNoise (WASM, AudioWorklet)',
    exportRuntime: 'RNNoise (C) / vendor Deep NS',
    status: 'pending',
  },
  {
    id: 'kws',
    abbr: 'KWS',
    name: 'Keyword Spotting',
    role: 'Detects the wake word and raises a trigger.',
    browserRuntime: 'onnxruntime-web (WebGPU / WASM)',
    exportRuntime: 'TFLite-Micro / ONNX Runtime',
    status: 'pending',
  },
]
