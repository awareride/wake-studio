# AFE (Audio Front-End) - Module Specification

- **Status:** Accepted (human review complete; open questions resolved - ADR-016/017)
- **Owner:** WakeStudio team
- **Plan phase:** Phase 1
- **Related ADRs:** ADR-001 (pipeline stages AEC -> BSS -> NS -> KWS), ADR-003 (vendor vs portable AFE), ADR-016 (AFE Phase 1 design decisions), ADR-017 (per-component config panel)
- **Depends on (modules):** none (capture is the source of the audio graph)
- **Last updated:** 2026-07-27

## 1. Purpose

The AFE module captures microphone audio and runs the real-time far-field front-end
pipeline **AEC -> BSS -> NS** (ADR-001), producing a clean 16 kHz mono stream for
the KWS engine (Phase 2) and emitting per-stage data for live visualization. It
delivers the first half of the in-browser experience (requirements R1 and R5).

## 2. Scope & boundaries

- **In scope:** mic capture + resample to 16 kHz mono; the AEC, BSS, and NS stages;
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
  `AudioWorklet`).
- **Downstream (provides to):** KWS engine (Phase 2) consumes the NS output frame
  stream.
- **External libraries / models** (see `LICENSES.md`):
  - WebRTC AEC3 (WASM) - BSD-3 - AEC stage.
  - RNNoise via **`@timephy/rnnoise-wasm`** (Apache-2.0 port of the BSD-3 RNNoise
    core) - NS stage (ADR-016).
  - Silero VAD (ONNX, onnxruntime-web) - MIT - VAD helper for visualization/gating.
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
  channels: 1 | 2;              // default 1 (single-mic passthrough)
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
2. **Graph:** `AudioContext` (native rate, usually 48 kHz) -> `MediaStreamSource` ->
   `AudioWorkletNode('pipeline-processor')`. The worklet receives 128-sample render
   quanta at the context rate.
3. **Inside the worklet, per processing frame (`frameMs`, §6):**
   1. Accumulate + linear-resample to 16 kHz mono.
   2. Run the stage chain **AEC -> BSS -> NS**, each a WASM DSP core, honoring
      per-stage bypass (bypass = copy through). AEC consumes a reference signal
      (loopback from a played test track or file) when available.
   3. Compute per-stage visualization data, throttle to `vizFps`, and
      `port.postMessage({ type: 'frame', data })`.
   4. `port.postMessage({ type: 'output', frame })` for downstream KWS.
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
| `channels` | 1 | 1-2 | 2 only for BSS stereo input; default 1 = single-mic passthrough (ADR-016). |
| `frameMs.aec` | 10 | - | AEC processing frame; configurable per engine (ADR-016). |
| `frameMs.bss` | 10 | - | BSS processing frame; configurable per engine. |
| `frameMs.ns` | 10 | - | NS (RNNoise) processing frame; configurable per engine. |
| `sampleRate` | 16000 | fixed | 16 kHz throughout (ADR-001). |
| `latencyBudgetMs` | 150 | - | End-to-end capture -> display target (R5). |
| `vizFps` | 30 | 15-60 | Throttle for visualization frame emission. |
| `waveformPoints` | 128 | - | Downsampled points per waveform display. |
| `spectrumBins` | 65 | - | Magnitude bins for the spectrogram. |

> **Per-engine frame size (ADR-016):** `frameMs` is configurable **per engine**
> (AEC/BSS/NS independently) to accommodate WebRTC AEC3 vs RNNoise frame
>> requirements; default is 10 ms for all three. Stages buffer/resample internally
> when their frames differ.


**Latency budget breakdown** (target < 150 ms; expected ~45-55 ms on a mid-range
laptop): capture buffer ~10-21 ms + resample <1 ms + AEC ~5 ms + BSS ~2 ms + NS
~5 ms + `postMessage` ~1-5 ms + Canvas render ~5 ms + display refresh ~16 ms.

## 7. Error model & failure modes

- **Mic permission denied / unavailable:** `start()` rejects with
  `MicPermissionError`; UI shows a permission prompt.
- **AudioWorklet unsupported** (no `AudioWorkletNode`): `start()` rejects with
  `UnsupportedBrowserError`; UI shows a "use Chrome / Firefox / Edge" message.
  Safari is best-effort.
- **WASM module load failure** (network/CSP): the affected stage falls back to
  passthrough (auto-bypassed) and the UI flags the pipeline as degraded; audio
  continues through the remaining stages.
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
  known noisy clip asserts SNR improvement > N dB; AEC on a synthetic echo
  asserts ERLE > N dB; resampler correctness against a reference.
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
- WASM modules are fetched over HTTPS from the lazy model registry (ADR-011); the
  Content Security Policy must allow `wasm-unsafe-eval` and the registry asset
  origins.

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

## 12. References

- Plan: §3 (AFE chain), §4.2 (AFE components), Phase 1 tasks/validation.
- ADR-001 (pipeline stages AEC -> BSS -> NS -> KWS), ADR-003 (vendor vs portable
  AFE), ADR-011 (lazy model registry for WASM/model fetch).
- Upstream: WebRTC `audio_processing` (AEC3); RNNoise (xiph); Silero VAD; Web
  Audio API / AudioWorklet spec (W3C).
- Related module docs: `docs/modules/kws.md` (Phase 2, downstream consumer - not
  yet written).

## 13. Change log

| Date | Change | Author |
|---|---|---|
| 2026-07-27 | Initial draft (docs-first, pending human review). | agent |
| 2026-07-27 | Human review: resolved Q-AFE-1..4 (ADR-016); added config panel API + per-engine frame config (ADR-017). Status -> Accepted. | agent |
