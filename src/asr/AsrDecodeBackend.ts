/**
 * ASR-Decoding KWS backend (ADR-024 / docs/kws-categories.md §2.2).
 *
 * Implements the pluggable `KWSBackend` interface so the shared inference
 * dispatcher (VAD gate, smoothing, trigger, panel) works unchanged. The
 * "model" for this backend is a streaming ASR engine + an editable text
 * wake-word list - no retraining.
 *
 * Pipeline:
 *   AFE 16 kHz frames -> sherpa-onnx OnlineRecognizer -> decoded tokens
 *   -> matchWakeWords(wakeWords) -> confidence [0,1] -> (engine smooth + trigger)
 *
 * The backend emits `null` during warmup (no decoded segment yet). When a
 * segment ends (endpoint) it scores the decoded tokens and returns the
 * confidence; the generic smoother/trigger turns that into a trigger when it
 * exceeds `matchThreshold` (mapped onto KWSConfig.threshold by the panel).
 *
 * Repeated-wake suppression: after a match, the same wake word is suppressed
 * for `repeatSuppressMs` to avoid machine-gun retriggers on a held phrase.
 *
 * @see src/asr/matching.ts (pure token matcher, unit-tested)
 * @see src/asr/sherpa.ts (wasm loader)
 */

import type { KWSBackend } from '../kws/types'
import type { AsrDecodeConfig, WakeWordEntry, AsrSegment } from './types'
import { loadSherpaAsr, buildOnlineConfig, type SherpaOnlineRecognizer } from './sherpa'
import { matchWakeWords, tokenize } from './matching'

const DEFAULT_CONFIG: AsrDecodeConfig = {
  wasmBaseUrl: '/sherpa-onnx/',
  modelBaseUrl: '/sherpa-onnx/models/asr/',
  wakeWords: [{ id: 'ww-0', text: 'hey siri', enabled: true }],
  matchThreshold: 0.85,
  beamSize: 4,
  vadSilenceMs: 400,
  repeatSuppressMs: 1500,
  normalizeTokens: true,
  inferenceMode: 'realtime',
}

export class AsrDecodeBackend implements KWSBackend {
  readonly id = 'asr-decode' as const
  readonly label = 'ASR Decoding (sherpa-onnx token matching)'

  private _cfg: AsrDecodeConfig = { ...DEFAULT_CONFIG }
  private _recognizer: SherpaOnlineRecognizer | null = null
  private _session: unknown = null
  private _ready = false

  // Decoded-text accumulation.
  private _partialTokens: string[] = []
  private _suppressUntilMs: Record<string, number> = {}

  get ready(): boolean {
    return this._ready
  }

  /** Configure the backend before load (called by the engine/panel). */
  configure(cfg: Partial<AsrDecodeConfig>): void {
    this._cfg = { ...this._cfg, ...cfg }
  }

  async load(urls: never, provider: 'webgpu' | 'wasm'): Promise<void> {
    void provider
    void urls
    const sherpa = await loadSherpaAsr(this._cfg.wasmBaseUrl)
    const config = buildOnlineConfig(this._cfg.modelBaseUrl, this._cfg.beamSize)
    // Some sherpa builds expose the recognizer factory on the booted module,
    // others on a global. Support both shapes.
    const factory = (sherpa as unknown as {
      createOnlineRecognizer?: (c: unknown) => SherpaOnlineRecognizer
    }).createOnlineRecognizer
    if (typeof factory !== 'function') {
      throw new Error('sherpa-onnx ASR factory unavailable after load.')
    }
    this._recognizer = factory(config)
    this._session = this._recognizer.createStream()
    this._ready = true
  }

  async processFrame(samples: Float32Array): Promise<number | null> {
    if (!this._ready || !this._recognizer || !this._session) return null

    // Feed the 16 kHz frame to the streaming recognizer.
    this._recognizer.acceptWaveform(this._session, 16000, samples)

    const result = this._recognizer.getResult(this._session)
    const text = result?.text ?? ''
    const tokens = tokenize(text)

    // Endpoint detected -> score the segment, then reset for the next one.
    const endpoint = this._recognizer.isEndpoint(this._session)
    if (endpoint && tokens.length > 0) {
      const nowMs = performance.now()
      const seg: AsrSegment = {
        text,
        tokens,
        isFinal: true,
        endedAtMs: nowMs,
      }
      const score = this._scoreSegment(seg, nowMs)
      this._recognizer.reset(this._session)
      this._partialTokens = []
      return score
    }

    // Streaming partial: carry the partial tokens forward for the next frame so
    // we always match the freshest decode. We do NOT emit a trigger on partials
    // (only finalized endpoints produce a score), but we keep them for UI.
    this._partialTokens = tokens
    return null
  }

  /** Score a finalized decoded segment against the wake-word list. */
  private _scoreSegment(seg: AsrSegment, nowMs: number): number {
    const match = matchWakeWords(seg.tokens, this._cfg.wakeWords, this._cfg.normalizeTokens)
    if (!match.matched) return 0

    // Repeated-wake suppression: drop a re-match of the same word within the
    // suppression window so a held phrase doesn't machine-gun.
    const wid = match.matched.id
    const until = this._suppressUntilMs[wid] ?? 0
    if (nowMs < until) return 0
    this._suppressUntilMs[wid] = nowMs + this._cfg.repeatSuppressMs

    return match.confidence
  }

  /** Latest partial decoded tokens (for the panel's live transcript view). */
  get lastPartialTokens(): string[] {
    return this._partialTokens
  }

  get lastPartialText(): string {
    return this._partialTokens.join(' ')
  }

  reset(): void {
    if (this._recognizer && this._session) {
      try {
        this._recognizer.reset(this._session)
      } catch {
        /* ignore */
      }
    }
    this._partialTokens = []
    this._suppressUntilMs = {}
  }

  async dispose(): Promise<void> {
    this.reset()
    if (this._recognizer && this._session) {
      try {
        this._recognizer.freeStream?.(this._session)
        this._recognizer.free(this._recognizer)
      } catch {
        /* ignore */
      }
    }
    this._recognizer = null
    this._session = null
    this._ready = false
  }
}

export { DEFAULT_CONFIG as ASR_DEFAULT_CONFIG }
export type { WakeWordEntry }
