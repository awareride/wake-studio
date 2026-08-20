# WakeStudio

> ⚠️ **Work in progress.** WakeStudio is under active development — APIs, module
> contracts, and UI are evolving and **may change without notice**. Not yet
> production-ready. See [`docs/roadmap.md`](./docs/roadmap.md) for where things
> stand.

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

**This project is work in progress (WIP).** While phases 0–3 shipped (AFE,
KWS, Few-Shot, console/studio productization) and the module platform
migration (ADR-025) is complete, v1 is not released: everything below can
change. Phase 4 (device SDK + export kits) is underway — the C/C++ SDK core
and the app-class device drivers (openwakeword/sherpa/kws-streaming) have
shipped; target adapters and bundle generation remain. See
[`docs/roadmap.md`](./docs/roadmap.md) for the full phased roadmap and
[`DECISIONS.md`](./DECISIONS.md) for recorded decisions.

| Phase | Goal | Status |
|---|---|---|
| 0 | Foundation, decisions & scaffold | ✅ Complete |
| 1 | In-browser AFE + pipeline visualization | ✅ Complete |
| 2 | KWS inference in the browser | ✅ Complete (pluggable KWSBackend, ADR-020; openWakeWord + sherpa-onnx KWS wasm) |
| 3 | Few-Shot custom wake-word enrollment | ✅ Complete (PLiX embed + prototype-distance, client-side) |
| 3.5 | Console/Studio productization (shell, projects, library, session console) | ✅ Complete |
| 4 | Model export & integration kits (device SDK) | 🔄 In progress (SDK core + app-class device drivers shipped) |
| 5 | Custom-model training (multi-backend) | ⏳ Pending (contract locked, docs/modules/training.md) |
| 6 | Polish, PWA, packaging, docs | ⏳ Pending |

**Module platform (ADR-025)** — generated from per-module scorecards
(`node scripts/gen-module-status.mjs`):

<!-- MODULE-STATUS:generated -->
| Module | Category | Maturity | Core Spec Panel Tests Playground Targets | Score |
|---|---|---|---|---|
| `afe-aec` | afe | draft | ✅✅✅✅✅✅ | 100% |
| `afe-bss` | afe | draft | ✅✅✅✅✅✅ | 100% |
| `afe-graph` | afe | pilot | ✅✅✅✅✅✅ | 100% |
| `rnnoise` | afe | pilot | ✅✅✅✅✅✅ | 100% |
| `few-shot` | few-shot | pilot | ✅✅✅✅✅✅ | 100% |
| `kws-engine` | kws | pilot | ✅✅✅✅✅✅ | 100% |
| `kws-openwakeword` | kws | pilot | ✅✅✅✅✅✅ | 100% |
| `kws-plix` | kws | draft | ✅✅✅✅✅✅ | 100% |
| `kws-sherpa` | kws | draft | ✅✅✅✅✅✅ | 100% |
| `kws-streaming` | kws | pilot | ✅✅✅✅✅✅ | 100% |
| `training` | training | draft | ✅✅✅✅✅✅ | 100% |
<!-- /MODULE-STATUS -->

## Two domains

- **Low-power / MCU** (ESP32-S3, STM32): Traditional classification KWS via
  microWakeWord + TFLite-Micro, with vendor ESP-SR AFE.
- **High-performance** (Linux / Raspberry Pi, Android): Few-Shot metric-learning
  KWS via a frozen PLiX encoder (compact CNN) + prototype-distance scoring, with
  RNNoise + WebRTC AFE.

> **Updated scope (ADR-019..023):** the validated target matrix is now the full
> cross-device set (Arm Cortex-M primary MCU tier; Raspberry Pi; Android & iOS;
> Chrome/Safari/Firefox/Edge; Linux/macOS/Windows desktop; ESP32-S3 deferred). KWS
> is a pluggable `KWSBackend` interface (openWakeWord, sherpa-onnx KWS, PLiX
> Few-Shot, PocketSphinx); all exports build on a layered device-side SDK. See
> `docs/architecture.md` §4–§6. KWS is also organized into three functional
> categories (Traditional / ASR-Decoding / Few-Shot) with a decoupling rule and a
> unified panel spec — see `docs/kws-categories.md` (ADR-024).
>
> **Backend note (2026-07-31):** the former ASR-Decoding category's only
> implementation (`asr-decode` token-matching) was removed in `ba52a61` — it was
> a broken heuristic over an ASR decoder. It is replaced by the
> `sherpa-onnx-kws` backend, which runs a real KWS transducer model via compiled
> WASM in-browser. Category docs: `docs/kws-categories.md`.

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

Fetch runtime assets (sherpa KWS wasm ~53 MB, plixkws ONNX) into the module
`assets/` dirs (gitignored, ADR-011) — each artifact-owning module declares its
own `fetch:all`, and the root command runs them all (ADR-027):

```bash
pnpm fetch:all
```

> The first `pnpm install` requires authorization per `AGENTS.md`.

## WIP tips (working conventions)

Conventions collected during development. Keep them in mind when working on
WIP code; the full list lives in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

- **App UI: Radix first.** Build every piece of app UI on `@radix-ui/*` before
  hand-rolling CSS or adding a new dependency:
  - **Basic components** — `@radix-ui/themes` (Button, Card, Dialog, Select,
    Tabs, …); Radix primitives (`react-dialog`, `react-dropdown-menu`,
    `react-toast`, `react-tooltip`) when Themes doesn't cover the interaction.
  - **Colors** — `@radix-ui/colors` scales (see
    `apps/web/src/settings/accent-colors.ts`); no hand-picked hex values.
  - **Icons** — `@radix-ui/react-icons` (see `apps/web/src/components/icons.tsx`);
    no emoji or ad-hoc SVGs.
  - **Themes** — `@radix-ui/themes` `<Theme>` wrapper (App.tsx `ThemedShell`)
    owns appearance + accent; don't fork your own theming.
  - Fall back to custom CSS only when Radix genuinely can't express the design.

## Key docs

- [`AGENTS.md`](./AGENTS.md) - ground rules for humans and coding agents.
- [`DECISIONS.md`](./DECISIONS.md) - architecture decision records.
- [`docs/module-spec.md`](./docs/module-spec.md) - declarative module spec + panel generator (ADR-025).
- [`packages/dsp/README.md`](./packages/dsp/README.md) - platform DSP package: FFT/STFT/mel (fft.js core + scipy/numpy conformance fixtures, ADR-032).
- [`docs/platform.md`](./docs/platform.md) - the shared platform package (base-path, model registry, seams).
- [`docs/build-artifacts.md`](./docs/build-artifacts.md) - CI-built artifact SOP (ADR-027).
- [`docs/modules/training.md`](./docs/modules/training.md) - training integration contract (ADR-013/023/031).
- [`LICENSES.md`](./LICENSES.md) - third-party license matrix & policy.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) - setup, scripts, conventions.
- `docs/Technical Pre-Research & Feasibility Study_ On-Device Wake Word Detection Systems.md`
  - the pre-research that motivates this project.

## License

WakeStudio source is [MIT](./LICENSE). Integrated third-party models and
components retain their own licenses; see [`LICENSES.md`](./LICENSES.md). In
particular, **openWakeWord pre-trained models are CC BY-NC-SA 4.0** and are
demo-only; commercial exports always use models we train ourselves.
