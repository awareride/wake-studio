# kws-streaming — Google Research `kws_streaming` driver

Traditional fixed-class KWS driver (ADR-020/024 §2.1) for models from
[`google-research/kws_streaming`](https://github.com/google-research/google-research/blob/master/kws_streaming/README.md)
(Apache-2.0; paper: *Streaming keyword spotting on mobile devices*,
arXiv:2005.06720). Runs the **external-state** streaming graph over
onnxruntime-web inside the shared KWS worker.

| | |
|---|---|
| Category | `kws` (Traditional) |
| Maturity | `draft` |
| License | Apache-2.0 (`kws_streaming`) + MIT (integration) |
| Engine | `KWSStreamingBackend` (worker) |
| Runtime | onnxruntime-web (no new dependency) |
| Spec | [`spec/module.spec.json`](spec/module.spec.json) |
| Issue | [#72](https://github.com/awareride/wake-studio/issues/72) |

## Purpose

Upstream trains a **non-streaming** Keras model and then automatically converts
it to a **streaming** graph by inserting ring buffers into the time-dimension
layers. In the *external-state* flavour those buffers become explicit graph
inputs and outputs, so the graph is stateless:

```
step(packet, states_in) -> (logits, states_out)
```

That is exactly `KWSBackend.processFrame`, so this driver is a thin
state-carrying loop — no custom runtime, no forked upstream code.

## Why one driver covers 11 topologies

The tensor names, state shapes, packet size and label list differ per topology
(`dnn`, `dnn_raw`, `gru`, `lstm`, `cnn`, `crnn`, `ds_cnn`, `svdf`,
`svdf_resnet`, `ds_tc_resnet`, `bc_resnet`) and per training flags. All of it
comes from a **sidecar manifest** (`model.json`) written at export time, so the
driver code is architecture-agnostic. See
[`docs/modules/kws-streaming.md`](../../../../docs/modules/kws-streaming.md) §4.2.

Non-streamable topologies (`att_rnn`, `att_mh_rnn`, `tc_resnet`, `mobilenet*`,
`xception`, `inception*`) attend/pool over the whole sequence and cannot be
converted upstream — the manifest validator rejects them.

## Status: no weights yet

**Upstream ships code, not weights** — which is the point: anything trained from
it is Apache-2.0-clean and passes the Phase-4 export license gate, unlike the
openWakeWord demo classifiers (CC BY-NC-SA). So the driver is registered and
`browserFeasible`, but `load()` rejects with a pointer to the training panel
until a model exists. `spec.train` wires the **unpatched** upstream
`train/model_train_eval.py` per ADR-031.

Consequently L2/L3 tests are declared as a gap rather than faked: there is
nothing to boot. L1 covers the whole state machine.

## Layout

```
core/     manifest validation, the pure streaming state machine, the backend
spec/     module.spec.json (params, train block, build inputs)
tests/    L1: state carry, packet alignment, label selection, spec integrity
web/      worker-hosted (no main-thread factory needed; playground pending a model)
```

## Reference accuracy (upstream, Speech Commands V2, 12 labels)

| Model | Accuracy | Parameters |
|---|---|---|
| `bc_resnet_1` | 96.4% | ~10K |
| `bc_resnet_2` | 97.6% | 30K |
| `ds_tc_resnet` (MatchboxNet) | 98.0% | 75K |

## Docs

- [`docs/modules/kws-streaming.md`](../../../../docs/modules/kws-streaming.md) —
  this module's specification (open questions Q-KS-1..4 included).
- [`docs/modules/kws.md`](../../../../docs/modules/kws.md) — the engine contract
  (ADR-020/024/030).
- [`docs/kws-categories.md`](../../../../docs/kws-categories.md) §2.1 — the
  Traditional category.
