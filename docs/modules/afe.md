# AFE (Audio Front-End) - Module Specification

- **Status:** Draft (docs-first - pending human review before implementation)
- **Owner:** WakeStudio team
- **Plan phase:** Phase 1
- **Related ADRs:** ADR-001 (pipeline stages AEC -> BSS -> NS -> KWS), ADR-003 (vendor vs portable AFE)
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
  - RNNoise (WASM) - BSD-3 core; ports: `@timephy/rnnoise-wasm` (Apache-2.0) or
    `simple-rnnoise-wasm` (MIT) - NS stage. _Which port: see [Q-AFE-2]._
  - Silero VAD (ONNX, onnxruntime-web) - MIT - VAD helper for visualization/gating.
  - BSS: 2-mic beamforming approximation or single-mic passthrough - custom DSP,
    no external dep. _Multi-mic default: see [Q-AFE-4]._

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

  /** Live end-to-end latency in ms (capture -> display), for the latency meter. */
  readonly latencyMs: number;
}
```

## 5. Data flow / sequence

**Architecture decision [Q-AFE-1]:** a **single `pipeline-processor` AudioWorklet**
hosts all three stage DSP cores internally, rather than one AudioWorkletNode per
stage. Rationale: lower latency (no inter-node buffer copying, shared WASM heap),
a single `postMessage` stream for visualization, and simpler per-frame state
sharing. The plan's literal "each an AudioWorklet node" wording is superseded by
this recommendation pending human sign-off.

1. **Capture:** `getUserMedia({ audio: { echoCancellation: false,
   noiseSuppression: false, autoGainControl: false } })` - browser DSP disabled so
   ours is the only processing. Request 2 channels only if BSS multi-mic is enabled
   ([Q-AFE-4]); otherwise mono.
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

| Parameter | Default | Range | Notes |
|---|---|---|---|
| `sampleRate` | 16000 | fixed | 16 kHz mono throughout (ADR-001). |
| `frameMs` | 10 | - | RNNoise-native frame; AEC/NS process per frame. _Confirm vs AEC3 frame: [Q-AFE-3]._ |
| `latencyBudgetMs` | 150 | - | End-to-end capture -> display target (R5). |
| `vizFps` | 30 | 15-60 | Throttle for visualization frame emission (audio runs at ~100 fps; viz is downsampled). |
| `waveformPoints` | 128 | - | Downsampled points per waveform display. |
| `spectrumBins` | 65 | - | Magnitude bins for the spectrogram. |
| `channels` | 1 | 1-2 | 2 only if BSS multi-mic is enabled ([Q-AFE-4]). |

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

## 11. Open questions

- **[Q-AFE-1] Node-per-stage vs single pipeline worklet.** Recommendation: a
  single `pipeline-processor` worklet hosting all stage cores (lower latency,
  shared state, one `postMessage` stream) over the plan's literal "each an
  AudioWorklet node". Confirm; if confirmed, update plan Phase 1 task wording.
- **[Q-AFE-2] Which RNNoise WASM port:** `@timephy/rnnoise-wasm` (Apache-2.0) vs
  `simple-rnnoise-wasm` (MIT)? Decide on API ergonomics, maintenance, and
  frame-size compatibility.
- **[Q-AFE-3] Processing frame size.** RNNoise native = 10 ms; WebRTC AEC3 may
  expect a different frame. Need a common frame or an internal resampling buffer
  between stages. Confirm against the chosen WASM ports.
- **[Q-AFE-4] BSS multi-mic.** Default to single-mic passthrough for v1 (most
  laptops have one mic), with 2-mic beamforming as an opt-in when a stereo mic
  array is detected? Or always passthrough in-browser and leave real BSS to
  exported demos (ADR-003)?

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
