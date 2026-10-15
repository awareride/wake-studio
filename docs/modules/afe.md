# AFE (Audio Front-End) - Module Specification

- **Status:** Accepted (human review complete; ADR-016/017/029; component selection per ADR-048)
- **Owner:** WakeStudio team
- **Plan phase:** Phase 1 (AFE); module-migration §6.2 (per-stage modules)
- **Related ADRs:** ADR-001 (pipeline stages AEC -> BSS -> NS -> KWS), ADR-003 (vendor vs portable AFE), ADR-016 (AFE Phase 1 design decisions), ADR-017 (per-component config panel), ADR-029 (per-stage modules), ADR-048 (AFE component selection: coexisting options, explicitly selected; amends ADR-016/018)
- **Depends on (modules):** none (capture is the source of the audio graph); the graph module depends on the aec/bss/rnnoise stage modules
- **Last updated:** 2026-10-14

## 0. Module layout (ADR-029)

The AFE is **per-stage modules** + a graph orchestration module (NOT one
module). A new AEC/BSS/NS implementation plugs in behind `AFEStage` without
touching the graph:

| Module | What it is | Implementations | Location |
|---|---|---|---|
| `afe-aec` | AEC stage | v1 passthrough; WebRTC AEC3 future (v1.x) | `packages/modules/afe/aec/` |
| `afe-bss` | BSS stage | v1 single-mic passthrough; beamforming future | `packages/modules/afe/bss/` |
| `afe-rnnoise` | NS stage (one impl) | RNNoise (the shipped pilot module) | `packages/modules/afe/rnnoise/` |
| `afe-graph` | Orchestrates AEC→BSS→NS via `AFEStage`; owns the AudioWorklet | — | `packages/modules/afe/graph/` |

The `AFEStage` interface lives in `packages/contracts`. The graph's worklet
imports the stage modules headlessly (worklet-safe loader sub-entry, no React
in the bundle).

## 1. Purpose

The AFE captures microphone audio and runs the real-time far-field front-end
pipeline **AEC -> BSS -> NS** (ADR-001), producing a clean 16 kHz mono stream for
the KWS engine and emitting per-stage data for live visualization. It delivers
the first half of the in-browser experience (requirements R1 and R5).

## 2. Scope & boundaries

- **In scope:** mic capture; the AEC, BSS, and NS stages (run at the native 48 kHz
  context rate); resample to 16 kHz mono at the KWS output boundary;
  per-stage bypass; real-time visualization data emission; A/B raw-vs-processed
  toggle; 10 s record/replay; end-to-end latency measurement.
- **Out of scope:** KWS inference (Phase 2 - consumes the AFE output); Few-Shot
  enrollment (Phase 3); model export (Phase 4); the vendor AFE used in exported
  demos (ADR-003 - this doc covers the **in-browser** AFE only).
- **Public surface:** an `AFEPipeline` controller the UI drives (start/stop, bypass
  stages, subscribe to viz data, A/B toggle, record) and a processed-output stream
  consumed by downstream KWS.

## 3. Dependencies

- **Upstream (consumes from):** Web Audio API (`getUserMedia`, `AudioContext`,
  `AudioWorklet`); numeric DSP from **`@wake-studio/dsp`** (ADR-032: fft.js
  core + scipy/numpy conformance fixtures).
- **Downstream (provides to):** KWS engine (Phase 2) consumes the NS output frame
  stream.
- **External libraries / models** (see `LICENSES.md`):
  - WebRTC AEC3 (WASM) - BSD-3 - AEC stage. **Deferred to v1.x (ADR-016):** no
    prebuilt AEC3 WASM npm package exists, and in-browser AEC on a laptop is weak
    (no real reference path); for v1 the AEC stage is **passthrough**. True AEC3
    lives in exported demos (ADR-003).
  - RNNoise via **`@timephy/rnnoise-wasm`** (Apache-2.0 port of the BSD-3 RNNoise
    core) - NS stage (ADR-016). The prebuilt WASM is **vendored into the repo** at
    `packages/modules/afe/rnnoise/web/vendor/` (the `.wasm` is embedded as base64 in
    `generated/rnnoise-sync.js`); no runtime fetch, no npm dependency.
  - VAD: for v1 the viz VAD curve uses **RNNoise's built-in VAD score** (returned
    by `processAudioFrame`). Silero VAD (ONNX, onnxruntime-web, MIT) is deferred to
    Phase 2 for KWS gating.
  - BSS: single-mic passthrough by default for v1 (ADR-016); 2-mic beamforming is
    an opt-in when a stereo mic array is detected. Custom DSP, no external dep.

## 4. Public API & types

This is the contract the UI and downstream KWS rely on. The AudioWorklet/MessagePort
internals are implementation details below this surface (sketched in §5).

```ts
/** A named AFE stage in the fixed pipeline (ADR-001). */
export type AFEStageKind = 'aec' | 'bss' | 'ns';

/** Per-frame visualization data emitted by a stage (throttled to vizFps, §6). */
export interface StageFrameData {
  stageId: string;
  kind: AFEStageKind;
  /** performance.now() at capture, for end-to-end latency measurement (§8). */
  capturedAtMs: number;
  /** Downsampled time-domain samples for the waveform display (e.g. 128 pts). */
  waveform?: Float32Array;
  /** Magnitude spectrum for the spectrogram display (e.g. 65 bins). */
  spectrum?: Float32Array;
  /** RMS level in dBFS. */
  levelDb?: number;
  /** Silero VAD speech probability [0,1]. */
  vadProbability?: number;
  /** Stage-specific metrics, e.g. { erleDb: 12.3 } for AEC, { noiseFloorDb: -60 } for NS. */
  metrics?: Record<string, number>;
}

/** One processed output frame delivered to downstream KWS (Phase 2). */
export interface AFEOutputFrame {
  /** 16 kHz mono samples for one processing frame (frameMs long). */
  samples: Float32Array;
  capturedAtMs: number;
  vadActive: boolean;
}

/** AFE topology: how the stage DSP cores are wired (ADR-016). */
export type AFETopology = 'single-worklet' | 'node-per-stage';

/** Per-engine processing frame size in ms (ADR-016; configurable per engine). */
export interface FrameConfig {
  aec: number; // default 10
  bss: number; // default 10
  ns: number;  // default 10
}

/** Full AFE configuration; every field has a default and is surfaced in the
 *  Studio config panel (ADR-017). */
export interface AFEConfig {
  topology: AFETopology;        // default 'single-worklet'
  channels: number;             // declared mic channels, 1..4; default 1 (single-mic)
  referenceChannels: number;    // far-end reference channels, 0..4; default 0
  frameMs: FrameConfig;         // default { aec:10, bss:10, ns:10 }
  latencyBudgetMs: number;      // default 150
  vizFps: number;               // default 30
  // Stage-specific DSP params (e.g. AEC ERLE target, NS attenuation) are
  // declared via describeParameters() below.
}


/** Descriptor for one tunable parameter, used to build the Studio config panel
 *  (ADR-017). Every module exposes its parameters this way. */
export interface ParameterDescriptor {
  id: string;
  label: string;
  type: 'number' | 'boolean' | 'select';
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: ReadonlyArray<{ value: string; label: string }>;
  unit?: string;
  description: string;
}

/** Top-level controller the UI drives. */
export interface AFEPipeline {
  /** Request mic permission and start the pipeline. Resolves on first audio frame. */
  start(): Promise<void>;
  stop(): void;
  readonly running: boolean;

  /** Per-stage bypass control (bypass = copy-through, no DSP). */
  setBypassed(stageId: string, bypassed: boolean): void;
  isBypassed(stageId: string): boolean;
  readonly stages: ReadonlyArray<{ id: string; kind: AFEStageKind }>;

  /** Subscribe to per-frame visualization data. Returns an unsubscribe function. */
  onFrame(cb: (data: StageFrameData) => void): () => void;

  /** Subscribe to the processed output stream (consumed by KWS in Phase 2). */
  onOutput(cb: (frame: AFEOutputFrame) => void): () => void;

  /** A/B toggle: which signal the visualization renders. */
  setABSource(source: 'raw' | 'processed'): void;

  /** Record N seconds of both raw and processed audio for offline replay. */
  record(seconds: number): Promise<{ raw: Float32Array; processed: Float32Array }>;

  /** Current configuration (ADR-016/017). */
  readonly config: AFEConfig;
  /** Update configuration; applied live where safe, otherwise on next start(). */
  setConfig(patch: Partial<AFEConfig>): void;
  /** Declare all tunable parameters + defaults for the Studio config panel. */
  describeParameters(): ReadonlyArray<ParameterDescriptor>;

  /** Live end-to-end latency in ms (capture -> display), for the latency meter. */
  readonly latencyMs: number;
}
```

## 5. Data flow / sequence

**Topology (ADR-016, resolved):** the AFE supports **both** a single
`pipeline-processor` AudioWorklet (all stage DSP cores in one node) and a
node-per-stage layout, selectable via `AFEConfig.topology`. The **single-worklet**
topology is **implemented first** (lower latency: no inter-node buffer copying,
shared WASM heap, one `postMessage` stream); node-per-stage is a later option.
The plan's original "each an AudioWorklet node" wording is superseded by this.

1. **Capture:** `getUserMedia({ audio: { echoCancellation: false,
   noiseSuppression: false, autoGainControl: false } })` - browser DSP disabled so
   ours is the only processing. Request 2 channels only if `config.channels === 2`
   (stereo mic array for BSS); otherwise mono (default, single-mic passthrough).
2. **Graph:** `new AudioContext({ sampleRate: 48000 })` (48 kHz so RNNoise's
   480-sample frames are exactly 10 ms) -> `MediaStreamSource` ->
   `AudioWorkletNode('pipeline-processor')`. The worklet receives 128-sample render
   quanta at 48 kHz.

   The node has **two inputs**: 0 = mic/file planes (channel count from
   `config.channels`, explicit), 1 = the optional far-end reference (issue #245,
   §6.4). An unconnected reference input stays silent and costs nothing.

3. **Inside the worklet, per render quantum (128 samples @ 48 kHz):**
   1. Observe the channels that actually arrived (`inputs[0].length`, plus
      `inputs[1]` when a far-end reference is declared) and accumulate them
      into the per-channel planes until a stage frame is full. NS (RNNoise) consumes
      **480-sample frames @ 48 kHz** (= 10 ms); AEC and BSS are passthrough for v1
      (ADR-016), so they copy through at the quantum level.
   2. Run the stage chain **AEC -> BSS -> NS** at 48 kHz, honoring per-stage bypass
      (bypass = copy through) and each stage's declared geometry: a mono stage is
      fed the graph's downmix, a stage needing a reference is refused without
      one, and nothing spatial runs before the capture is qualified (#245, #246). NS returns a VAD score per frame (used for the viz
      VAD curve in v1).
   3. Resample the NS output to **16 kHz mono** for the KWS output frame (ADR-001).
   4. Compute per-stage visualization data, throttle to `vizFps`, and
      `port.postMessage({ type: 'frame', data })`.
   5. `port.postMessage({ type: 'output', frame })` for downstream KWS.
4. **Main thread:** frame data drives Canvas/WebGL visualizations + the latency
   meter. The A/B toggle selects which stream (raw vs processed) the viz renders.
5. **Record:** the worklet accumulates raw + processed for N seconds and posts both
   on completion.

## 6. Configuration & constants

All parameters are surfaced in the **Studio config panel** with the defaults below
(ADR-017). Each is declared via `describeParameters()` (§4) so the UI can render
controls generically.

| Parameter | Default | Range | Notes |
|---|---|---|---|
| `topology` | `single-worklet` | `single-worklet` \| `node-per-stage` | AFE topology (ADR-016). single-worklet implemented first. |
| `channels` | 1 | 1-4 | Declared mic channels (issue #245). 1 = single-mic passthrough; 2-4 = a declared array, usable only after #246 qualification. |
| `referenceChannels` | 0 | 0-4 | Far-end reference channels (issue #245). 0 = none; >0 requires a reference node at start(). |
| `frameMs.aec` | 10 | - | AEC frame; configurable per engine (ADR-016). AEC is passthrough for v1 (deferred to v1.x). |
| `frameMs.bss` | 10 | - | BSS frame; configurable per engine. Passthrough for v1. |
| `frameMs.ns` | 10 | - | NS (RNNoise) frame = 480 samples @ 48 kHz; configurable per engine (ADR-016). |
| `internalSampleRate` | 48000 | fixed | AFE DSP runs at the AudioContext rate (48 kHz; RNNoise-native). |
| `outputSampleRate` | 16000 | fixed | KWS output is 16 kHz mono, resampled at the output boundary (ADR-001). |
| `latencyBudgetMs` | 150 | - | End-to-end capture -> display target (R5). |

### 6.1 Per-stage runtime parameters (issue #243)

Parameters declared in a **stage module's** `module.spec.json` (`params[]`, minus
the `bypass` pseudo-param, which is a first-class config field) are delivered to
the running engine. Before #243 they were rendered in generated panels but never
reached the audio thread, so every such control was inert.

Delivery path:

```
module.spec.json params[]
  -> AFEPipeline.setStageParams(kind, params)   // main thread
  -> validateStageParams(kind, params)          // spec-checked, throws on problems
  -> MainMessage { type: 'config', stageParams }
  -> worklet _applyStageParams()                // permissively applied
  -> stage.configure(params)                    // AFEStage seam (optional)
  -> engine.setConfig(patch)                    // e.g. RNNoise
```

- **Contract:** `AFEStage.configure?(params)` is optional (a stage with nothing
  configurable omits it). `bypass` stays a separate first-class field because the
  worklet applies it every frame, outside the stage objects.
- **Validation is on the main thread**, against the spec: unknown keys, wrong
  types and out-of-range values throw `AFEParamError` instead of being silently
  dropped. A control that quietly does nothing is worse than a visible error.
- **The worklet stays permissive**: stages ignore unknown keys and clamp values.
  Throwing inside an AudioWorklet callback would tear down the audio thread, so
  the two behaviours are deliberately different.
- `defaultStageParams(kind)` returns the spec defaults for a stage, ready to send.
- Only scalar JSON values can cross the boundary; a non-scalar param is rejected
  at validation time.
- Currently NS (`strength`, `denoiseEnabled`) is the only stage with real params;
  AEC/BSS declare `bypass` only (both are passthrough for v1, ADR-016).

### 6.2 Capture / array qualification (issue #246)

A stereo-looking stream is **not** evidence that two independent microphones
reached the processor: a track can report 2 channels after the OS has downmixed
to mono, duplicated one channel, or reordered them. Any of those silently
destroys spatial processing (a delay-and-sum beamformer fed a duplicated channel
collapses back to a pass-through) while the UI implies an array that is not there.

The worklet therefore feeds every frame's **real `inputs[0]` channel arrays**
into `ChannelProbe` (running sums only — no allocation in the audio thread) and,
after `MIN_OBSERVATION_FRAMES`, posts a `capture-report`. The main thread turns
it into a tri-state verdict via `evaluateQualification()`:

| Verdict | Meaning | Spatial processing |
|---|---|---|
| `qualified` | ≥2 channels delivered, independent content, levels balanced, no clipping | may be enabled |
| `degraded` | weak evidence (too few frames, clipping, high correlation, dead channel) | **not** enabled |
| `unsupported` | <2 channels delivered, or channels are duplicates of each other | **not** enabled |

- `AFEPipeline.getCaptureQualification()` returns the verdict (`null` until
  reported); `isSpatialSupported()` is the boolean gate #245 will consume when
  the configuration-driven geometry lands.
- The verdict is reset on `stop()` — a new capture must be re-qualified.
- **It fails safe**: anything not provably independent stays unsupported and the
  pipeline uses mono passthrough.
- **The verdict is surfaced, not silent.** The source panel shows the tri-state
  verdict with its reasons whenever an array is requested (`CaptureQualificationNote`,
  rendered when the mic channel count is > 1), and spatial stages cannot be
  enabled unless it is `qualified` - a `degraded`/`unsupported` capture falls
  back to mono and the UI states why (issue #246 acceptance criterion 3).
- **Cached per capture signature.** The verdict is remembered per input device +
  requested channel count (`apps/web/src/workspace/qualificationCache.ts`), so
  the panel can say what the last capture on this device looked like *before*
  Start. Two deliberate limits: a cached entry is a UI convenience and is never
  an authorization (the live probe decides while the pipeline runs, and a new
  run re-measures), and the signature covers only what can change the answer
  (device, channel count).
- **Re-runnable on demand.** `AFEPipeline.requalify()` (worklet `requalify`
  message) discards the observation window and reports a fresh verdict, so
  re-plugging an interface or changing the channel count on a running pipeline
  re-measures instead of reusing a stale answer. It throws when the pipeline is
  not running: there is no capture to qualify.
- **Callback discipline is enforced by a test.** `tests/callback-discipline.test.ts`
  asserts the `process()` callback and `ChannelProbe.observe()` contain no
  allocation (`new`, `.slice()`), logging, storage, network, locking or blocking
  primitives, and that `observe()` adds no per-frame state across 100k calls.
  The planar geometry path (issue #245) hands channels to a stage through
  preallocated handoff arrays whose `length` is trimmed, precisely so this
  stays true.
- **Honest limit:** this detects channel count, duplicated/downmixed channels,
  energy imbalance and clipping. It cannot *prove* two channels are physically
  distinct microphones — that needs a calibrated capture or a listening test — so
  `qualified` means "no disqualifying signature found", not "verified hardware".
- A 2-element array still cannot give 360° uniform directivity (ADR-048 §7), so
  a spatial stage must also state its target sector explicitly.

### 6.3 Objective quality harness (issue #247, slice A)

`device/tests/quality/` runs the NS stage over a **deterministic synthetic
corpus** and gates on two metrics, both with unambiguous physics:

1. **Residual on noise-only ground truth** (dB vs input energy). For a noise-only
   input there is no signal to protect, so whatever survives *is* the residual
   noise. Shipped baseline: −22.5 / −23.3 dB (≈93 % removed). Gate: < −6 dB.
2. **Clean-signal preservation** (dB of energy change) on tones and a synthetic
   reverberant tone. This is the over-suppression guard: a denoiser that improves
   SNR by erasing the signal fails here. Baseline −1.16 … −0.02 dB. Gate: within
   ±4 dB, and < 20 % silent frames.

Segmental SNR is reported as a diagnostic only, and PESQ/STOI/DNSMOS are absent
by policy (ADR-048 §9: diagnostics, never the gate) — an unaligned SNR number
across a stage's latency looks authoritative without being meaningful.

- **Corpus:** synthetic and derived from `manifest.json` by `corpus.cxx`. No audio
  is committed (ADR-027 spirit); the generator *is* the artifact. `libc rand()` is
  deliberately not used (implementation-defined), so identical parameters give
  identical samples on every platform — which is what lets a threshold be a gate.
  pyroomacoustics / ssspy remain test-only oracles (ADR-048 §13) and are not
  required.
- **The gate has teeth:** `--known-bad` runs the *pre-#244* device stage with 16 kHz
  audio mislabeled as 48 kHz (the #240 B2 defect) and the harness **must reject
  it**. A second test inverts that exit code, so if the thresholds ever loosen
  until nothing can trip them, CI goes red. A quality gate that cannot fail on a
  known-bad build is decoration.

Both tests run in `ctest`, so a regression is a red build rather than a number in
a log.

**Not yet in place** (same issue, later slices): the workspace stage panels are
still hand-written rather than spec-driven, and param values are not yet
persisted with the project model.

### 6.4 Declared AFE geometry in the browser (issue #245, slice D)

The browser now speaks the same geometry contract the device graph has had
since #245 slice B (`docs/modules/sdk.md` §4.2.2). A stage receives what the
capture actually delivered and declares what it needs; the graph serves the
difference instead of assuming a mono stream.

**One geometry, three places, one test that they agree:**

| Where | What | Checked by |
|---|---|---|
| Device ops (`wake_afe_stage_ops_t`) | `input_channels` / `output_channels` / `reference_channels` | `device/tests/unit/afe_graph.test.cxx` (graph validation) |
| Browser stage engine | `AFEStage.geometry` (+ optional planar `processFrame()`) | `packages/modules/afe/graph/tests/stage-geometry.test.ts` |
| Module spec | `spec.afe.geometry` (+ `capability`) | same test, against the JSON schema |

**Contract.** `AFEConfig.channels` (1..4, default 1) declares the mic array and
`AFEConfig.referenceChannels` (0..4, default 0) declares the far-end reference.
Both are validated on the main thread (`validateGeometry`) and fail loudly
rather than being clamped - a project that declares 5 channels, or a reference
that never arrives, is misconfigured and says so at `start()` / `setConfig()`.

**The worklet node has two inputs.** Input 0 is the mic/file planes; input 1 is
the far-end render signal the app actually plays (a media element, a demo
oscillator), supplied as `start({ reference })`. An unconnected reference input
costs nothing and stays silent. Channel counts are explicit
(`channelCountMode: 'explicit'`) so a stereo capture cannot bleed into the
reference plane through channel-count computation.

**Refusal rules, in the device graph's priority order** (`planStage`,
`core/geometry.ts`, unit-tested):

1. A stage is never fed fewer mic channels than it declared -> **refused**.
2. A stage declaring `referenceChannels > 0` on a capture without a reference
   -> **refused**. This is the structural reason an AEC cannot be enabled by
   accident; it is a declaration check, not a runtime toggle.
3. A mono-declared stage on a multi-channel capture -> the **graph downmixes**
   (allocation-free, into a preallocated scratch plane), so single-mic is the
   degenerate case of the same path rather than a separate code path.
4. A planar-declared stage with no planar `processFrame()` -> **refused**.

**The #246 gate is enforced at the delivery boundary, not only in the UI.** The
qualification verdict is pushed back into the worklet with every config
message; until it is `qualified` the graph serves mono, so a stereo-looking
stream can never reach a spatial stage. The worklet measures what really
arrived (`inputs[0].length`, `inputs[1]?.length`) and never trusts the
declaration; a change in the delivered geometry re-resolves the plan once,
outside the per-frame path.

**Callback discipline.** Every plane the audio path touches is preallocated in
the processor constructor (mic + reference planes, mono scratch, stage slots);
plan resolution happens only when the geometry changes. The per-frame
allocations are the subarray views the frame loop already used before geometry
existed.

**Migration.** No existing caller changes: `channels: 1` and
`referenceChannels: 0` reproduce the previous behaviour exactly (one plane, no
reference, no extra per-frame work), and an existing `module.spec.json` gains
only an optional `afe` block. A module that wants array support declares
`geometry.inputChannels > 1`, implements `processFrame()`, and adds
`capability` from the ADR-048 §7 vocabulary (`fixed_delay_and_sum` /
`doa_steered` / `mvdr_gsc` / `online_auxiva`) - beamformers, never blind
source separation.

**Honest limit:** declaring a geometry does not verify the hardware. A declared
array still depends on the #246 qualification verdict, and `qualified` means
"no disqualifying signature found" (§6.2), not "verified microphones".

| `vizFps` | 30 | 15-60 | Throttle for visualization frame emission. |
| `waveformPoints` | 128 | - | Downsampled points per waveform display. |
| `spectrumBins` | 65 | - | Magnitude bins for the spectrogram. |

> **Per-engine frame size (ADR-016):** `frameMs` is configurable **per engine**
> (AEC/BSS/NS independently) to accommodate WebRTC AEC3 vs RNNoise frame
> requirements; default is 10 ms for all three. Stages buffer/resample internally
> when their frames differ. For v1 only NS is active (RNNoise, 480 samples @ 48 kHz);
> AEC and BSS are passthrough.


**Latency budget breakdown** (target < 150 ms; expected ~40-50 ms on a mid-range
laptop for v1): capture buffer ~10-21 ms + AEC ~0 ms (passthrough) + BSS ~0 ms
(passthrough) + NS ~5 ms + resample to 16 kHz <1 ms + `postMessage` ~1-5 ms +
Canvas render ~5 ms + display refresh ~16 ms.

## 7. Error model & failure modes

- **Mic permission denied / unavailable:** `start()` rejects with
  `MicPermissionError`; UI shows a permission prompt.
- **AudioWorklet unsupported** (no `AudioWorkletNode`): `start()` rejects with
  `UnsupportedBrowserError`; UI shows a "use Chrome / Firefox / Edge" message.
  Safari is best-effort.
- **RNNoise init failure** (WASM compile/CSP): the WASM is vendored (no network
  fetch), so load failure is rare; if it occurs, NS falls back to passthrough
  (auto-bypassed) and the UI flags the pipeline as degraded; audio continues. AEC
  and BSS are already passthrough for v1.
- **Audio context suspended** (autoplay policy): `start()` calls `ctx.resume()`;
  if still suspended, the UI shows a "click to start" affordance.
- **Frame underrun** (processing slower than realtime): drop the oldest frames,
  log a warning, surface it via the latency meter; never block the audio thread.

## 8. Observability

- **Live latency meter:** end-to-end `performance.now()` delta (capture ->
  display), shown in the UI; turns amber/red as it approaches `latencyBudgetMs`.
- **Per-stage status:** ok / degraded / failed + bypass state, surfaced in the UI.
- **Dev panel** (debug): `postMessage` rate, frame-drop count, per-stage
  processing time, current `latencyMs`.
- **Record & replay:** `record(10)` captures raw + processed for offline
  before/after comparison (A/B on a noisy clip).

## 9. Testing strategy

- **Unit (Vitest):** each stage's DSP core against fixtures - e.g., RNNoise on a
  known noisy clip asserts SNR improvement > N dB; resampler correctness against
  a reference.
- **Device quality harness (ctest):** `device/tests/quality` runs the objective
  gate on the device side - `afe_quality_ns` (NS SNR) and `aec_quality` (AEC
  ERLE / near-end SI-SDR over `wake/aec.h`), each paired with a known-bad
  negative control that CI asserts must FAIL. The AEC far end is broadband on
  purpose: against a periodic far end, ERLE cannot tell a correctly-aligned AEC
  from a misaligned one, so the gate would pass while measuring nothing.
- **Integration:** the full `pipeline-processor` worklet via `OfflineAudioContext`
  with a test file, asserting the output matches a golden fixture within tolerance.
- **Manual / on-device:** live mic on Chrome, Firefox, Edge, and Safari
  (best-effort); A/B toggle; confirm the latency meter shows < 150 ms on a
  mid-range laptop; confirm "record & replay" shows a clear before/after.
- **e2e (Playwright):** the Phase 0 smoke test already asserts the pipeline UI
  renders; audio-level e2e is not reliably automatable, so live audio is manual.

## 10. Security & privacy

- Mic audio is captured and processed **100% client-side**; it never leaves the
  browser (R2). `record()` retains clips in memory only for local replay - nothing
  is transmitted or persisted remotely.
- `getUserMedia` requires a secure context (HTTPS or localhost) and explicit user
  permission.
- Browser AEC/NS/AGC are disabled on the `getUserMedia` track so our DSP is the
  only processing (avoids double-processing and opaque vendor DSP).
- RNNoise WASM is **vendored into the repo** at `packages/modules/afe/rnnoise/web/vendor/`
  (ADR-016) - no runtime fetch. Other WASM/models follow the lazy registry (ADR-011)
  from Phase 2 onward. The Content Security Policy must allow `wasm-unsafe-eval`.

## 11. Resolved decisions

All Phase 1 open questions are resolved (ADR-016); the contract is locked.

- **[Q-AFE-1] Topology -> configurable (ADR-016).** Support **both** single-worklet
  and node-per-stage; **single-worklet implemented first** (lower latency, shared
  heap, one `postMessage` stream). Selected via `AFEConfig.topology`.
- **[Q-AFE-2] RNNoise port -> `@timephy/rnnoise-wasm`** (Apache-2.0) (ADR-016).
- **[Q-AFE-3] Frame size -> configurable per engine** (ADR-016). `frameMs.aec` /
  `frameMs.bss` / `frameMs.ns` are set independently; **default 10 ms** for all
  three. Stages buffer/resample internally when frames differ.
- **[Q-AFE-4] BSS -> single-mic passthrough by default for v1** (ADR-016);
  2-mic beamforming is an opt-in when a stereo mic array is detected.
- **Per-component config panel (ADR-017).** The Studio renders a parameter panel
  with defaults for every component; the AFE exposes its tunables via
  `describeParameters()` (§4).
- **AEC3 deferred to v1.x (ADR-016 amendment).** No prebuilt WebRTC AEC3 WASM npm
  package exists, and in-browser AEC on a laptop is weak (no real reference path).
  For v1 the AEC stage is **passthrough**; true AEC3 lives in exported demos
  (ADR-003). Revisited in v1.x.
- **AFE DSP runs at 48 kHz (ADR-016 amendment).** RNNoise requires 480-sample
  frames at 48 kHz; the AFE runs AEC/BSS/NS at the 48 kHz context rate and
  resamples to 16 kHz only at the KWS output boundary.
- **VAD from RNNoise for v1 (ADR-016 amendment).** `RnnoiseProcessor.processAudioFrame`
  returns a VAD score; Phase 1 uses it for the viz VAD curve. Silero VAD
  (onnxruntime-web) is deferred to Phase 2 for KWS gating.
- **Prebuilt WASM vendored into the repo (ADR-016 amendment).** The RNNoise
  prebuilt JS (with embedded WASM) is committed under `packages/modules/afe/rnnoise/web/vendor/`;
  no npm dependency, no runtime fetch.

## 12. References

- Plan: §3 (AFE chain), §4.2 (AFE components), Phase 1 tasks/validation.
- ADR-001 (pipeline stages AEC -> BSS -> NS -> KWS), ADR-003 (vendor vs portable
  AFE), ADR-011 (lazy model registry for WASM/model fetch).
- Upstream: WebRTC `audio_processing` (AEC3); RNNoise (xiph); Silero VAD; Web
  Audio API / AudioWorklet spec (W3C).
- Vendored prebuilt: `packages/modules/afe/rnnoise/web/vendor/` (`@timephy/rnnoise-wasm@1.0.0`,
  Apache-2.0; WASM embedded in `generated/rnnoise-sync.js`).
- Related module docs: `docs/modules/kws.md` (Phase 2, downstream consumer - not
  yet written).

## 13. Change log

| Date | Change | Author |
|---|---|---|
| 2026-07-27 | Initial draft (docs-first, pending human review). | agent |
| 2026-07-27 | Human review: resolved Q-AFE-1..4 (ADR-016); added config panel API + per-engine frame config (ADR-017). Status -> Accepted. | agent |
| 2026-07-27 | ADR-016 amendment: AEC3 deferred to v1.x (passthrough for v1); AFE DSP at 48 kHz (resample to 16 kHz at output); VAD from RNNoise for v1 (Silero -> Phase 2); RNNoise prebuilt WASM vendored at packages/modules/afe/rnnoise/web/vendor/. | agent |
| 2026-10-12 | AEC evaluation harness (#249 slice A): `wake/aec.h` ABI + a conforming reference NLMS + ctest gates with a known-bad negative control. Evaluation spike only - no AEC is wired into the pipeline, and ADR-048 §4 (MCU AEC unresolved) still applies. | agent |
| 2026-10-14 | Browser AFE geometry (#245 slice D): declared mic/reference channels, `AFEStage.geometry` + optional planar `processFrame()`, `spec.afe` block in the module-spec schema, two-input worklet node with a far-end reference path, and the #246 gate enforced at the delivery boundary. New §6.4. | agent |
| 2026-10-15 | Capture qualification made visible (#246): verdict + reasons surfaced in the source panel, per-capture caching, on-demand re-measurement, and a callback-discipline test that also fixed a per-frame `slice()` in the planar path. | agent |
