# ASR-Decoding KWS - Module Specification

- **Status:** Accepted (docs-first; implemented Phase 2-ext, ADR-024)
- **Owner:** WakeStudio team
- **Plan phase:** Phase 2-ext (P0 integration, ADR-024)
- **Related ADRs:** ADR-011 (lazy model registry), ADR-017 (config panel),
  ADR-020 (pluggable KWS backends), ADR-024 (3-category KWS taxonomy)
- **Depends on (modules):** KWS (`KWSBackend` interface, inference dispatcher),
  AFE (16 kHz output stream)
- **Last updated:** 2026-07-28

## 1. Purpose

ASR-Decoding KWS is the **third KWS category** (docs/kws-categories.md §2.2).
It detects wake words by running a streaming ASR engine (sherpa-onnx) and
matching its decoded token sequence against an **editable text wake-word list**.
Users add/remove phrases without retraining any model — the "model" is the ASR
engine plus the text list.

Per ADR-024 this category is **inference only**: no training or fine-tuning.
The platform reserves (for a later iteration) an expansion interface to add
fine-tuning / a full training pipeline, implemented as a new driver module +
panel — it does not change the shared contracts.

## 2. Scope & boundaries

- **In scope:** streaming ASR (sherpa-onnx wasm), editable wake-word list with
  enable/disable, token-sequence matching (contiguous subsequence + fuzzy
  fallback), matching-threshold trigger, beam-size / VAD-silence / repeated-wake
  suppression (advanced), live transcript view. 100% client-side.
- **Out of scope:** training / fine-tuning (reserved, ADR-024 §2.2); the sherpa-onnx
  wasm + model binaries themselves (fetched by `scripts/fetch-sherpa-assets.mjs`,
  not bundled).
- **Public surface:** `AsrDecodeBackend` (a `KWSBackend`), `matchWakeWords` (pure
  matcher, unit-tested), `AsrDecodePanel` (UI). Reuses the shared `KWSEngine`,
  worker dispatcher, score curve, and trigger logic unchanged.

## 3. Dependencies

- **Upstream:** AFE module (16 kHz mono output, `AFEOutputFrame`).
- **Downstream:** UI (score curve + trigger + transcript); the standardized
  `KWSScoreSample` / `KWSTriggerEvent` shapes (so the rest of the app can't tell
  this backend apart from Traditional/Few-Shot).
- **External:** `sherpa-onnx` (Apache-2.0) wasm build — `sherpa-onnx-wasm-main-asr.js`
  + `.wasm` + `sherpa-onnx-asr.js` — loaded at runtime from `wasmBaseUrl`
  (default `/sherpa-onnx/`, i.e. `public/sherpa-onnx/`). Default model:
  `sherpa-onnx-streaming-zipformer-en-20M-2023-02-17` (Apache-2.0). See
  `public/sherpa-onnx/README.md` and `scripts/fetch-sherpa-assets.mjs`.

## 4. Public API & types

```ts
import type { KWSBackend } from '../kws/types'
import type { AsrDecodeConfig, WakeWordEntry, MatchResult } from './types'

/** A pluggable KWSBackend: ASR-Decoding via token-sequence matching. */
export class AsrDecodeBackend implements KWSBackend {
  readonly id = 'asr-decode'
  readonly label: string
  configure(cfg: Partial<AsrDecodeConfig>): void
  load(urls: never, provider: 'webgpu' | 'wasm'): Promise<void>
  processFrame(samples: Float32Array): Promise<number | null> // [0,1] match confidence
  reset(): void
  dispose(): Promise<void>
  readonly lastPartialText: string // for the live transcript
}

/** Pure token matcher (unit-tested in __tests__/matching.test.ts). */
export function matchWakeWords(
  decodedTokens: string[],
  wakeWords: WakeWordEntry[],
  normalize: boolean,
): MatchResult
```

`processFrame` returns `null` during warmup (no endpoint yet). On an ASR
endpoint it scores the finalized decoded segment: exact contiguous token match
→ confidence 1.0; otherwise a fuzzy (edit-distance) confidence. The generic
smoother/trigger turns that into a trigger when it exceeds `matchThreshold`
(mapped onto `KWSConfig.threshold` by the panel).

## 5. Data flow / sequence

```
AFE (16kHz) -> sherpa-onnx OnlineRecognizer.acceptWaveform
            -> getResult() partial text --(partial msg)--> UI transcript
            -> isEndpoint? -> matchWakeWords(decodedTokens, wakeWords)
               -> confidence [0,1] -> (engine: smooth + threshold + trigger)
               -> reset stream for next segment
```

Repeated-wake suppression: after a match, the same wake word is suppressed for
`repeatSuppressMs` so a held phrase doesn't machine-gun retriggers.

## 6. Configuration & constants

| Parameter | Default | Range | Notes |
|---|---|---|---|
| `modelBaseUrl` | `/sherpa-onnx/models/asr/` | URL | encoder/decoder/joiner/tokens |
| `wasmBaseUrl` | `/sherpa-onnx/` | URL | sherpa-onnx wasm + glue |
| `wakeWords` | `[{ text: 'hey siri' }]` | list | editable, per-entry enable |
| `matchThreshold` | 0.85 | 0-1 | trigger threshold (maps to KWSConfig.threshold) |
| `beamSize` | 4 | 1-32 | ASR decoding beam (advanced) |
| `vadSilenceMs` | 400 | 100-2000 | endpoint trailing-silence (advanced) |
| `repeatSuppressMs` | 1500 | 0-10000 | repeated-wake suppression (advanced) |
| `normalizeTokens` | true | bool | lowercase + strip punctuation |
| `inferenceMode` | `realtime` | realtime/offline | primary selector |

## 7. Error model & failure modes

- **Assets missing:** `loadSherpaAsr` throws a clear "run fetch-sherpa-assets"
  error if the wasm/glue can't load; surfaced in the panel.
- **Model 404:** sherpa-onnx fails to read `encoder.onnx` etc. → load error in
  the panel; verify `modelBaseUrl`.
- **No wake words:** matcher returns `null`/`0`; UI warns "add at least one".

## 8. Observability

- Live transcript (streaming partial decode).
- Match-score curve with threshold line (shared renderer).
- Trigger flash on match.

## 9. Testing strategy

- **Unit (Vitest):** `matchWakeWords`, `tokenize`, `normalizeText`,
  `isContiguousSubsequence`, `tokenEditDistance` — 11 cases in
  `__tests__/matching.test.ts`.
- **Integration:** load sherpa-onnx in a browser, speak a listed phrase →
  trigger fires; edit the list → behavior updates without reload (manual/e2e).
- **e2e:** a Playwright case asserts the ASR panel renders and the load button
  is present (asset-dependent steps are guarded).

## 10. Security & privacy

- 100% client-side; mic audio never leaves the browser. Only the decoded text
  and match score are emitted to the UI. No credentials.

## 11. Open questions

- **[Q-ASR-1] Default model choice.** `zipformer-en-20M` is tiny/English; a
  multilingual default may be preferable for the "editable text" UX. Swappable
  via `modelBaseUrl`; left as English for v1.
- **[Q-ASR-2] Offline file mode.** The `offline` inference mode is exposed in
  the panel but the file-upload path is not yet wired (realtime mic is the v1
  path). Low-risk addition; deferred.

## 12. References

- Plan: ADR-024; docs/kws-categories.md §2.2, §4.1 (ASR panel).
- `sherpa-onnx` (k2-fsa): https://github.com/k2-fsa/sherpa-onnx (Apache-2.0).
- Related module docs: `docs/modules/kws.md` (KWSBackend), `docs/modules/few-shot.md`.

## 13. Change log

| Date | Change | Author |
|---|---|---|
| 2026-07-28 | Initial draft + implementation (P0): AsrDecodeBackend, matcher, panel, worker wiring, fetch script. ADR-024. | agent |
