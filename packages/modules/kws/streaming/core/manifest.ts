/**
 * kws-streaming - the sidecar manifest that describes an exported model.
 *
 * Upstream (google-research/kws_streaming) supports two inference shapes, and
 * this driver supports both because the available pretrained weights need them:
 *
 *   1. `streaming-external-state` - upstream converts a non-streaming Keras
 *      model into a streaming one by inserting ring buffers into the
 *      time-dimension layers. In the EXTERNAL-state flavour those buffers
 *      become explicit graph inputs/outputs, so the graph is stateless and the
 *      caller carries the state. One packet (e.g. 20 ms) per step.
 *
 *   2. `sliding-window` - the non-streaming graph is run as-is over a sliding
 *      1 s window, re-evaluated every `hopSamples`. This is the only option for
 *      topologies upstream cannot convert to streaming (attention over the
 *      whole sequence: `att_rnn`, `att_mh_rnn`, `kws_transformer`), and it is
 *      what ARM's keyword-transformer checkpoints ship
 *      (`tflite_non_stream/non_stream.tflite` only).
 *
 * Tensor names, shapes, window/packet sizes and labels all differ per topology
 * and per training flags, so the exporter writes this manifest next to the
 * model and the driver reads it. That is what lets ONE driver serve every
 * model family upstream (and ARM) publish.
 *
 * @see docs/modules/kws-streaming.md §4.2
 */

/** Which inference shape the exported graph expects. */
export type KwsStreamingMode = 'streaming-external-state' | 'sliding-window'

/** One streaming state buffer: the graph input, its paired output, its shape. */
export interface KwsStreamingState {
  /** State input tensor name (fed at step N). */
  input: string
  /** State output tensor name (produced at step N, fed as `input` at N+1). */
  output: string
  /** Full tensor shape, e.g. [1, 3, 40]. */
  shape: number[]
}

/** Sidecar manifest for one exported graph. */
export interface KwsStreamingManifest {
  /** Manifest schema version; bumped on breaking changes. */
  version: 1
  /** Inference shape (see {@link KwsStreamingMode}). */
  mode: KwsStreamingMode
  /** Upstream topology name, e.g. 'ds_tc_resnet', 'kws_transformer'. */
  model: string
  /** Human-readable model provenance (repo + checkpoint dir). */
  source: string
  /** Commit/ref the model was exported from. */
  upstreamRef: string
  /** Class labels in output-column order (upstream `labels.txt`). */
  labels: string[]
  /** Default wake word; must be a member of `labels`. */
  wantedWord: string
  /** Sample rate the graph expects (upstream default 16000). */
  sampleRate: number
  /**
   * 'graph'    = upstream `--preprocess raw` (the MFCC/mel front-end is part of
   *              the model; the driver feeds raw audio). Recommended.
   * 'external' = upstream `--preprocess mfcc|micro` (features computed outside
   *              the model). Not supported yet - see Q-KS-2.
   */
  featureExtractor: 'graph' | 'external'
  /** Audio (or feature) input tensor name. */
  audioInput: string
  /** Logits / softmax output tensor name. */
  scoreOutput: string
  /** True when `scoreOutput` is already softmaxed. */
  softmaxed: boolean

  // -- mode: 'streaming-external-state' -------------------------------------
  /**
   * Samples consumed per streaming step. Upstream requires the streaming input
   * length to be aligned with the model's total time stride/pooling, so a
   * partial packet must never be fed. Required for external-state mode.
   */
  packetSamples?: number
  /** Streaming state buffers, in graph order. Required for external-state mode. */
  states?: KwsStreamingState[]

  // -- mode: 'sliding-window' ----------------------------------------------
  /**
   * Full input length the non-streaming graph expects (e.g. 16000 = 1 s at
   * 16 kHz, upstream `clip_duration_ms`). Required for sliding-window mode.
   */
  windowSamples?: number
  /**
   * How often the window is re-evaluated, in samples (e.g. 1600 = every
   * 100 ms). Trades detection latency against CPU. Required for
   * sliding-window mode.
   */
  hopSamples?: number
}

/** Topologies upstream can convert to streaming mode (README model table). */
export const STREAMABLE_MODELS: readonly string[] = [
  'dnn',
  'dnn_raw',
  'gru',
  'lstm',
  'cnn',
  'crnn',
  'ds_cnn',
  'svdf',
  'svdf_resnet',
  'ds_tc_resnet',
  'bc_resnet',
]

/**
 * Topologies that need `sliding-window` mode: they attend or pool over the
 * whole input sequence, so upstream cannot insert streaming ring buffers.
 * Upstream's README marks these "no" / "not converted".
 */
export const NON_STREAMABLE_MODELS: readonly string[] = [
  'att_rnn',
  'att_mh_rnn',
  'kws_transformer',
  'tc_resnet',
  'mobilenet',
  'mobilenet_v2',
  'xception',
  'inception',
  'inception_resnet',
]

/** Thrown when a manifest is malformed or describes an unsupported export. */
export class KwsStreamingManifestError extends Error {
  constructor(message: string) {
    super(`kws-streaming manifest: ${message}`)
    this.name = 'KwsStreamingManifestError'
  }
}

function positiveInt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new KwsStreamingManifestError(`\`${field}\` must be a positive integer`)
  }
  return value
}

/**
 * Validate an untrusted manifest and narrow it to {@link KwsStreamingManifest}.
 *
 * Every rejection here is deliberate: a mis-declared state pair or label order
 * degrades accuracy *silently* at runtime, which is the worst failure mode of
 * external-state streaming. Fail at load, loudly.
 *
 * @see docs/modules/kws-streaming.md §7
 */
export function validateManifest(raw: unknown): KwsStreamingManifest {
  if (typeof raw !== 'object' || raw === null) {
    throw new KwsStreamingManifestError('expected a JSON object')
  }
  const m = raw as Record<string, unknown>

  if (m.version !== 1) {
    throw new KwsStreamingManifestError(
      `unsupported version ${String(m.version)} (this driver reads version 1)`,
    )
  }

  // `mode` defaults to external-state so manifests written before the
  // sliding-window mode existed keep working.
  const mode: KwsStreamingMode =
    m.mode === undefined ? 'streaming-external-state' : (m.mode as KwsStreamingMode)
  if (mode !== 'streaming-external-state' && mode !== 'sliding-window') {
    throw new KwsStreamingManifestError(
      `unknown mode '${String(m.mode)}' (expected 'streaming-external-state' or 'sliding-window')`,
    )
  }

  if (typeof m.model !== 'string' || m.model.length === 0) {
    throw new KwsStreamingManifestError('`model` must be a non-empty string')
  }
  // Streaming mode is only legitimate for topologies upstream can convert;
  // sliding-window mode exists precisely for the ones it cannot.
  if (mode === 'streaming-external-state' && !STREAMABLE_MODELS.includes(m.model)) {
    throw new KwsStreamingManifestError(
      `topology '${m.model}' is not streamable: use mode 'sliding-window', or one of ${STREAMABLE_MODELS.join(', ')}`,
    )
  }

  if (!Array.isArray(m.labels) || m.labels.length === 0) {
    throw new KwsStreamingManifestError('`labels` must be a non-empty array')
  }
  const labels = m.labels as unknown[]
  if (!labels.every((l): l is string => typeof l === 'string')) {
    throw new KwsStreamingManifestError('`labels` must contain only strings')
  }
  if (typeof m.wantedWord !== 'string' || !labels.includes(m.wantedWord)) {
    throw new KwsStreamingManifestError(
      `\`wantedWord\` '${String(m.wantedWord)}' is not one of the labels [${labels.join(', ')}]`,
    )
  }
  if (m.featureExtractor !== 'graph' && m.featureExtractor !== 'external') {
    throw new KwsStreamingManifestError(
      "`featureExtractor` must be 'graph' or 'external'",
    )
  }
  if (m.featureExtractor === 'external') {
    throw new KwsStreamingManifestError(
      "featureExtractor 'external' is not supported yet (Q-KS-2): re-export " +
        'with `--preprocess raw` so the feature extractor is part of the graph',
    )
  }
  if (typeof m.sampleRate !== 'number' || m.sampleRate <= 0) {
    throw new KwsStreamingManifestError('`sampleRate` must be a positive number')
  }
  if (typeof m.audioInput !== 'string' || m.audioInput.length === 0) {
    throw new KwsStreamingManifestError('`audioInput` must be a non-empty string')
  }
  if (typeof m.scoreOutput !== 'string' || m.scoreOutput.length === 0) {
    throw new KwsStreamingManifestError('`scoreOutput` must be a non-empty string')
  }
  if (typeof m.softmaxed !== 'boolean') {
    throw new KwsStreamingManifestError('`softmaxed` must be a boolean')
  }

  const common = {
    version: 1 as const,
    mode,
    model: m.model,
    source: typeof m.source === 'string' ? m.source : 'unknown',
    upstreamRef: typeof m.upstreamRef === 'string' ? m.upstreamRef : 'unknown',
    labels: labels as string[],
    wantedWord: m.wantedWord,
    sampleRate: m.sampleRate,
    featureExtractor: 'graph' as const,
    audioInput: m.audioInput,
    scoreOutput: m.scoreOutput,
    softmaxed: m.softmaxed,
  }

  if (mode === 'sliding-window') {
    const windowSamples = positiveInt(m.windowSamples, 'windowSamples')
    const hopSamples = positiveInt(m.hopSamples, 'hopSamples')
    if (hopSamples > windowSamples) {
      throw new KwsStreamingManifestError(
        `\`hopSamples\` (${hopSamples}) must not exceed \`windowSamples\` (${windowSamples}) - ` +
          'a hop larger than the window would skip audio entirely',
      )
    }
    return { ...common, windowSamples, hopSamples }
  }

  // streaming-external-state
  const packetSamples = positiveInt(m.packetSamples, 'packetSamples')
  if (!Array.isArray(m.states)) {
    throw new KwsStreamingManifestError('`states` must be an array')
  }

  const states: KwsStreamingState[] = []
  const seenInputs = new Set<string>()
  const seenOutputs = new Set<string>()
  for (const [i, entry] of (m.states as unknown[]).entries()) {
    if (typeof entry !== 'object' || entry === null) {
      throw new KwsStreamingManifestError(`states[${i}] must be an object`)
    }
    const s = entry as Record<string, unknown>
    if (typeof s.input !== 'string' || s.input.length === 0) {
      throw new KwsStreamingManifestError(`states[${i}].input must be a non-empty string`)
    }
    if (typeof s.output !== 'string' || s.output.length === 0) {
      throw new KwsStreamingManifestError(`states[${i}].output must be a non-empty string`)
    }
    if (
      !Array.isArray(s.shape) ||
      s.shape.length === 0 ||
      !s.shape.every((d) => typeof d === 'number' && Number.isInteger(d) && d > 0)
    ) {
      throw new KwsStreamingManifestError(
        `states[${i}].shape must be a non-empty array of positive integers`,
      )
    }
    // A duplicated name means two buffers alias each other - the stream would
    // silently mix unrelated history.
    if (seenInputs.has(s.input)) {
      throw new KwsStreamingManifestError(`duplicate state input '${s.input}'`)
    }
    if (seenOutputs.has(s.output)) {
      throw new KwsStreamingManifestError(`duplicate state output '${s.output}'`)
    }
    seenInputs.add(s.input)
    seenOutputs.add(s.output)
    states.push({ input: s.input, output: s.output, shape: s.shape as number[] })
  }

  if (seenInputs.has(common.audioInput)) {
    throw new KwsStreamingManifestError(
      `\`audioInput\` '${common.audioInput}' is also declared as a state input`,
    )
  }
  if (seenOutputs.has(common.scoreOutput)) {
    throw new KwsStreamingManifestError(
      `\`scoreOutput\` '${common.scoreOutput}' is also declared as a state output`,
    )
  }

  return { ...common, packetSamples, states }
}

/** Total number of float elements in a state shape. */
export function stateSize(shape: number[]): number {
  return shape.reduce((a, b) => a * b, 1)
}
