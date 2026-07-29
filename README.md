# WakeStudio

> Go from "I have a wake-word idea" to "a deployable, testable KWS bundle for my
> target chip" - **without installing any toolchain, runtime, or Python.**

WakeStudio is a Progressive Web App (PWA) that wraps the full far-field voice
pipeline and makes every stage trainable, visible, and exportable.

```
AEC ──> BSS ──> NS ──> KWS
```

It is a **productization layer** over excellent open-source models and DSP
components (microWakeWord, openWakeWord, PLiX, RNNoise, WebRTC, Silero VAD,
ESP-SR). We select, integrate, harden, and package - **we do not invent
models.**

## Status

Phases 0–1 are complete. Phase 2 (KWS) is **paused** while a product-direction
update is folded into the architecture (ADR-019..023: expanded target matrix,
pluggable KWS backends, a device-side SDK, a data-source layer, and a Colab
backend). See `.agents/plan/goal.plan` for the full phased roadmap and
[`DECISIONS.md`](./DECISIONS.md) for recorded decisions.

| Phase | Goal | Status |
|---|---|---|
| 0 | Foundation, decisions & scaffold | ✅ Complete |
| 1 | In-browser AFE + pipeline visualization | ✅ Complete |
| 2 | KWS inference in the browser | ✅ Complete (pluggable KWSBackend, ADR-020; OpenWakeWord pipeline fixed) |
| 2-ext | ASR-Decoding KWS (sherpa-onnx token matching) | ✅ Complete (3rd KWS category, ADR-024) |
| 3 | Few-Shot custom wake-word enrollment | ✅ Complete (PLiX embed + prototype-distance, client-side) |
| 4 | Model export & integration kits (device SDK) | ⏳ Pending |
| 5 | Custom-model training (multi-backend) | ⏳ Pending (Training panel UI scaffolded, §4.2) |
| 6 | Polish, PWA, packaging, docs | ⏳ Pending |

## Two domains

- **Low-power / MCU** (ESP32-S3, STM32): Traditional classification KWS via
  microWakeWord + TFLite-Micro, with vendor ESP-SR AFE.
- **High-performance** (Linux / Raspberry Pi, Android): Few-Shot metric-learning
  KWS via a frozen PLiX encoder (compact CNN) + prototype-distance scoring, with
  RNNoise + WebRTC AFE.

> **Updated scope (ADR-019..023):** the validated target matrix is now the full
> cross-device set (Arm Cortex-M primary MCU tier; Raspberry Pi; Android & iOS;
> Chrome/Safari/Firefox/Edge; Linux/macOS/Windows desktop; ESP32-S3 deferred). KWS
> is a pluggable `KWSBackend` interface (openWakeWord, micro-wake-word, PLiX
> Few-Shot, PocketSphinx); all exports build on a layered device-side SDK. See
> `docs/architecture.md` §4–§6. KWS is also organized into three functional
> categories (Traditional / ASR-Decoding / Few-Shot) with a decoupling rule and a
> unified panel spec — see `docs/kws-categories.md` (ADR-024).

## Quick start

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
pnpm dev          # http://localhost:5173
```

Build the installable PWA:

```bash
pnpm build
pnpm preview
```

> The first `pnpm install` requires authorization per `AGENTS.md`.

## Key docs

- [`AGENTS.md`](./AGENTS.md) - ground rules for humans and coding agents.
- [`DECISIONS.md`](./DECISIONS.md) - architecture decision records.
- [`LICENSES.md`](./LICENSES.md) - third-party license matrix & policy.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) - setup, scripts, conventions.
- `docs/Technical Pre-Research & Feasibility Study_ On-Device Wake Word Detection Systems.md`
  - the pre-research that motivates this project.

## License

WakeStudio source is [MIT](./LICENSE). Integrated third-party models and
components retain their own licenses; see [`LICENSES.md`](./LICENSES.md). In
particular, **openWakeWord pre-trained models are CC BY-NC-SA 4.0** and are
demo-only; commercial exports always use models we train ourselves.
