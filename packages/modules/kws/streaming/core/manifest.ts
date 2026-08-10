/**
 * kws-streaming - the sidecar manifest that describes an exported
 * `kws_streaming` external-state streaming graph.
 *
 * Upstream (google-research/kws_streaming) converts a non-streaming Keras model
 * into a streaming one by inserting ring buffers into the time-dimension
 * layers. In the EXTERNAL-state flavour those buffers become explicit graph
 * inputs and outputs, so the graph itself is stateless and the caller carries
 * the state between steps.
 *
 * The input/output tensor names and state shapes depend on the topology (dnn,
 * cnn, ds_tc_resnet, bc_resnet, ...) and on the training flags. Instead of
 * hard-coding any of that per architecture, the exporter writes this manifest
 * next to the model and the driver reads it. That is what lets ONE driver serve
 * every streamable topology upstream ships.
 *
 * @see docs/modules/kws-streaming.md §4.2
 */

/** One streaming state buffer: the graph input, its paired output, its shape. */
export interface KwsStreamingState {
  /** State input tensor name (fed at step N). */
  input: string
  /** State output tensor name (produced at step N, fed as `input` at N+1). */
  output: string
  /** Full tensor shape, e.g. [1, 3, 40]. */
  shape: number[]
}

/** Sidecar manifest for one exported streaming graph. */
export interface KwsStreamingManifest {
  /** Manifest schema version; bumped on breaking changes. */
  version: 1
  /** Upstream topology name, e.g. 'ds_tc_resnet'. */
  model: string
  /** Commit/ref of google-research/kws_streaming this was trained from. */
  upstreamRef: string
  /** Class labels in output-column order (upstream `labels.txt`). */
  labels: string[]
  /** Default wake word; must be a member of `labels`. */
  wantedWord: string
  /** Sample rate the graph expects (upstream default 16000). */
  sampleRate: number
  /**
   * Samples consumed per streaming step. Upstream requires the streaming input
   * length to be aligned with the model's total time stride/pooling, so a
   * partial packet must never be fed.
   */
  packetSamples: number
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
  /** Streaming state buffers, in graph order. */
  states: KwsStreamingState[]
  /** True when `scoreOutput` is already softmaxed (upstream default). */
  softmaxed: boolean
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

/** Thrown when a manifest is malformed or describes an unsupported export. */
export class KwsStreamingManifestError extends Error {
  constructor(message: string) {
    super(`kws-streaming manifest: ${message}`)
    this.name = 'KwsStreamingManifestError'
  }
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
  if (typeof m.model !== 'string' || m.model.length === 0) {
    throw new KwsStreamingManifestError('`model` must be a non-empty string')
  }
  if (!STREAMABLE_MODELS.includes(m.model)) {
    throw new KwsStreamingManifestError(
      `unknown/non-streamable topology '${m.model}'; expected one of ${STREAMABLE_MODELS.join(', ')}`,
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
  if (typeof m.packetSamples !== 'number' || !Number.isInteger(m.packetSamples) || m.packetSamples <= 0) {
    throw new KwsStreamingManifestError('`packetSamples` must be a positive integer')
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

  if (seenInputs.has(m.audioInput)) {
    throw new KwsStreamingManifestError(
      `\`audioInput\` '${m.audioInput}' is also declared as a state input`,
    )
  }
  if (seenOutputs.has(m.scoreOutput)) {
    throw new KwsStreamingManifestError(
      `\`scoreOutput\` '${m.scoreOutput}' is also declared as a state output`,
    )
  }

  return {
    version: 1,
    model: m.model,
    upstreamRef: typeof m.upstreamRef === 'string' ? m.upstreamRef : 'unknown',
    labels: labels as string[],
    wantedWord: m.wantedWord,
    sampleRate: m.sampleRate,
    packetSamples: m.packetSamples,
    featureExtractor: 'graph',
    audioInput: m.audioInput,
    scoreOutput: m.scoreOutput,
    states,
    softmaxed: m.softmaxed,
  }
}

/** Total number of float elements in a state shape. */
export function stateSize(shape: number[]): number {
  return shape.reduce((a, b) => a * b, 1)
}
