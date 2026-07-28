/**
 * KWS module - default configuration and parameter descriptors.
 *
 * The parameter descriptors feed the Studio config panel (ADR-017).
 */

import type { KWSConfig, ParameterDescriptor } from './types'

/** The melspectrogram window size in samples (80 ms @ 16 kHz). */
export const MEL_WINDOW_SIZE = 1280

/** The melspectrogram hop size in samples (10 ms @ 16 kHz = 1 AFE frame). */
export const MEL_HOP_SIZE = 160

/** Audio overlap (samples) fed to the mel model for streaming frame-rate
 *  consistency with openWakeWord (160*3 = 480). Each 1280-sample chunk uses
 *  the previous 480 samples as context, yielding ~8 mel frames per chunk. */
export const MEL_OVERLAP = 480

/** Default KWS configuration (ADR-018, ADR-020). */
export const DEFAULT_CONFIG: KWSConfig = {
  backend: 'openwakeword',
  threshold: 0.5,
  minDurationMs: 300,
  smoothingWindowFrames: 5,
  vadGateEnabled: true,
  vadThreshold: 0.3,
  cooldownMs: 2000,
  executionProvider: 'webgpu',
}

/**
 * Declare all tunable KWS parameters for the Studio config panel (ADR-017).
 */
export function describeParameters(): ReadonlyArray<ParameterDescriptor> {
  return [
    {
      id: 'backend',
      label: 'KWS backend',
      type: 'select',
      default: 'openwakeword',
      options: [
        { value: 'openwakeword', label: 'OpenWakeWord (available)' },
        { value: 'microwakeword', label: 'micro-wake-word (MCU / Phase 5)' },
        { value: 'wavlm-few-shot', label: 'WavLM Few-Shot (Phase 3)' },
        { value: 'pocketsphinx', label: 'PocketSphinx (pending)' },
      ],
      description:
        'Pluggable KWS backend (ADR-020). Only openwakeword is browser-feasible in v1; the others are registered for the device SDK (ADR-021) and later phases.',
    },
    {
      id: 'threshold',
      label: 'Trigger threshold',
      type: 'number',
      default: 0.5,
      min: 0,
      max: 1,
      step: 0.05,
      description: 'Smoothed score must exceed this to trigger.',
    },
    {
      id: 'minDurationMs',
      label: 'Min. duration',
      type: 'number',
      default: 300,
      min: 100,
      max: 3000,
      step: 100,
      unit: 'ms',
      description: 'Score must exceed threshold for this long to trigger.',
    },
    {
      id: 'smoothingWindowFrames',
      label: 'Smoothing window',
      type: 'number',
      default: 5,
      min: 1,
      max: 30,
      step: 1,
      unit: 'frames',
      description: 'Sliding-window size for max-pooling (~10 ms/frame).',
    },
    {
      id: 'vadGateEnabled',
      label: 'VAD gate',
      type: 'boolean',
      default: true,
      description:
        'Suppress triggers (not inference) when VAD < threshold. Keeps the audio window current so wake-word onset is not lost.',
    },
    {
      id: 'vadThreshold',
      label: 'VAD threshold',
      type: 'number',
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.05,
      description: 'VAD probability below which KWS is gated.',
    },
    {
      id: 'cooldownMs',
      label: 'Cooldown',
      type: 'number',
      default: 2000,
      min: 500,
      max: 10000,
      step: 500,
      unit: 'ms',
      description: 'Minimum time between triggers.',
    },
    {
      id: 'executionProvider',
      label: 'Execution provider',
      type: 'select',
      default: 'webgpu',
      options: [
        { value: 'webgpu', label: 'WebGPU (faster)' },
        { value: 'wasm', label: 'WASM (universal)' },
      ],
      description:
        'WebGPU first with WASM fallback (ADR-018). Override here if needed.',
    },
  ]
}
