/**
 * AFE module - default configuration and parameter descriptors.
 *
 * The parameter descriptors feed the Studio config panel (ADR-017).
 * Defaults are chosen so the pipeline works out-of-the-box.
 */

import type { AFEConfig, ParameterDescriptor } from './types'

/** The internal AFE DSP sample rate (48 kHz so RNNoise's 480-sample frame = 10 ms). */
export const INTERNAL_SAMPLE_RATE = 48000

/** The KWS output sample rate (ADR-001). */
export const OUTPUT_SAMPLE_RATE = 16000

/** RNNoise requires exactly 480 float32 samples per frame (10 ms at 48 kHz). */
export const RNNOISE_FRAME_SIZE = 480

/** AudioWorklet render quantum size (always 128). */
export const QUANTUM_SIZE = 128

/** Downsample ratio: 48 kHz -> 16 kHz = 3:1. */
export const DOWNSAMPLE_RATIO = INTERNAL_SAMPLE_RATE / OUTPUT_SAMPLE_RATE

/** LCM(128, 480) = 1920 - the circular buffer size that avoids split residues. */
export const CIRCULAR_BUFFER_SIZE = lcm(QUANTUM_SIZE, RNNOISE_FRAME_SIZE)

function gcd(a: number, b: number): number {
  while (b !== 0) {
    ;[a, b] = [b, a % b]
  }
  return a
}

function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b)
}

/** Default AFE configuration (ADR-016/017). */
export const DEFAULT_CONFIG: AFEConfig = {
  topology: 'single-worklet',
  channels: 1,
  frameMs: { aec: 10, bss: 10, ns: 10 },
  latencyBudgetMs: 150,
  vizFps: 30,
}

/**
 * Declare all tunable AFE parameters for the Studio config panel (ADR-017).
 * The UI renders controls generically from these descriptors.
 */
export function describeParameters(): ReadonlyArray<ParameterDescriptor> {
  return [
    {
      id: 'topology',
      label: 'Topology',
      type: 'select',
      default: 'single-worklet',
      options: [
        { value: 'single-worklet', label: 'Single worklet (default)' },
        { value: 'node-per-stage', label: 'Node per stage' },
      ],
      description:
        'AFE DSP topology (ADR-016). Single-worklet is implemented for v1; node-per-stage is a future option.',
    },
    {
      id: 'vizFps',
      label: 'Visualization FPS',
      type: 'number',
      default: 30,
      min: 15,
      max: 60,
      step: 5,
      unit: 'fps',
      description: 'Throttle for visualization frame emission.',
    },
    {
      id: 'latencyBudgetMs',
      label: 'Latency budget',
      type: 'number',
      default: 150,
      min: 50,
      max: 500,
      step: 10,
      unit: 'ms',
      description: 'End-to-end capture -> display target (R5).',
    },
    {
      id: 'bypass.aec',
      label: 'Bypass AEC',
      type: 'boolean',
      default: true,
      description:
        'Bypass AEC (passthrough for v1; WebRTC AEC3 deferred to v1.x, ADR-016).',
    },
    {
      id: 'bypass.bss',
      label: 'Bypass BSS',
      type: 'boolean',
      default: true,
      description:
        'Bypass BSS (single-mic passthrough for v1, ADR-016).',
    },
    {
      id: 'bypass.ns',
      label: 'Bypass NS',
      type: 'boolean',
      default: false,
      description:
        'Bypass RNNoise noise suppression (copy through unprocessed).',
    },
  ]
}
