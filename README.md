# WaveStudio

> Go from "I have a wake-word idea" to "a deployable, testable KWS bundle for my
> target chip" - **without installing any toolchain, runtime, or Python.**

WaveStudio is a Progressive Web App (PWA) that wraps the full far-field voice
pipeline and makes every stage trainable, visible, and exportable.

```
AEC ──> BSS ──> NS ──> KWS
```

It is a **productization layer** over excellent open-source models and DSP
components (microWakeWord, openWakeWord, WavLM, RNNoise, WebRTC, Silero VAD,
ESP-SR). We select, integrate, harden, and package - **we do not invent
models.**

## Status

Phase 0 (foundation, decisions, scaffold) is in progress. See
`.agents/plan/goal.plan` for the full phased roadmap and
[`DECISIONS.md`](./DECISIONS.md) for recorded decisions.

| Phase | Goal | Status |
|---|---|---|
| 0 | Foundation, decisions & scaffold | 🚧 In progress |
| 1 | In-browser AFE + pipeline visualization | ⏳ Pending |
| 2 | KWS inference in the browser | ⏳ Pending |
| 3 | Few-Shot custom wake-word enrollment | ⏳ Pending |
| 4 | Model export & integration kits | ⏳ Pending |
| 5 | Traditional / MCU custom-model training | ⏳ Pending |
| 6 | Polish, PWA, packaging, docs | ⏳ Pending |

## Two domains

- **Low-power / MCU** (ESP32-S3, STM32): Traditional classification KWS via
  microWakeWord + TFLite-Micro, with vendor ESP-SR AFE.
- **High-performance** (Linux / Raspberry Pi, Android): Few-Shot metric-learning
  KWS via a frozen WavLM-base-plus encoder + cosine-similarity prototypes, with
  RNNoise + WebRTC AFE.

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

WaveStudio source is [MIT](./LICENSE). Integrated third-party models and
components retain their own licenses; see [`LICENSES.md`](./LICENSES.md). In
particular, **openWakeWord pre-trained models are CC BY-NC-SA 4.0** and are
demo-only; commercial exports always use models we train ourselves.
