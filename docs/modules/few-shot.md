# Few-Shot Custom Wake-Word Enrollment - Module Specification

- **Status:** Draft (docs-first, pending human review)
- **Owner:** WakeStudio team
- **Plan phase:** Phase 3
- **Related ADRs:** ADR-002 (PLiX Few-Shot encoder), ADR-013 (enrollment is client-side,
  not training), ADR-017 (config panel), ADR-020 (EmbedProvider/KWSBackend),
  ADR-021 (device SDK shares the interface)
- **Depends on (modules):** KWS (`embed(audio)` scaffold + `PlixKwsEmbedProvider`),
  AFE (16 kHz output stream for live detection)
- **Last updated:** 2026-07-28

## 1. Purpose

The Few-Shot module lets a user **enroll a custom wake word with 3-5 samples** and
immediately get a working detector - no training backend required. The user
records a few utterances; each is embedded by a frozen PLiX encoder; the
embeddings are mean-pooled into a **prototype vector**; live detection runs
the Prototypical-Network score (distance from a sliding-window embedding to the
prototype), with a threshold + min-duration trigger.

This is **enrollment + inference, not training** (ADR-013 amendment): no weights
are learned; the prototype is a vector average. It stays 100% client-side, true
to the "zero setup" principle for the primary journey.

## 2. Scope & boundaries

- **In scope:**
  - Enrollment UI: record N samples (default 5) with quality checks (level,
    SNR, duration, no clipping) and replay.
  - Prototype computation: per-sample PLiX embedding -> mean-pool -> prototype
    vector, stored in IndexedDB.
  - Live Few-Shot detection: sliding window -> embed -> Prototypical-Network
    score (distance to prototype) -> threshold -> trigger (a `KWSBackend`
    adapter, ADR-020).
  - Anti-false-trigger: optional negative prototype, VAD gating (reuses AFE
    RNNoise VAD), min-activation-duration smoothing.
  - Few-Shot bundle export: prototype JSON + encoder reference + a tiny reader
    (for Phase 4 export).
- **Out of scope:**
  - Training/learning weights (that's Phase 5, ADR-013 backends).
  - The PLiX encoder itself (owned by the KWS module's `PlixKwsEmbedProvider`).
  - The AFE pipeline (owned by AFE; Few-Shot consumes its 16 kHz output).
- **Public surface:** a `FewShotEngine` controller (enroll, detect, export) and
  the `PlixKwsBackend` (a `KWSBackend` adapter for live detection).

## 3. Dependencies

- **Upstream (consumes from):** KWS module's `PlixKwsEmbedProvider.embed(audio)`;
  AFE module's 16 kHz output stream (for live detection).
- **Downstream (provides to):** UI (enrollment flow + live detection score
  curve); Phase 4 export (Few-Shot bundle).
- **External libraries / models:**
  - **PLiX Few-Shot encoder** (`plixkws`, Apache-2.0) - compact CNN
    (EfficientNet-v2 "base" / TinyNet-E "small") trained as a Prototypical
    Network; outputs a 1280-dim embedding for prototype-distance matching.
    Loaded via the KWS module's `PlixKwsEmbedProvider`. See `LICENSES.md`.
    Replaces WavLM-base-plus (too heavy for end-side devices).
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
  /** PLiX embedding (pooled to 1-D). */
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
  /** Mean-pooled PLiX embedding of enrolled samples. */
  vector: Float32Array
  /** Optional negative prototype (mean of "not the word" samples). */
  negativeVector?: Float32Array
  sampleIds: string[]
  createdAtMs: number
}

/** Few-Shot configuration (extends the shared config-panel pattern, ADR-017). */
export interface FewShotConfig {
  threshold: number           // PLiX prototype-distance threshold (default 0.7)
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
  /** Ensure the PLiX encoder is loaded (delegates to WavLMEmbedProvider). */
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
User records sample -> quality check -> PLiX embed(sample) -> EnrolledSample
(repeat N times) -> mean-pool embeddings -> WakeWordPrototype -> IndexedDB
```

**Live detection (via `PlixKwsBackend`, a `KWSBackend`):**
```
AFE (16kHz) -> accumulate windowMs of audio -> PLiX embed -> protoDistance(proto)
             -> score [0,1] -> (engine: smooth + threshold + trigger)
```

The `PlixKwsBackend` implements `KWSBackend.processFrame(samples)`: it
accumulates AFE frames into a `windowMs` sliding buffer, runs `embed()` on the
buffer, computes the Prototypical-Network score (negative squared Euclidean
distance to the prototype, rescaled to [0,1]) and returns the score. The generic
KWS engine (worker) handles smoothing, threshold, and trigger - exactly as for the
OpenWakeWord backend. This is the power of the shared `KWSBackend` interface
(ADR-020).

**Cosine similarity:** `cos(a, b) = dot(a,b) / (||a|| * ||b||)`, rescaled to
[0,1] via `(cos + 1) / 2` so the existing threshold/min-duration UI works
unchanged.

## 6. Configuration & constants

| Parameter | Default | Range | Notes |
|---|---|---|---|
| `threshold` | 0.7 | 0.5-0.95 | PLiX prototype-distance score (rescaled [0,1]). |
| `minDurationMs` | 300 | 100-3000 | Sustained activation before trigger. |
| `cooldownMs` | 2000 | 500-10000 | Min time between triggers. |
| `smoothingWindowFrames` | 5 | 1-30 | Sliding-window max-pool. |
| `vadGateEnabled` | true | - | Reuse AFE RNNoise VAD. |
| `vadThreshold` | 0.3 | 0-1 | VAD gate threshold. |
| `windowMs` | 1500 | 500-3000 | Detection window fed to PLiX. |
| `hopMs` | 80 | fixed | Detection hop (= 1 AFE 80 ms chunk). |
| `useNegativePrototype` | false | - | Subtract negative prototype for tighter boundary. |

## 7. Error model & failure modes

- **PLiX load failure** (network/OOM): `loadEncoder()` rejects; UI shows "Failed
  to load PLiX encoder." Mitigation: the PLiX encoder is a compact CNN (far
  smaller than the old WavLM-base-plus); suggest closing tabs if memory-bound.
- **Sample quality failure**: `embedSample` still succeeds but `quality.acceptable
  = false`; UI warns the user to re-record.
- **Distance score NaN** (zero-norm vector): treat as 0 (no match).
- **IndexedDB quota**: `savePrototype` rejects; UI suggests deleting old prototypes.

## 8. Observability

- Enrollment: per-sample quality metrics (level, SNR, duration) shown live.
- Detection: score curve (prototype-distance) + trigger flash, same UI as KWS.
- Dev panel: embedding dimensionality, inference time, prototype norm.

## 9. Testing strategy

- **Unit (Vitest):** squared-Euclidean distance + rescaling, mean-pool prototype, quality
  checks (level/SNR/clipping), trigger logic (reuses KWS `TriggerDetector`).
- **Integration:** load PLiX in Node, embed a test clip, assert non-zero vector;
  build a prototype from 2 embeddings, assert distance(self) = 0 (score = 1.0).
- **Manual:** enroll a 5-sample word -> confirm live detection triggers < 1 s;
  measure false-alarm rate on 5 min ambient speech (target < 1/hour).

## 10. Security & privacy

- All enrollment + detection is **100% client-side**; samples never leave the
  browser (ADR-013 amendment).
- Prototypes + samples stored in IndexedDB (local, user-controlled).
- No audio is transmitted; only the cosine score is emitted to the UI.

## 11. Open questions

- **[Q-FS-1] PLiX ONNX I/O -> RESOLVED.** The encoder is `aaqibsaeed/plixkws`
  (FewshotML/plix, Apache-2.0): a compact CNN (EfficientNet-v2 "base" /
  TinyNet-E "small") trained as a Prototypical Network. Verified I/O: input a
  1x64x100 log-Mel spectrogram (16 kHz, window 400 / hop 160, 64 mel bins,
  60-7800 Hz) -> output [batch, 1280] embedding (global-average-pooled
  penultimate feature). The `PlixKwsEmbedProvider` builds that log-Mel front-end
  internally (no per-utterance normalization) and prefers the `embeddings`
  output. Replaces WavLM-base-plus (too heavy for end-side devices).
- `[Q-FS-2]` Whether to offer the smaller "small" PLiX encoder (TinyNet-E) for
  low-RAM devices (ADR-002 mitigation). Now first-class: select the encoder
  variant at load time.

## 12. References

- Plan: Phase 3 tasks/validation; §4.1 Domain B (PLiX / Few-Shot).
- ADR-002 (PLiX Few-Shot encoder), ADR-013 (enrollment is client-side), ADR-017 (config
  panel), ADR-020 (KWSBackend / EmbedProvider), ADR-021 (device SDK).
- Related module docs: `docs/modules/kws.md` (Phase 2, provides `embed()`),
  `docs/modules/afe.md` (Phase 1, provides 16 kHz output).

## 13. Change log

| Date | Change | Author |
|---|---|---|
| 2026-07-27 | Initial draft (docs-first, pending human review). | agent |
| 2026-07-28 | Q-FS-1 resolved: WavLM-base-plus-sv (512-dim, int8 ONNX); defaults tuned (min-duration 300, smoothing 5). | agent |
| 2026-07-28 | Fix Build-prototype feedback (prototype is state, not a ref) + WavLM detection smoothness (continuous ring buffer, 80 ms hop, zero-order-hold caching; serialization guard moved into each backend). | agent |
| 2026-07-28 | Migrate Few-Shot encoder from WavLM-base-plus to **PLiX** (`aaqibsaeed/plixkws`, Apache-2.0). PLiX is a compact CNN (EfficientNet-v2 "base" / TinyNet-E "small") trained as a Prototypical Network - far lighter and end-side-friendly vs WavLM-base-plus. Scoring is now squared-Euclidean distance to the mean prototype, rescaled to [0,1] via `1/(1+d^2)` (replaces cosine similarity). New `plixkws` backend id, `PlixKwsEmbedProvider` (log-Mel front-end), and `squaredEuclidean`/`plixScore` DSP helpers; `WavLMEmbedProvider`/`WavLMFewShotBackend` removed. | agent |
