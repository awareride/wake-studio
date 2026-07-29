/**
 * ASR-Decoding KWS module - shared types.
 *
 * ASR-Decoding KWS (docs/kws-categories.md §2.2, ADR-024) detects wake words by
 * running a streaming ASR engine (sherpa-onnx) and matching its decoded token
 * sequence against an editable wake-word list. No model retraining or
 * fine-tuning is involved - the user only edits text.
 *
 * This module is INDEPENDENT of the Traditional/Few-Shot KWS modules per the
 * architecture decoupling rule (ADR-024 §1): it adds a driver module + a panel
 * and reuses only the shared `KWSBackend` interface and the generic inference
 * dispatcher.
 */

import type { KWSBackendId } from '../kws/types'

/** Identifier for the ASR-Decoding backend within the KWS backend registry. */
export const ASR_BACKEND_ID: KWSBackendId = 'asr-decode'

/** A single editable wake word in the ASR decode list. */
export interface WakeWordEntry {
  /** Stable id (UI key). */
  id: string
  /** The wake phrase text (free-form; matched as a token sequence). */
  text: string
  /** Whether this entry is currently active for matching. */
  enabled: boolean
}

/**
 * Runtime config for the ASR-Decoding backend. These map to the §4.1 ASR
 * Primary + Advanced panel parameters (docs/kws-categories.md §4.1).
 */
export interface AsrDecodeConfig {
  /** Base URL of the sherpa-onnx wasm + ASR glue (e.g. /sherpa-onnx/). */
  wasmBaseUrl: string
  /**
   * Base URL of the streaming ASR model files (encoder/decoder/joiner/tokens).
   * Defaults to a bundled sherpa-onnx English streaming model under
   * /sherpa-onnx/models/asr/ when empty.
   */
  modelBaseUrl: string
  /** Editable wake-word list. */
  wakeWords: WakeWordEntry[]
  /** Matching threshold [0,1] on the fuzzy token-match confidence. */
  matchThreshold: number
  /** Decoding beam size for the ASR recognizer (advanced). */
  beamSize: number
  /** VAD adjustment: minimum silence (s) that ends a decoded segment (advanced). */
  vadSilenceMs: number
  /** Repeated-wake suppression window (ms); same word re-fires only after this. */
  repeatSuppressMs: number
  /** Token conversion: lowercase + strip punctuation before matching. */
  normalizeTokens: boolean
  /** Inference mode: realtime mic or offline file. */
  inferenceMode: 'realtime' | 'offline'
}

/** A decoded segment from the ASR engine. */
export interface AsrSegment {
  text: string
  /** Monotonic token sequence (already normalized if configured). */
  tokens: string[]
  /** Whether the segment is final (vs. a streaming partial). */
  isFinal: boolean
  /** AudioContext time (ms) at segment end. */
  endedAtMs: number
}

/** Result of matching a decoded segment against the wake-word list. */
export interface MatchResult {
  /** The matched wake word entry, or null if no match. */
  matched: WakeWordEntry | null
  /** Confidence [0,1] of the best match (1.0 = exact token sequence). */
  confidence: number
  /** The decoded text that produced the match. */
  decodedText: string
}
