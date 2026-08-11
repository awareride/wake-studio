/**
 * kws-streaming backend - Traditional fixed-class KWS over a `kws_streaming`
 * external-state streaming graph (ADR-020/024 §2.1).
 *
 * Upstream (google-research/kws_streaming) trains a non-streaming Keras model
 * and converts it to a streaming graph. In the EXTERNAL-state mode every
 * streaming ring buffer becomes a graph input/output, so the graph is stateless
 * and the caller carries the state:
 *
 *   step(packet, states_in) -> (logits, states_out)
 *
 * which is exactly `KWSBackend.processFrame`. All the architecture-specific
 * detail (tensor names, state shapes, packet size, labels) comes from the
 * sidecar manifest, so this ONE backend serves every streamable topology
 * upstream ships (dnn ... bc_resnet).
 *
 * The engine owns the VAD gate, smoothing, threshold and cooldown; this backend
 * owns packet alignment and the state carry.
 *
 * @see docs/modules/kws-streaming.md §4-§5
 * @see https://github.com/google-research/google-research/blob/master/kws_streaming/README.md
 */

import * as ort from 'onnxruntime-web'
import type { BackendModelUrls, KWSBackend } from '@wake-studio/module-kws-engine'
import { resolveAsset } from '@wake-studio/platform'
import type { KwsStreamingManifest } from './manifest'
import { validateManifest } from './manifest'
import {
  PacketBuffer,
  SlidingWindow,
  advanceStates,
  createStateBag,
  resetStateBag,
  selectLabelScore,
  stateBagBytes,
} from './streaming'

// onnxruntime-web WASM runtime served locally from /ort/ (P0-4 offline
// support); base-aware (ADR-012). Same convention as the openwakeword driver.
ort.env.wasm.wasmPaths = resolveAsset('/ort/')

/** Panel-driven configuration (docs/modules/kws-streaming.md §6.1). */
export interface KwsStreamingConfig {
  /** Which label column is the wake word. Empty = the manifest's default. */
  wantedWord: string
  /**
   * false = upstream `reset0` (states kept across utterances; the setting the
   * paper reports streaming accuracy for). true = `reset1`.
   */
  resetOnTrigger: boolean
}

const DEFAULT_CONFIG: KwsStreamingConfig = {
  wantedWord: '',
  resetOnTrigger: false,
}

export class KWSStreamingBackend implements KWSBackend {
  readonly id = 'kws-streaming' as const
  readonly label = 'kws_streaming (Traditional streaming-aware)'

  private _session: ort.InferenceSession | null = null
  private _manifest: KwsStreamingManifest | null = null
  /**
   * The EP the session was actually created with. Always 'wasm' once loaded
   * (see load()); the engine reads this so the UI reports the truth instead of
   * the requested provider.
   */
  private _effectiveEp: 'webgpu' | 'wasm' | null = null
  private _states = new Map<string, Float32Array>()
  private _packets: PacketBuffer | null = null
  private _window: SlidingWindow | null = null
  private _config: KwsStreamingConfig = { ...DEFAULT_CONFIG }
  /** Last full label posterior vector (dev panel, §8). */
  private _lastLabelScores: Float32Array | null = null

  /** Serialization guard: ONNX sessions are not re-entrant. */
  private _inferring = false

  get ready(): boolean {
    return this._session !== null && this._manifest !== null
  }

  /** The loaded manifest (dev panel / label selector). Null before load. */
  get manifest(): KwsStreamingManifest | null {
    return this._manifest
  }

  /** The EP actually in use (read by the engine for the UI's EP badge). */
  get effectiveExecutionProvider(): 'webgpu' | 'wasm' | null {
    return this._effectiveEp
  }

  /** State-bag size in bytes (dev panel, §8). */
  get stateBytes(): number {
    return stateBagBytes(this._states)
  }

  /**
   * The most recent per-label posteriors (dev panel, §8). Seeing the whole
   * vector is the fastest way to spot a model confusing the wake word with a
   * neighbouring label.
   */
  get lastLabelScores(): Float32Array | null {
    return this._lastLabelScores
  }

  configure(patch: Partial<KwsStreamingConfig>): void {
    this._config = { ...this._config, ...patch }
  }

  async load(urls: BackendModelUrls, provider: 'webgpu' | 'wasm'): Promise<void> {
    // The URL bag is driver-opaque (ADR-034); this driver owns the
    // kwsStreaming key (model + manifest pair).
    const source = (urls as { kwsStreaming?: { model: string; manifest: string } })
      .kwsStreaming
    if (!source?.model || !source?.manifest) {
      throw new Error(
        'kws-streaming requires a model + manifest URL. Upstream ships no ' +
          'pretrained weights: train one (Traditional training panel) or supply ' +
          'model.onnx + model.json.',
      )
    }

    // Manifest first: a bad manifest must never reach the graph.
    const manifest = validateManifest(await fetchJson(source.manifest))

    // WASM only, regardless of the requested provider.
    //
    // The kws_streaming graphs extract the CLS token with Slice -> Squeeze.
    // onnxruntime-web's WebGPU (jsep) EP mis-executes that Squeeze - it ignores
    // the `axes` input and squeezes the wrong dimension, failing at run() with:
    //   "Dimension of input 2 must be 1 instead of 64. shape={1,1,64}"
    // even though squeezing axis 1 of {1,1,64} is perfectly valid (verified: the
    // identical graph runs correctly on the wasm EP).
    //
    // These models are also tiny (10K-750K params) on a 1 s window every 100 ms,
    // so WebGPU's dispatch overhead would dominate anyway - there is no
    // performance argument for fighting this. The plix driver pins wasm for the
    // same class of jsep op bug (see encoders/plix-onnx.ts).
    const effectiveProvider = 'wasm' as const
    if (provider === 'webgpu') {
      console.warn(
        '[kws-streaming] forcing the WASM execution provider: the WebGPU (jsep) ' +
          'EP mis-executes this graph\'s Slice->Squeeze (CLS token extraction).',
      )
    }

    const session = await createSession(source.model, effectiveProvider)

    // Guard the manifest against the actual graph. A mis-paired state tensor
    // degrades accuracy silently, so every declared name must exist.
    assertGraphMatchesManifest(session, manifest)

    this._session = session
    this._manifest = manifest
    this._effectiveEp = effectiveProvider
    this._states = createStateBag(manifest)
    this._packets =
      manifest.mode === 'streaming-external-state'
        ? new PacketBuffer(manifest.packetSamples!)
        : null
    this._window =
      manifest.mode === 'sliding-window'
        ? new SlidingWindow(manifest.windowSamples!, manifest.hopSamples!)
        : null

    if (this._config.wantedWord === '') {
      this._config.wantedWord = manifest.wantedWord
    } else if (!manifest.labels.includes(this._config.wantedWord)) {
      throw new Error(
        `kws-streaming: configured wantedWord '${this._config.wantedWord}' is not ` +
          `one of the model's labels [${manifest.labels.join(', ')}]`,
      )
    }
  }

  async processFrame(samples: Float32Array): Promise<number | null> {
    const session = this._session
    const manifest = this._manifest
    if (!session || !manifest) return null
    // Drop frames while a step is in flight. The buffers keep whatever they
    // already hold, so state/window continuity is preserved.
    if (this._inferring) return null

    this._inferring = true
    try {
      if (this._window) {
        // Sliding-window mode: the graph wants a whole clip, re-evaluated every
        // hop. Audio is not consumed by a read, so successive windows overlap.
        this._window.push(samples)
        const window = this._window.take()
        if (window === null) return null
        return await this._runWindow(session, manifest, window)
      }

      const packets = this._packets
      if (!packets) return null
      packets.push(samples)
      let score: number | null = null
      // A partial packet is never fed: upstream requires the streaming input
      // length to be aligned with the model's total time stride.
      for (let packet = packets.take(); packet !== null; packet = packets.take()) {
        score = await this._step(session, manifest, packet)
      }
      return score
    } finally {
      this._inferring = false
    }
  }

  reset(): void {
    resetStateBag(this._states)
    this._packets?.clear()
    this._window?.clear()
    this._lastLabelScores = null
  }

  async dispose(): Promise<void> {
    await this._session?.release?.()
    this._session = null
    this._manifest = null
    this._effectiveEp = null
    this._states.clear()
    this._packets = null
    this._window = null
    this._lastLabelScores = null
  }

  // ---- internals ----

  /** One sliding-window evaluation: whole clip in, posterior out (stateless). */
  private async _runWindow(
    session: ort.InferenceSession,
    manifest: KwsStreamingManifest,
    window: Float32Array,
  ): Promise<number> {
    const outputs = await session.run({
      [manifest.audioInput]: new ort.Tensor('float32', window, [1, window.length]),
    })
    const scoreTensor = outputs[manifest.scoreOutput]
    if (!scoreTensor) {
      throw new Error(
        `kws-streaming: step produced no output '${manifest.scoreOutput}'`,
      )
    }
    return this._score(manifest, scoreTensor.data as Float32Array)
  }

  /** One streaming step: packet + states in, posterior out, states carried. */
  private async _step(
    session: ort.InferenceSession,
    manifest: KwsStreamingManifest,
    packet: Float32Array,
  ): Promise<number> {
    const feeds: Record<string, ort.Tensor> = {
      [manifest.audioInput]: new ort.Tensor('float32', packet, [
        1,
        packet.length,
      ]),
    }
    for (const state of manifest.states ?? []) {
      const buffer = this._states.get(state.input)
      if (!buffer) {
        throw new Error(`kws-streaming: missing state buffer '${state.input}'`)
      }
      feeds[state.input] = new ort.Tensor('float32', buffer, state.shape)
    }

    const outputs = await session.run(feeds)

    const scoreTensor = outputs[manifest.scoreOutput]
    if (!scoreTensor) {
      throw new Error(
        `kws-streaming: step produced no output '${manifest.scoreOutput}'`,
      )
    }

    // Carry state BEFORE reading the score, so a carry failure can never be
    // mistaken for a low-confidence frame.
    advanceStates(
      manifest,
      this._states,
      outputs as unknown as Record<string, { data: Float32Array }>,
    )

    return this._score(manifest, scoreTensor.data as Float32Array)
  }

  /** Select the wanted label's posterior and record the full vector. */
  private _score(
    manifest: KwsStreamingManifest,
    raw: Float32Array,
  ): number {
    this._lastLabelScores = raw.slice(0, manifest.labels.length)
    return selectLabelScore(
      manifest,
      raw,
      this._config.wantedWord || manifest.wantedWord,
    )
  }
}

/** Fetch and parse the sidecar manifest. */
async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(missingAssetMessage('manifest', url, response))
  }
  return response.json()
}

/**
 * Build an actionable message for a missing artifact.
 *
 * The ONNX graphs are gitignored (ADR-011) and fetched per build, so a 404 here
 * usually means "this particular model was not in the artifact you downloaded"
 * - which is easy to hit, because the build takes a `checkpoints` list and a
 * single-checkpoint build only ships one model. Say so, instead of surfacing a
 * bare 404.
 */
function missingAssetMessage(
  kind: 'manifest' | 'model',
  url: string,
  response: Response,
): string {
  const name = url.split('/').pop() ?? url
  if (response.status === 404) {
    return (
      `kws-streaming: ${kind} '${name}' is not present (404). The ONNX models are ` +
      'not committed (ADR-011): run `node scripts/fetch-artifact.mjs kws-streaming`. ' +
      'If other models load but this one 404s, the artifact was built for a subset ' +
      'of checkpoints - rebuild with all of them: `gh workflow run build.yaml ' +
      `-f module=kws-streaming -f inputs_json='{"checkpoints":"kwt1,kwt2,kwt3,att_mh_rnn_1"}'\``
    )
  }
  return `kws-streaming: failed to fetch ${kind} ${url}: ${response.status} ${response.statusText}`
}

/** Fetch a graph and create an InferenceSession. */
async function createSession(
  url: string,
  provider: 'webgpu' | 'wasm',
): Promise<ort.InferenceSession> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(missingAssetMessage('model', url, response))
  }
  const buffer = await response.arrayBuffer()
  return ort.InferenceSession.create(buffer, {
    executionProviders: provider === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
  })
}

/**
 * Fail loudly when the manifest and the graph disagree.
 *
 * Every name the driver will feed or read must exist in the session, otherwise
 * the stream would run on stale state and lose accuracy without any error.
 */
function assertGraphMatchesManifest(
  session: ort.InferenceSession,
  manifest: KwsStreamingManifest,
): void {
  const inputs = new Set(session.inputNames)
  const outputs = new Set(session.outputNames)
  const missing: string[] = []

  if (!inputs.has(manifest.audioInput)) missing.push(`input '${manifest.audioInput}'`)
  if (!outputs.has(manifest.scoreOutput)) missing.push(`output '${manifest.scoreOutput}'`)
  for (const state of manifest.states ?? []) {
    if (!inputs.has(state.input)) missing.push(`state input '${state.input}'`)
    if (!outputs.has(state.output)) missing.push(`state output '${state.output}'`)
  }

  if (missing.length > 0) {
    throw new Error(
      `kws-streaming: manifest does not match the graph - missing ${missing.join(', ')}. ` +
        `Graph inputs: [${session.inputNames.join(', ')}]; outputs: [${session.outputNames.join(', ')}]`,
    )
  }
}
