# Few-Shot Custom Wake-Word Enrollment - Module Specification

- **Status:** Draft (docs-first, pending human review)
- **Owner:** WakeStudio team
- **Plan phase:** Phase 3
- **Related ADRs:** ADR-002 (WavLM encoder), ADR-013 (enrollment is client-side,
  not training), ADR-017 (config panel), ADR-020 (EmbedProvider/KWSBackend),
  ADR-021 (device SDK shares the interface)
- **Depends on (modules):** KWS (`embed(audio)` scaffold + `WavLMEmbedProvider`),
  AFE (16 kHz output stream for live detection)
- **Last updated:** 2026-07-27

## 1. Purpose

The Few-Shot module lets a user **enroll a custom wake word with 3-5 samples** and
immediately get a working detector - no training backend required. The user
records a few utterances; each is embedded by a frozen WavLM encoder; the
embeddings are mean-pooled into a **prototype vector**; live detection runs
cosine similarity between a sliding-window embedding and the prototype, with a
threshold + min-duration trigger.

This is **enrollment + inference, not training** (ADR-013 amendment): no weights
are learned; the prototype is a vector average. It stays 100% client-side, true
to the "zero setup" principle for the primary journey.

## 2. Scope & boundaries

- **In scope:**
  - Enrollment UI: record N samples (default 5) with quality checks (level,
    SNR, duration, no clipping) and replay.
  - Prototype computation: per-sample WavLM embedding -> mean-pool -> prototype
    vector, stored in IndexedDB.
  - Live Few-Shot detection: sliding window -> embed -> cosine similarity ->
    threshold -> trigger (a `KWSBackend` adapter, ADR-020).
  - Anti-false-trigger: optional negative prototype, VAD gating (reuses AFE
    RNNoise VAD), min-activation-duration smoothing.
  - Few-Shot bundle export: prototype JSON + encoder reference + a tiny reader
    (for Phase 4 export).
- **Out of scope:**
  - Training/learning weights (that's Phase 5, ADR-013 backends).
  - The WavLM encoder itself (owned by the KWS module's `WavLMEmbedProvider`).
  - The AFE pipeline (owned by AFE; Few-Shot consumes its 16 kHz output).
- **Public surface:** a `FewShotEngine` controller (enroll, detect, export) and
  the `WavLMFewShotBackend` (a `KWSBackend` adapter for live detection).

## 3. Dependencies

- **Upstream (consumes from):** KWS module's `WavLMEmbedProvider.embed(audio)`;
  AFE module's 16 kHz output stream (for live detection).
- **Downstream (provides to):** UI (enrollment flow + live detection score
  curve); Phase 4 export (Few-Shot bundle).
- **External libraries / models:**
  - **WavLM-base-plus** (`wavlm-base-plus-int8`, MIT) - frozen encoder. ~95 MB
    (int8). Loaded via the KWS module's `WavLMEmbedProvider`. See `LICENSES.md`.
  - **IndexedDB** - prototype + recording persistence (browser standard).

## 4. Public API & types

```ts
import type { KWSBackend, KWSBackendId } from '../kws'

/** A single enrolled sample (audio + metadata). */
export interface EnrolledSample {
  id: string
  /** 16 kHz mono float32 audio. */
  samples: Float32Array
  sampleRate: number
  /** WavLM embedding (pooled to 1-D). */
  embedding: Float32Array
  /** Quality metrics from enrollment checks. */
  quality: SampleQuality
  recordedAtMs: number
}

export interface SampleQuality {
  peakDbfs: number      // peak level (should not clip)
  snrDb: number         // signal-to-noise ratio
  durationMs: number    // active speech duration
  clipped: boolean      // true if samples hit +/-1.0
  acceptable: boolean   // overall pass/fail
}

/** A stored wake-word prototype. */
export interface WakeWordPrototype {
  id: string
  word: string
  /** Mean-pooled WavLM embedding of enrolled samples. */
  vector: Float32Array
  /** Optional negative prototype (mean of "not the word" samples). */
  negativeVector?: Float32Array
  sampleIds: string[]
  createdAtMs: number
}

/** Few-Shot configuration (extends the shared config-panel pattern, ADR-017). */
export interface FewShotConfig {
  threshold: number           // cosine similarity threshold (default 0.7)
  minDurationMs: number       // min sustained activation (default 500)
  cooldownMs: number          // min time between triggers (default 2000)
  smoothingWindowFrames: number // sliding-window max (default 10)
  vadGateEnabled: boolean     // reuse AFE VAD (default true)
  vadThreshold: number        // (default 0.3)
  windowMs: number            // sliding detection window (default 1500)
  hopMs: number               // detection hop (default 80, = AFE chunk)
  useNegativePrototype: boolean // (default false)
}

/** Top-level controller the UI drives. */
export interface FewShotEngine {
  /** Ensure the WavLM encoder is loaded (delegates to WavLMEmbedProvider). */
  loadEncoder(): Promise<void>
  readonly encoderReady: boolean

  // ---- enrollment ----
  /** Embed one recorded sample (for preview / quality check). */
  embedSample(samples: Float32Array, sampleRate: number): Promise<Float32Array>
  /** Compute a prototype from N embeddings (mean-pool). */
  buildPrototype(word: string, samples: EnrolledSample[]): WakeWordPrototype
  /** Persist a prototype + its samples to IndexedDB. */
  savePrototype(proto: WakeWordPrototype, samples: EnrolledSample[]): Promise<void>
  /** List stored prototypes. */
  listPrototypes(): Promise<WakeWordPrototype[]>
  /** Delete a prototype + its samples. */
  deletePrototype(id: string): Promise<void>

  // ---- live detection ----
  /** Create a KWSBackend adapter for live Few-Shot detection (ADR-020). */
  createBackend(prototype: WakeWordPrototype): KWSBackend

  readonly config: FewShotConfig
  setConfig(patch: Partial<FewShotConfig>): void
  describeParameters(): ReadonlyArray<ParameterDescriptor>
}
```

## 5. Data flow / sequence

**Enrollment:**
```
User records sample -> quality check -> WavLM embed(sample) -> EnrolledSample
(repeat N times) -> mean-pool embeddings -> WakeWordPrototype -> IndexedDB
```

**Live detection (via `WavLMFewShotBackend`, a `KWSBackend`):**
```
AFE (16kHz) -> accumulate windowMs of audio -> WavLM embed -> cosine(proto)
             -> score [0,1] -> (engine: smooth + threshold + trigger)
```

The `WavLMFewShotBackend` implements `KWSBackend.processFrame(samples)`: it
accumulates AFE frames into a `windowMs` sliding buffer, runs `embed()` on the
buffer, computes cosine similarity to the prototype (optionally subtracting the
negative prototype), and returns the score. The generic KWS engine (worker)
handles smoothing, threshold, and trigger - exactly as for the OpenWakeWord
backend. This is the power of the shared `KWSBackend` interface (ADR-020).

**Cosine similarity:** `cos(a, b) = dot(a,b) / (||a|| * ||b||)`, rescaled to
[0,1] via `(cos + 1) / 2` so the existing threshold/min-duration UI works
unchanged.

## 6. Configuration & constants

| Parameter | Default | Range | Notes |
|---|---|---|---|
| `threshold` | 0.7 | 0.5-0.95 | Cosine-similarity threshold (rescaled [0,1]). |
| `minDurationMs` | 300 | 100-3000 | Sustained activation before trigger. |
| `cooldownMs` | 2000 | 500-10000 | Min time between triggers. |
| `smoothingWindowFrames` | 5 | 1-30 | Sliding-window max-pool. |
| `vadGateEnabled` | true | - | Reuse AFE RNNoise VAD. |
| `vadThreshold` | 0.3 | 0-1 | VAD gate threshold. |
| `windowMs` | 1500 | 500-3000 | Detection window fed to WavLM. |
| `hopMs` | 80 | fixed | Detection hop (= 1 AFE 80 ms chunk). |
| `useNegativePrototype` | false | - | Subtract negative prototype for tighter boundary. |

## 7. Error model & failure modes

- **WavLM load failure** (network/OOM): `loadEncoder()` rejects; UI shows "Failed
  to load WavLM encoder." Mitigation: int8 (~95 MB); suggest closing tabs.
- **Sample quality failure**: `embedSample` still succeeds but `quality.acceptable
  = false`; UI warns the user to re-record.
- **Cosine score NaN** (zero-norm vector): treat as 0 (no match).
- **IndexedDB quota**: `savePrototype` rejects; UI suggests deleting old prototypes.

## 8. Observability

- Enrollment: per-sample quality metrics (level, SNR, duration) shown live.
- Detection: score curve (cosine similarity) + trigger flash, same UI as KWS.
- Dev panel: embedding dimensionality, inference time, prototype norm.

## 9. Testing strategy

- **Unit (Vitest):** cosine similarity + rescaling, mean-pool prototype, quality
  checks (level/SNR/clipping), trigger logic (reuses KWS `TriggerDetector`).
- **Integration:** load WavLM in Node, embed a test clip, assert non-zero vector;
  build a prototype from 2 embeddings, assert cosine(self) ≈ 1.0.
- **Manual:** enroll a 5-sample word -> confirm live detection triggers < 1 s;
  measure false-alarm rate on 5 min ambient speech (target < 1/hour).

## 10. Security & privacy

- All enrollment + detection is **100% client-side**; samples never leave the
  browser (ADR-013 amendment).
- Prototypes + samples stored in IndexedDB (local, user-controlled).
- No audio is transmitted; only the cosine score is emitted to the UI.

## 11. Open questions

- **[Q-FS-1] WavLM ONNX I/O -> RESOLVED.** The encoder is `Xenova/wavlm-base-plus-sv`
  (speaker-verification fine-tune, int8 ONNX ~97 MB). Verified I/O: input
  `input_values` [batch, seq] -> outputs `embeddings`/`logits` [batch, 512]. The
  `WavLMEmbedProvider` prefers the `embeddings` output and applies the
  Wav2Vec2FeatureExtractor normalization (zero-mean, unit-variance). No
  frame-level pooling needed - the SV head outputs a ready-to-use 512-dim vector.
- `[Q-FS-2]` Whether to offer a distilled/smaller encoder for low-RAM devices
  (ADR-002 mitigation). Defer to v1.x.

## 12. References

- Plan: Phase 3 tasks/validation; §4.1 Domain B (WavLM).
- ADR-002 (WavLM encoder), ADR-013 (enrollment is client-side), ADR-017 (config
  panel), ADR-020 (KWSBackend / EmbedProvider), ADR-021 (device SDK).
- Related module docs: `docs/modules/kws.md` (Phase 2, provides `embed()`),
  `docs/modules/afe.md` (Phase 1, provides 16 kHz output).

## 13. Change log

| Date | Change | Author |
|---|---|---|
| 2026-07-27 | Initial draft (docs-first, pending human review). | agent |
| 2026-07-28 | Q-FS-1 resolved: WavLM-base-plus-sv (512-dim, int8 ONNX); defaults tuned (min-duration 300, smoothing 5). | agent |
| 2026-07-28 | Fix Build-prototype feedback (prototype is state, not a ref) + WavLM detection smoothness (continuous ring buffer, 80 ms hop, zero-order-hold caching; serialization guard moved into each backend). | agent |
