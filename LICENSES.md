# LICENSES — Third-Party Component & Model License Matrix

> WakeStudio is a **productization layer** over open-source models and DSP
> components. We do not invent models (see the plan, §1 core principle). This
> file is the source of truth for **what we may bundle, what is demo-only, and
> what we must train ourselves**. It is reviewed and signed off by the human
> before any Phase 0 exit.
>
> **Last verified:** Phase 0 license audit (see "How verified" column).

## WakeStudio itself

- **WakeStudio source code:** MIT (see `LICENSE`, ADR-009).
- **WakeStudio-trained models** (produced by the Phase 5 Studio Engine): owned
  by the user / commercially usable — they do **not** inherit the restrictive
  licenses of the data or tooling, provided we honor each training-data source's
  terms (documented per training run).

## Policy

Every model or component that enters an **export bundle** is classified:

- ✅ **Redistributable** — permissive license; safe in commercial bundles.
- 🟡 **Demo-only / restricted** — may be used in the browser demo or evaluated,
  but **must not** be redistributed commercially. The Phase 4 export gate
  refuses these for "commercial" packages and offers to train a clean
  replacement (Phase 5).
- ❌ **Non-commercial / GPL-incompatible for bundling** — never bundled; only
  run where copyleft/research-only terms permit.

> ⚠️ **Highest risk:** openWakeWord **pre-trained models are CC BY-NC-SA 4.0**
> (non-commercial). They are demo-only. We must always train our own models for
> any commercial export.

## KWS models

| Component | Source | License | Commercial? | Class | How verified |
|---|---|---|---|---|---|
| microWakeWord (training + runtime) | `OHF-Voice/micro-wake-word` (was `kahrendt/microWakeWord`) | Apache-2.0 | Yes (code) | ✅ | Repo license badge + LICENSE (Apache-2.0), now under Open Home Foundation. Uses the TFLite-Micro `micro_speech` preprocessor. |
| Google `speech_embedding` backbone | re-implemented in openWakeWord; original on TFHub | Apache-2.0 | Yes | ✅ | openWakeWord README + TFHub module page. |
| openWakeWord **code** | `dscripka/openWakeWord` | Apache-2.0 | Yes (code) | ✅ | Repo license badge + README "License" section. |
| openWakeWord **pre-trained models** | `davidscripka/openwakeword` (HuggingFace) | **CC BY-NC-SA 4.0** | **No** | 🟡 Demo-only | README: "pre-trained models … CC BY-NC-SA 4.0 … due to … datasets with unknown or restrictive licensing". Highest-risk item. |
| WavLM-base-plus encoder (Few-Shot, **superseded**) | `microsoft/wavlm-base-plus` | MIT | Yes | ✅ | Repo license (MIT). **Replaced by PLiX** as the Few-Shot encoder (WavLM-base-plus was too heavy for end-side devices - see PLiX row). Kept for reference only. |
| PLiX Few-Shot encoder (`plixkws`) | `aaqibsaeed/plixkws` (FewshotML/plix) | Apache-2.0 | Yes | ✅ | Repo LICENSE (Apache-2.0). Compact CNN (EfficientNet-v2 "base" / TinyNet-E "small") trained as a Prototypical Network; 1280-dim embedding for prototype-distance matching. Replaces WavLM-base-plus as the in-browser Few-Shot encoder. Published weights are PyTorch `.pt` (Dropbox); export to ONNX before bundling. |
| Custom-verifier (scikit-learn logistic regression) | openWakeWord `train_custom_verifier` | Apache-2.0 | Yes | ✅ | Part of openWakeWord code (Apache-2.0). |
| PocketSphinx (lightweight KWS alt, ADR-020) | `cmusphinx/pocketsphinx` | BSD-style (CMU); bundles WebRTC VAD (BSD-3) in `src/vad` | Yes | ✅ | Repo `LICENSE` (Carnegie Mellon University, BSD-style redistribution terms); bundled WebRTC VAD is BSD-3. Verified via the repo LICENSE file.
| `kws_streaming` **code** (Traditional streaming-aware models + training, ADR-024 §2.1) | `google-research/google-research` → `kws_streaming` | Apache-2.0 | Yes (code) | ✅ | Repo `LICENSE` (Apache-2.0, Google LLC). Model definitions (dnn…bc_resnet), streaming conversion, and `train/model_train_eval.py`. **Vendored** at `third_party/kws_streaming` (ADR-037 Tier 3, import at `cf61877d`, #156) as an **explicit maintained fork**: pristine import + the two TF >= 2.16 compat patches (2fad2cf, bfda6ec). Runs on the pinned Keras-2 line (ADR-038: TF 2.15.1, numpy 1.26.4, protobuf 3.20.3, Python 3.11) — chosen because pristine upstream cannot run on any installable modern TF. |
| `kws_streaming` **pre-trained models** (upstream) | — | — | — | ✅ n/a | **google-research ships no weights**: only code + experiment recipes. Anything trained from it is ours and commercially clean. |
| Keyword Transformer / att_mh_rnn **pre-trained weights** (shipped as `kws-streaming-*`) | `ARM-software/keyword-transformer` → `models_data_v2_12_labels/{kwt1,kwt2,kwt3,att_mh_rnn_1}` | Apache-2.0 (repo) | Yes | 🟡 Verify before commercial export | Repo `LICENSE.txt` is Apache-2.0 (Arm Limited); the README says "the source files in this repository are released under the Apache 2.0 license". ⚠️ The checkpoints are **data, not source files**, and the repo declares no separate weights license — so Apache-2.0 coverage of the weights is *implied by inclusion*, not stated explicitly. No NC clause exists anywhere (unlike openWakeWord's CC BY-NC-SA models) and the corpus is CC-BY-4.0, so risk is low, but this is not the same standing as an explicit model license. Converted TFLite→ONNX by our own build workflow (adds no third-party code to the artifact). |
| Speech Commands V1/V2 (training corpus for `kws_streaming`; also behind the shipped `kws-streaming-*` weights) | `arXiv:1804.03209`, `download.tensorflow.org/data/speech_commands_*` | CC-BY-4.0 | Yes (with attribution) | ✅ | Dataset paper + the dataset's `LICENSE` (CC-BY-4.0, Google). Downloaded by the training job at train time; **never bundled** into the repo or an export. Attribution required in any release trained on it. |

## AFE components (AEC → BSS → NS)

| Component | Source | License | Commercial? | Class | How verified |
|---|---|---|---|---|---|
| WebRTC AEC3 / `audio_processing` | `google/webrtc` | BSD-3-Clause | Yes | ✅ | WebRTC license (BSD-3). |
| SpeexDSP AEC (alt) | `xiph/speexdsp` | BSD (revised) | Yes | ✅ | Speex license. |
| RNNoise (C, NS) | `xiph/rnnoise` | BSD-3-Clause | Yes | ✅ | Xiph RNNoise COPYING. |
| `@timephy/rnnoise-wasm` (browser NS) | `timephy/rnnoise-wasm` | Apache-2.0 | Yes | ✅ | Repo + npm license field. Fork of `jitsi/rnnoise-wasm`. **Vendored prebuilt** at `src/afe/vendor/rnnoise/` (ADR-016); WASM embedded in `generated/rnnoise-sync.js`. |
| ESP-SR (AEC+NS+BSS, ESP32 export) | `espressif/esp-sr` | Espressif MIT (code) — verify per release | Yes (code, per ESP-SR terms) | ✅ (code) | ESP-SR is MIT-licensed for the audio_front_end; confirm the exact release tag in Phase 4. |
| Vendor AFE (Infineon/TI) | vendor SDKs | Varies | Varies | 🟡 per target | Per-target `LICENSES.md` in Phase 4; some vendor refs may be demo-only. |

## VAD / helpers

| Component | Source | License | Commercial? | Class | How verified |
|---|---|---|---|---|---|
| Silero VAD | `snakers4/silero-vad` | MIT | Yes | ✅ | Repo license (MIT). |
| openWakeWord melspectrogram ONNX | openWakeWord | Apache-2.0 | Yes | ✅ | Part of openWakeWord code (Apache-2.0). |

## In-browser inference / training stack

| Component | Source | License | Commercial? | Class | How verified |
|---|---|---|---|---|---|
| onnxruntime-web | `microsoft/onnxruntime` | Apache-2.0 | Yes | ✅ | ONNX Runtime license (Apache-2.0). |
| @tensorflow/tfjs (only if TFLite-only model) | `tensorflow/tfjs` | Apache-2.0 | Yes | ✅ | TF.js license. |
| Web Audio API + AudioWorklet | W3C standard | Royalty-free | Yes | ✅ | W3C RF policy. |
| fft.js (DSP FFT core, `@wake-studio/dsp` ADR-032) | `indutny/fft.js` | MIT | Yes | ✅ | MIT license (see npm). |

## Device-side runtimes (Phase 4 SDK, ADR-040)

| Component | Source | License | Commercial? | Class | How verified |
|---|---|---|---|---|---|
| onnxruntime (native C API, pinned **1.21.0**) | `microsoft/onnxruntime` | Apache-2.0 | Yes | ✅ | Release tarball `LICENSE` (Apache-2.0). Fetched prebuilt at `third_party/onnxruntime/<host>` (ADR-031 pin, never committed; issue #192 — shared app-class runtime, kws-streaming #194 reuses it). |

## TTS for synthetic training data (Phase 5) — ⚠️ license change

| Component | Source | License | Commercial? | Class | How verified |
|---|---|---|---|---|---|
| Piper (original, archived) | `rhasspy/piper` | MIT | Yes (engine) | ✅ but **archived** | Repo archived Oct 2025; MIT-era binaries still usable but unmaintained. |
| Piper (active dev) | `OHF-Voice/piper1-gpl` | **GPL-3.0** | ⚠️ See note | 🟡 | Active development moved here; **GPL-3.0** (copyleft on distribution). |
| Piper voices | `rhasspy/piper-voices` | **Per-voice** (CC BY 4.0, Blizzard research-only, etc.) | Varies | 🟡 per voice | Each voice's `MODEL_CARD`; some are research-only (Blizzard). |
| espeak-ng phonemizer (used by Piper) | `espeak-ng/espeak-ng` | GPL | — | 🟡 | Linked into Piper; copyleft implications for distributed bundles. |
| `piper-sample-generator` | `rhasspy/piper-sample-generator` | MIT | Yes (tool) | ✅ | Used by microWakeWord for sample generation (training-time only, not distributed). |
| **edge-tts** (multi-language synthesis, ADR-022 data sources) | `rany2/edge-tts` | MIT (client) | Yes (client) | ✅ (tool) | PyPI `edge-tts` is MIT; it calls Microsoft's online TTS service, so the *generated audio's* commercial-use terms follow Microsoft's service terms — verify before commercial redistribution of synthesized clips. Training-time only; the model we train is ours. |

> **Phase 5 implication (newly surfaced in Phase 0 audit):** The Piper engine
> is now **GPL-3.0** (active) or archived-MIT. Because the Studio Engine runs
> **locally** and is **not distributed inside an exported device bundle**, the
> GPL copyleft does **not** infect the exported MCU/Linux bundles — the trained
> model we produce is ours. However, the **Studio Engine binary itself**, if we
> distribute it, must honor GPL-3.0 (we should ship the active Piper under
> GPL-3.0 and document it, or relicense our engine wrapper accordingly). The
> human should confirm the Studio Engine distribution model in Phase 5.

## Build / UI dependencies (all commercially safe)

| Component | License |
|---|---|
| React / React DOM | MIT |
| Vite | MIT |
| `vite-plugin-pwa` | MIT |
| TypeScript | Apache-2.0 |
| Tailwind CSS | MIT |
| ESLint / typescript-eslint | MIT |
| Playwright | Apache-2.0 |
| JSZip (Phase 4 export) | MIT |

## Checklist for the export license gate (Phase 4)

1. Every model in a bundle must be class ✅ (Redistributable).
2. Any 🟡 (demo-only) model is **blocked** for "commercial" exports; the UI offers
   Phase 5 training instead.
3. Each bundle ships its own `LICENSES.md` listing every included component.
4. Vendor AFE licenses are checked per target before adding the reference demo.

## Sign-off

- [x] Human review of this matrix (Phase 0 exit gate).
- [x] Confirm Phase 5 Studio Engine distribution/license model (ADR pending).
