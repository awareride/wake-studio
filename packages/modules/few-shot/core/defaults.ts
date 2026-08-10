/**
 * Few-Shot module - default configuration and parameter descriptors (ADR-017).
 */

import type { FewShotConfig, ParameterDescriptor } from './types'

/** Default Few-Shot configuration. */
export const DEFAULT_CONFIG: FewShotConfig = {
  threshold: 0.9,
  minDurationMs: 300,
  cooldownMs: 2000,
  smoothingWindowFrames: 5,
  vadGateEnabled: true,
  vadThreshold: 0.3,
  windowMs: 1500,
  hopMs: 80,
  useNegativePrototype: false,
  /** RMS (dBFS) below which a detection window scores 0 (silence gate). */
  silenceFloorDbfs: -45,
}

/** Declare all tunable Few-Shot parameters for the Studio config panel. */
export function describeParameters(): ReadonlyArray<ParameterDescriptor> {
  return [
    {
      id: 'threshold',
      label: 'Distance threshold',
      type: 'number',
      default: 0.9,
      min: 0.5,
      max: 0.95,
      step: 0.01,
      description:
        'PLiX prototype-distance score (1 / (1 + d^2) on L2-normalized embeddings, rescaled [0,1]) must exceed this to trigger. The enrolled word typically scores 0.9-1.0; other speech 0.7-0.9. Default 0.9 rejects most non-target speech (post-#66 score scale).',
    },
    {
      id: 'minDurationMs',
      label: 'Min. duration',
      type: 'number',
      default: 500,
      min: 100,
      max: 3000,
      step: 100,
      unit: 'ms',
      description: 'Score must exceed threshold for this long to trigger.',
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
      id: 'smoothingWindowFrames',
      label: 'Smoothing window',
      type: 'number',
      default: 10,
      min: 1,
      max: 30,
      step: 1,
      unit: 'frames',
      description: 'Sliding-window size for max-pooling.',
    },
    {
      id: 'windowMs',
      label: 'Detection window',
      type: 'number',
      default: 1500,
      min: 500,
      max: 3000,
      step: 100,
      unit: 'ms',
      description: 'Audio window fed to the PLiX encoder for each embedding.',
    },
    {
      id: 'vadGateEnabled',
      label: 'VAD gate',
      type: 'boolean',
      default: true,
      description: 'Skip inference when VAD < threshold (reuses AFE RNNoise VAD).',
    },
    {
      id: 'vadThreshold',
      label: 'VAD threshold',
      type: 'number',
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.05,
      description: 'VAD probability below which Few-Shot inference is gated.',
    },
    {
      id: 'hopMs',
      label: 'Inference hop',
      type: 'number',
      default: 80,
      min: 40,
      max: 200,
      step: 10,
      unit: 'ms',
      description: 'Interval between PLiX encoder runs (default 80 ms = 8 frames).',
    },
    {
      id: 'useNegativePrototype',
      label: 'Negative prototype',
      type: 'boolean',
      default: false,
      description: 'Subtract the negative prototype for a tighter decision boundary.',
    },
    {
      id: 'silenceFloorDbfs',
      label: 'Silence gate (dBFS RMS)',
      type: 'number',
      default: -45,
      min: -60,
      max: -20,
      step: 1,
      unit: 'dBFS',
      description:
        'Windows at or below this RMS level score 0 (no speech input). Prevents the PLiX model from scoring silence/background near the prototype (false triggers with no word spoken).',
    },
  ]
}
