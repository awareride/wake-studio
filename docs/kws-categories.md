# KWS Categories & Unified Control Panel Specification

- **Status:** Accepted (docs-first; ADR-024)
- **Owner:** WakeStudio team
- **Plan phase:** Cross-cutting (applies to Phases 2, 3, 4, 5)
- **Related ADRs:** ADR-011 (lazy model registry), ADR-017 (per-component config
  panel), ADR-020 (pluggable KWS backends), ADR-021 (device-side SDK),
  ADR-022 (data-source layer)
- **Depends on (modules):** AFE (consumes the 16 kHz output stream), KWS,
  Few-Shot
- **Last updated:** 2026-07-28

> **Purpose.** This document is the canonical product/category spec for WakeStudio's
> Keyword Spotting (KWS) support. It defines the three KWS categories, their
> functional scope (what each may and may not do), the modular architecture that
> keeps adding a category cheap, and the unified two-layer control-panel contract
> every KWS panel must follow. It is the source of truth for the §6 integration
> TODO list (priority-ordered open-source projects).

## 1. Architecture decoupling rule

> **Adding a new KWS type or model project must require only (a) an independent
> driver module and (b) a matching config panel — with no modifications to the
> shared underlying modules.**

The platform is built so that a new KWS category is an *extension*, never a
refactor. The shared modules (§3.1) are stable contracts; a new type plugs in
via its own driver module (§3.2) and its own panel (§4). This rule is what makes
the §6 integration list grow without destabilizing already-shipped categories.

## 2. Supported KWS categories & representative projects

Each category has an explicit **functional scope** (what is supported today) and a
**future extensibility reserve** (what may be added later without breaking the rule).

### 2.1 Traditional Fixed-Class KWS (Train + Inference)

- **Representative projects:** `ARM-software/ML-KWS-for-MCU`,
  `swagshaw/TorchKWS`, `wenet-e2e/WeKws`, `hongfeixue/KWS_pytorch`,
  `micro-wake-word`.
- **Feature:** New keywords require a full model retraining. Supports model
  quantization and export to TFLite / ONNX.
- **Functional scope (this platform):** Fully support the **complete training &
  inference pipelines**.
- **In the repo today:** inference is implemented via the OpenWakeWord driver
  (`packages/modules/kws/openwakeword/core/backend.ts`); a Traditional
  **training** panel is reserved (§4.2) and implemented in Phase 5.
- **Extensibility reserve:** none required — training is already in scope.

### 2.2 ASR Decoding KWS (Inference Only)

- **Representative projects:** `k2-fsa/sherpa-onnx`, `alphacep/vosk-api`.
- **Feature:** Wake-word detection via token-sequence matching; users update a
  **text wake-word list** without retraining any model.
- **Functional scope (this platform):** **Inference only**, with an **editable
  custom wake-word list**. **No training or fine-tuning** capabilities.
- **In the repo today:** **not yet implemented** — this is the one missing
  category. The §6 P0 todo lists `k2-fsa/sherpa-onnx` as the first integration.
- **Extensibility reserve:** the platform reserves an expansion interface to add
  **fine-tuning and a full training pipeline** for ASR-decoding KWS in a later
  iteration (does not change the decoupling rule — it is a new driver module +
  panel).

### 2.3 Few-Shot Meta-Learning KWS (Multi-Weight Inference Only)

- **Representative projects:** `plixkws` (`FewshotML/plix`),
  `harvard-edge/multilingual_kws`.
- **Feature:** Users register new keywords by uploading short audio samples; only
  the **`base_multi` / `small_multi` universal weights** are available.
- **Functional scope (this platform):** **Inference only**, limited to
  **pre-trained multi-language universal weights**; **no custom-language training
  or fine-tuning** functions.
- **In the repo today:** implemented via the PLiX driver + Few-Shot module
  (`packages/modules/kws/plix/`, `packages/modules/few-shot/`) —
  enrollment-based prototype-distance scoring with the `base` / `small`
  encoder variants (ADR-002).
- **Extensibility reserve:** the platform reserves an expansion interface to add
  **fine-tuning and a full training pipeline** for few-shot KWS in a later
  iteration.

### 2.4 Scope matrix (summary)

| Category | Train | Inference | Editable words | Reserved later |
|---|---|---|---|---|
| Traditional Fixed-Class | ✅ | ✅ | via retrain | — |
| ASR Decoding | ❌ | ✅ | ✅ text list | fine-tune + training |
| Few-Shot | ❌ | ✅ | ✅ audio samples | fine-tune + training |

## 3. Modular architecture design

### 3.1 Shared global modules (reused by all KWS types)

These are the stable contracts. Adding a KWS type must **not** modify them.

- **Audio preprocessing** — 16 kHz conversion, mono channel, VAD, framing,
  noise reduction. (Provided by the AFE module; KWS consumes `AFEOutputFrame`,
  ADR-018.)
- **Unified model manager** — local file upload, on-demand CDN download, file
  integrity validation. (Anchored on the lazy registry, ADR-011.)
- **Inference task dispatcher** — owns the generic detection loop (VAD gating,
  score smoothing, threshold + min-duration trigger, threading). (Web Worker in
  `packages/modules/kws/engine/web/worker.ts`; shared by every backend via the
  `KWSBackend` interface, ADR-020.)
- **Model artifact exporter** — client-side bundle generation for export targets
  (ADR-021 / Phase 4).
- **Unified base panel renderer** — renders tunables from a `describeParameters()`
  descriptor generically; the §4 dual-layer layout is a rendering concern only
  (ADR-017).

### 3.2 Independent type-specific modules

Each KWS type ships its own driver module. These are the only files a new type
adds.

- **Traditional KWS** — dataset management, training logic, audio augmentation,
  quantization export.
- **ASR Decoding KWS** — wake-word parser, text-to-token converter,
  multi-keyword matching engine.
- **Few-Shot KWS** — support-set audio upload, feature extraction, prototype
  distance calculation.

> **Decoupling in practice:** the `KWSBackend` interface
> (`packages/modules/kws/engine/core/types.ts`) is the seam. Traditional and
> Few-Shot already implement it. ASR Decoding will
> implement the same interface (its "model" is a text wake-word list + an ASR
> graph), so the shared dispatcher, score-curve rendering, and trigger logic are
> reused unchanged.

### 3.3 Configuration persistence

- **Global shared parameters** (sample rate, VAD gating, cooldown, EP) are stored
  once in a shared config store.
- **Exclusive parameters for each KWS type** are stored separately, keyed by
  category, so a change to one type's panel never leaks into another's.

## 4. Unified control panel specification

All panels adopt a **dual-layer layout**:

- **Primary Config** — shown by default; the few knobs a user needs most.
- **Collapsible Advanced Detailed Config** — tucked behind a disclosure; for
  professional fine-tuning.

This balances ease of use against depth. The renderer is shared (§3.1); only the
parameter descriptors differ per type.

### 4.1 Inference panel parameters

**Traditional Fixed-Class KWS**

| Layer | Parameters |
|---|---|
| Primary | Model selector, inference mode (offline file / real-time mic), confidence threshold, output mode |
| Advanced | Mel/MFCC settings, inference acceleration, post-processing smoothing, log export toggle |

**ASR Decoding KWS**

| Layer | Parameters |
|---|---|
| Primary | ASR model selection, editable wake-word list, matching threshold, inference mode |
| Advanced | Token conversion parameters, decoding beam size, VAD adjustment, repeated-wake suppression |

**Few-Shot KWS**

| Layer | Parameters |
|---|---|
| Primary | Multi-encoder variant (small / base), inference runtime (ONNX / Transformers.js), support-set audio manager, distance threshold |
| Advanced | Mel preprocessing, frame cache size, feature smoothing, embedding visualization |

### 4.2 Training panel (exclusive to Traditional KWS)

| Layer | Parameters |
|---|---|
| Primary | Dataset import, network architecture selection, epoch / batch size / initial learning rate, target keyword list |
| Advanced | Audio augmentation rules, optimizer & scheduler settings, quantization export rules, early stopping, GitHub Action cloud conversion |

> The Training panel exists **only** for the Traditional category (§2.1). The
> other two categories are inference-only by scope (§2.2, §2.3); their reserved
> training/fine-tuning expansion (§2.2/§2.3) would add a new driver module +
> panel, not modify this one.

## 5. Core extensibility rules

1. **Unified abstract interface for all model loading logic.** Every KWS type
   loads models through the same `KWSBackend` / model-manager seam (§3.1), so a
   new type is a new adapter — not a new loading path.
2. **Standardized inference event output structure for frontend rendering.**
   The frontend consumes a single `KWSScoreSample` / `KWSTriggerEvent` shape
   (see `packages/modules/kws/engine/core/types.ts`); the underlying KWS type is **not** distinguished in
   the rendered output. A Traditional, ASR-Decoding, or Few-Shot trigger looks
   identical to the UI.

## 6. Integration TODO list of mainstream open-source KWS (by priority)

### P0 — Core mandatory

- [ ] **Traditional:** `ARM-software/ML-KWS-for-MCU`, `swagshaw/TorchKWS`
- [ ] **ASR Decoding:** `k2-fsa/sherpa-onnx`
- [ ] **Few-Shot:** `plixkws` (`FewshotML/plix`)

> **Note:** `plixkws` is already integrated as the Few-Shot backend (Phase 3).
> The P0 Traditional and ASR-Decoding entries are not yet implemented in the
> browser and are the next driver-module + panel additions under the decoupling
> rule (§1). No new projects in this list are fetched or bundled yet — they are
> enumerated here as integration intent only (see ADR-024).

## 7. References

- `docs/architecture.md` §4 (model selection), §6 (target matrix).
- `docs/modules/kws.md` (Traditional/Few-Shot `KWSBackend` contract, ADR-020).
- `docs/modules/few-shot.md` (Few-Shot enrollment + PLiX encoder, ADR-002).
- `DECISIONS.md` ADR-011, ADR-017, ADR-020, ADR-021, ADR-022, ADR-024.

## 8. Change log

| Date | Change | Author |
|---|---|---|
| 2026-07-28 | Initial draft (docs-first). Codifies the 3-category taxonomy, decoupling rule, scope matrix, modular architecture, dual-layer panel spec, and P0 integration TODO. | agent |
