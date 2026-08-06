# kws-plix — PLiX Few-Shot encoder driver

Few-Shot KWS driver exposing the [PLiX](https://github.com/FewshotML/plix)
encoder (compact CNN) as an `EmbedProvider` for prototype-distance matching
(ADR-002/020). Supports two runtimes: ONNX (`onnxruntime-web`, default) and
transformers.js (CDN, no ONNX file).

| | |
|---|---|
| Category | `kws` |
| Maturity | `draft` |
| License | Apache-2.0 (plixkws) + MIT (integration) |
| Engine | `PlixKwsEmbedProvider` (worker) |
| Spec | [`spec/module.spec.json`](spec/module.spec.json) |

## Purpose

Provides the encoder the few-shot module uses to embed enrolled samples and
live audio into 1280-dim embeddings for prototype-distance scoring. The
`few-shot` module consumes this provider; the driver is not used standalone.

## Encoder variants

| Variant | Model | ONNX asset |
|---|---|---|
| `base` | EfficientNet-v2-M | `plixkws-base.onnx` |
| `small` | TinyNet-E | `plixkws-small.onnx` (+ external `.data`) |

Both emit the same 1280-dim embedding from the same 1×64×100 log-Mel
front-end; only compute/params differ. See
[`encoders/plix-encoder.ts`](encoders/plix-encoder.ts) and
[`assets/README.md`](assets/README.md).

## Layout

```
assets/    ONNX graphs + HF-style dirs (gitignored, ADR-011)
core/      backend registration (KWSBackend + EmbedProvider)
encoders/  plix-encoder, onnx/transformers/executorch runtimes, front-end
scripts/   build-plix.mjs (ONNX export), fetch pipeline
web/       playground entry
spec/      module.spec.json
tests/     L1 unit tests
```

## Docs

- [`docs/modules/kws.md`](../../../../docs/modules/kws.md) — KWS module
  specification (ADR-020/024/030).
- [`docs/modules/few-shot.md`](../../../../docs/modules/few-shot.md) — the
  consumer module.
