# few-shot — Few-Shot custom wake-word enrollment

Client-side enrollment of a custom wake word via metric learning (ADR-002/013/020):
record a few samples, embed them with the PLiX encoder, and build a prototype
vector for prototype-distance scoring.

| | |
|---|---|
| Category | `few-shot` |
| Maturity | `pilot` |
| License | MIT (integration); Apache-2.0 (plixkws encoder) |
| Engine | `FewShotEngine` (worker) |
| Spec | [`spec/module.spec.json`](spec/module.spec.json) |

## Purpose

Enables user-defined wake words without training. Enrollment and inference are
100% client-side; this is **enrollment, not training** (ADR-013).

## Features

- Sample recording (1.5 s @ 16 kHz) + quality metrics (peak dBFS, SNR, clip).
- Embedding via the plix driver's `EmbedProvider` (`plixkws` backend).
- Prototype = mean-pooled embeddings; prototype-distance scoring during
  detection.
- IndexedDB persistence of samples + prototypes (`core/storage.ts`).
- Reuses the KWS engine's generic detection loop (threshold, VAD gate,
  smoothing, cooldown).

## Layout

```
core/    FewShotEngine, defaults, types, storage, DSP
web/     worklet recorder URL + playground entry
spec/    module.spec.json
tests/   L1 unit tests
```

## Docs

- [`docs/modules/few-shot.md`](../../../docs/modules/few-shot.md) — Few-Shot
  module specification (ADR-002/013/020).
- [`docs/modules/kws.md`](../../../docs/modules/kws.md) — the KWS engine it
  builds on.
