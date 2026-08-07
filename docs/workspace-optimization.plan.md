# Workspace Optimization Plan (review draft)

> **Status:** Draft for human review — nothing implemented yet.
> **Scope:** `apps/web` workspace experience (Workspace view + TopBar + the
> AFE/KWS live pipeline orchestration). Does **not** change the KWS engine /
> AFE worklet DSP internals beyond the source-input + per-stage-persistence
> plumbing that the new UX requires (both are additive seams).
> **Companion ADRs:** ADR-001 (pipeline order), ADR-016 (AFE), ADR-017/025
> (config panel + module specs), ADR-020 (KWS backends), ADR-024 (driver
> decoupling), ADR-026 (L1/L2/L3 tests).

---

## 0. Why this plan exists

The current Workspace renders AFE and KWS as two independent "live panels"
that each mix **configuration** and **real-time effects** inline:

- `AFEPanel` shows `Start microphone`, live stage cards (waveform/level/
  spectrum), a 10 s record-and-replay card, and the config panel all at once.
- `KWSPanel` shows backend selection, engine card (load/start/stop), model
  sources, enrollment, score curve and config in one long column.
- The top Pipeline canvas' Start/Stop only drives the AFE; KWS has its own
  separate "Start detection" — two controls for one pipeline.
- Input is hard-coded to the default microphone; there is no file source, no
  per-stage audio persistence (only a one-shot 10 s raw/processed clip), and
  no recent-project list.

This plan reorganizes the Workspace into a **two-phase flow** —
**Configure first, Preview after start** ("next-step" feel) — and unifies the
run control so the pipeline behaves like a single instrument.

---

## 1. Goals (mapped to your 8 requirements)

| # | Requirement | Plan section |
|---|---|---|
| 1 | Unified start/stop on the top Pipeline view | §2, §3 |
| 2 | Choose components: AFE or KWS; per-AFE-stage toggles | §3 |
| 3 | KWS: preload models (explicit) or auto-load on Start; detection starts automatically | §4 |
| 4 | Input source: enumerate current devices + device options (AEC/NS/AGC), file source with channel loop/offset | §5 |
| 5 | File input: multi-file, channel info, per-channel loop + offset | §5.2 |
| 6 | Per-stage audio persistence + replay; remove the old 10 s record | §6 |
| 7 | Recent-projects list at the top (open a project) | §7 |
| 8 | Config-then-preview split; extract shared viz components (spectrogram/waveform/score) | §8 |

---

## 2. New Workspace layout (single page, two phases)

```
┌──────────────────────────────────────────────────────────────┐
│ TopBar (shell) · Recent projects ▾ · global status chips     │  ← §7
├──────────────────────────────────────────────────────────────┤
│ Workspace header: active project bar (ProjectBar, kept)      │
├──────────────────────────────────────────────────────────────┤
│ Pipeline canvas (top):                                       │
│   [source: mic ▾ | file...]  →  (AEC ▣)(BSS ▣)(NS ▣)(KWS ▣) │
│   + unified ▶ Start pipeline / ■ Stop          ← §3          │
├──────────────────────────────────────────────────────────────┤
│ PHASE 1 — CONFIGURE (before start)                           │  ← §8
│   Step A · Components & input source   (§3 + §5)             │
│   Step B · AFE config (spec-driven, ADR-017)  · [Live AFE    │
│             pipeline]                                        │
│   Step C · KWS config (only when KWS enabled, §4)            │
│             · [KWS detection]  · Model sources  · Enrollment │
│   Step D · Persistence options (§6)                          │
├──────────────────────────────────────────────────────────────┤
│ PHASE 2 — PREVIEW (after start)                              │
│   Pipeline overview (flow + levels + VAD, incl. KWS node)    │
│   Stage cards grid (AEC/BSS/NS/KWS) — shared viz components  │
│   KWS score curve + trigger flash                            │
│   Persistent-clips panel (replay/export)                     │
└──────────────────────────────────────────────────────────────┘
```

**Principle (your requirement 8):** configuration is grouped at the top
(*what you set up*), effects are grouped after Start (*what the pipeline
does*). No more interleaving.

The two existing panel headings **"Live AFE pipeline"** and **"KWS
detection"** are retained as section titles inside Phase 1 (Step B / Step C)
so the current e2e selectors keep working (§9.3). The old `RecordReplay`
10 s card is **removed** and replaced by the persistence panel (§6).

---

## 3. Pipeline canvas + unified Start/Stop (requirements 1–2)

### 3.1 New `PipelineCanvas` model

Replace the static 4-node canvas with a **component selection** + **run
control**:

- **Enabled set** (persisted per project in a new `workspace` snapshot key,
  §9.1):
  - `afe: boolean` (master toggle)
  - `afeStages: { aec: boolean; bss: boolean; ns: boolean }` (only editable
    when `afe` on; maps 1:1 to the existing AFE `bypass.*` config, ADR-016)
  - `kws: boolean` (master toggle; when on, opens the KWS config Step C)
- **One run button** that:
  - Start: `ensureSource() → afe.start(sourceCfg)`; then **if KWS enabled**
    → auto-load models if not loaded → auto-start detection (no separate
    "Start detection" button; requirement 3).
  - Stop: KWS stop → AFE stop → teardown persistence capture.
- The button label stays **"Start pipeline"** / **"Stop"**; the canvas keeps
  the subtitle **"AEC → BSS → NS → KWS"** (e2e-compatible).

### 3.2 Runner controller

Introduce `src/workspace/usePipelineRunner.ts` (or a `PipelineController`)
that owns:

```
state: { source, afeRunning, kwsStatus, kwsRunning, pipelineError, phase }
start():  1. build source (mic deviceId + options | file scheduler)
          2. afe = new AFEPipeline(); apply bypass/afeStages; afe.start(sourceCfg)
          3. if kws.enabled: await ensureKwsLoaded(); kws.start(afe.onOutput)
stop():   kws.stop() → afe.stop() → release source
```

This replaces `WorkspaceView`'s current `afeCommandRef` plumbing and the
KWS panel's separate start/stop buttons (the panel keeps **Load/Reload** as
explicit preload controls, §4).

### 3.3 Status bar truth

- `mic` active only while AFE runs.
- `worker` running only when a KWS worker is actually loaded.
- `detection` running only when KWS is enabled **and** running (today it
  wrongly shows "running" for mic-only AFE).
- `model` loading/ready/error wired from KWS load (today never set — a top-bar
  chip that is always idle; fix in the runner).

---

## 4. KWS: preload vs auto-load + automatic detection (requirement 3)

Behavior in Step C (visible only when KWS enabled):

1. **Backend + driver + model-source config** (reuse the exported helpers
   `driverParamsFor`, `modelSourcesForRole`, `modelUrlsFromRegistry` from
   `KWSPanel` — §8.3). Keep the existing e2e-pinned texts: "Backend" select,
   "Model sources", "Mel front-end" / "Wake-word classifier" comboboxes,
   "Configuration (backend · Primary)" heading.
2. **Two paths to become ready:**
   - *Manual preload:* "Load models" / "Reload models" (kept, e2e-pinned).
   - *Auto (gated by a preload toggle):* clicking the unified **Start
     pipeline** with KWS enabled and `status !== 'ready'` runs the same
     `handleLoad` first, waits for `ready`, then starts detection. This is
     controlled by a **"Preload KWS on start" toggle (default ON)** in
     Step C — when OFF, Start runs AFE only and KWS stays idle until the
     user manually Loads (avoids surprise multi-minute model fetches, e.g.
     sherpa ~53 MB). If auto-load fails, Start shows the error and leaves
     the pipeline idle.
3. **Detection starts automatically** once AFE is running and the engine is
   ready — the unified Start does it; there is **no separate "Start
   detection"** control. The KWS panel's per-panel Start/Stop buttons are
   removed (Stop detection stays available while running as an e2e-pinned
   "Stop detection" button in the KWS preview card, §9.3).
4. **Few-Shot (plixkws) special case:** enrollment (Record sample / Build
   prototype) stays in Step C; auto-start with plixkws requires a built
   prototype — if missing, Start shows "Build a prototype first" and does not
   launch KWS.

### 4.1 Fixes this plan includes (real gaps found in audit)

- **Dead few-shot controls:** the "Few-Shot detection parameters" panel
  currently renders the **KWS-engine** `describeParameters()` (which lacks
  `windowMs` / `useNegativePrototype`), so those controls never render; and
  `hopMs` / `vadThreshold` are in `FewShotConfig` but in no descriptor.
  Fix: render from the few-shot module's own `describeParameters()` and add
  the missing descriptors (module-level, ADR-017).
- **Unwired few-shot params:** `fsConfig.windowMs` / `useNegativePrototype`
  never reach the plix backend — the driver's `initWithPrototype` hard-codes
  `1500 / false` and the worker's load message has no field for them. Fix:
  thread `backendConfig` (already a `KWSEngine.load` param, currently only
  forwarded to main-thread backends like sherpa) into the worker `load`
  message → plix init. Small protocol extension, backward-compatible.
- **Persistence gaps:** `fsConfig`, driver values, and model-source selections
  are not persisted in the project snapshot; only KWS tunables are. The new
  Step C persists all of them (§9.1).

---

## 5. Input source (requirement 4) + file source (requirement 5)

### 5.1 Microphone source

- New `src/workspace/sources/deviceList.ts`:
  - `enumerateMicDevices()` → `navigator.mediaDevices.enumerateDevices()`,
    filter `kind === 'audioinput'`, label + deviceId (grouped by groupId),
    with a `devicechange` listener to refresh live.
  - First call requests a lightweight `getUserMedia({audio:true})` and stops
    tracks immediately so labels are populated (permission UX), or surfaces a
    "permission needed" hint when labels are blank.
- **AFEPipeline source abstraction:** extend `start()` to accept an optional
  source config:
  ```ts
  interface MicSourceConfig {
    deviceId?: string
    echoCancellation?: boolean   // browser AEC (default false → our NS)
    noiseSuppression?: boolean
    autoGainControl?: boolean
    channelCount?: 1 | 2
  }
  ```
  `getUserMedia` uses these (today they are hard-coded false + default
  device). **Device options are per-device toggles** in Step A (default:
  all false, matching today's behavior — browser DSP off, our RNNoise is the
  only NS).
- The channelCount is surfaced in Step A too (today `channels: 1|2` exists
  in `AFEConfig` but is not editable — no descriptor; we add it host-side in
  Step A, not in the module spec, to avoid module churn).

### 5.2 File source

- New `src/workspace/sources/fileSource.ts`:
  - Add N files (`<input type="file" accept="audio/*">`); decode each via
    `AudioContext.decodeAudioData` (wav/mp3/ogg/flac as the browser allows).
  - **Channel info:** read `AudioBuffer.numberOfChannels`; list one row per
    channel with: channel index, loop toggle, offset (ms, 0..duration).
  - Build a **scheduler** (`FileScheduler`): `AudioBufferSourceNode` per
    file/channel, `loop = toggle`, `start(when, offset)`. **All files and
    channels play concurrently (mixed)**, each with its own loop + offset
    (per confirmed decision §11.3 — not a sequential queue).
  - The scheduler outputs mono by mixing the active channels to
    `inputs[0][0]` of the worklet — the worklet stays mono (no worklet
    change needed for files).
  - `AFEPipeline.start()` gains a `FileSourceConfig` path: instead of
    `getUserMedia` → `MediaStreamAudioSourceNode`, it connects the
    scheduler's `AudioBufferSourceNode`(s) to the worklet. This is the only
    AFEPipeline change for files (the worklet + KWS output path are
    untouched).
- **Resample:** file sources may be 44.1/48 kHz while the pipeline runs at
  48 kHz and KWS expects 16 kHz. The file scheduler decodes into a 48 kHz
  `AudioContext` (WebAudio resamples automatically); the existing worklet
  `downsample48to16` already produces the 16 kHz KWS stream. No new DSP
  needed.

### 5.3 Source summary row

Step A shows the active source as the first canvas node: **Mic (device name)**
or **File (N files / M channels)** so the preview reflects what is actually
feeding the pipeline.

---

## 6. Per-stage audio persistence (requirement 6)

Replace the `RecordReplay` 10 s card with a **persistence panel** that can be
configured in Phase 1 and driven in Phase 2:

### 6.1 Configuration (Step D, before start)

- Per **stage** (v1 scope per confirmed decision §11.1): **raw input, NS
  output, KWS output (16 kHz)** — AEC/BSS are passthrough for v1 (ADR-016)
  and get persistence wiring once real engines land. Each enabled stage has:
  - enable toggle
  - max duration (or "until stop", ring-buffered)
  - (later) sample-rate / downmix option
- Default: all off (zero overhead when not needed).

### 6.2 Capture (during preview)

- Extend the **worklet** `record` message to capture per-stage buffers:
  today it records `raw` + `processed` only, and stages AEC/BSS are
  passthrough for v1 (ADR-016) — so for v1 the meaningful stages are
  **raw (input)** and **NS output** (the current raw/processed split),
  plus **KWS output** captured on the main thread from `afe.onOutput`
  (16 kHz frames, zero worklet change).
- Add a `persist` flag to the `record` message: when on, the worklet keeps a
  ring buffer per enabled stage and streams chunks to the main thread
  (postMessage every ~250 ms) instead of a one-shot promise. This keeps the
  AudioWorklet free of IndexedDB/Blob work.
- KWS-stage capture = the 16 kHz `onOutput` frames already flowing to the
  engine; the runner taps them into the same ring.

### 6.3 Storage + replay

- Per confirmed decision §11.4, the durable output is **files on disk** (not
  just in-app memory): every captured clip is **exported as a WAV file
  download** (browser-supported formats only — no custom codec), and a small
  IndexedDB list `wake-studio-clips` (id, stageId, projectId, duration,
  sampleRate, blob reference / metadata) keeps the session history.
- Replay from the persisted data includes **both audio and waveform
  visualization**: Play reuses the existing `RecordingWaveform`/
  `RecordReplay` playback code (moved into the shared viz lib §8) to draw the
  clip's waveform while it plays.
- Old `RecordReplay.tsx` is removed; its playback + waveform-draw helpers are
  moved into the shared viz lib (§8).

---

## 7. Recent projects in the top bar (requirement 7)

- `TopBar` (shell.tsx) gains a **Recent projects** `DropdownMenu`:
  - List `projects.slice(0, 5)` (already sorted by `updatedAtMs` desc in
    `listProjects`, MRU order ready) with name + "updated …" caption.
  - Selecting calls `selectProject(id)` (already persisted in localStorage);
    navigating to `/workspace` if not already there.
  - "+ New project…" entry opens the same dialog as `ProjectBar`.
- `ProjectBar` stays in the Workspace header (its create dialog + fields are
  e2e-pinned, §9.3).

---

## 8. Config-before-preview split + shared viz components (requirement 8)

### 8.1 Phase 1 — Configure (top, before Start)

- **Step A · Components & source** (§3.1 + §5): component toggles + source
  selector (device list / file list / device options).
- **Step B · AFE** ("Live AFE pipeline" heading kept): the existing
  `UnifiedConfigPanel` (spec-driven `describeParameters()`, ADR-017) with all
  params bound — including `topology` / `latencyBudgetMs` that today render
  without values (fix), plus the `bypass.*` stage toggles that now also
  mirror Step A's stage toggles. Bypass changes **persist** to the project
  (today only `vizFps` is persisted — fix).
- **Step C · KWS** ("KWS detection" heading kept, only when KWS enabled):
  backend select → driver params (spec-driven) → tunable params → model
  sources → (few-shot) enrollment. All values persisted (§9.1). Manual
  "Load models"/"Reload models"/"Load PLiX encoder" kept.
- **Step D · Persistence** (§6.1).

### 8.2 Phase 2 — Preview (after Start)

- Pipeline overview (flow + levels + VAD) extended with a **KWS node** and
  the **source** node (today `PipelineOverview` only shows AEC/BSS/NS).
- Stage cards grid using the **shared** viz components below.
- KWS score curve + trigger flash (from the runner's subscriptions, logged to
  the session console as today).
- Persistent-clips panel (§6.3).

### 8.3 Shared viz library (extract, don't duplicate)

Move the canvas/effect components out of the panels into
`apps/web/src/components/viz/` (reused by Phase 2 and by the panels until
they are fully folded in):

| Component | From | Notes |
|---|---|---|
| `WebGLSpectrogram` | already standalone | keep (ADR-032) |
| `WaveformCanvas` | `AFEPanel` (file-local) | extract + export |
| `LevelBar` | `AFEPanel` (file-local) | extract + export |
| `StagePanel` (stage card) | `AFEPanel` (file-local) | extract, parameterize kind (`aec/bss/ns/kws`) |
| `drawScoreCurve` / score-curve component | `KWSPanel` (file-local) | extract + export |
| `RecordingWaveform` / playback helpers | `RecordReplay` | move |
| `PipelineOverview` | standalone | extend with KWS + source nodes |
| `PipelineCanvas` (selection + run) | standalone | rewrite per §3 |

Also move the reusable KWS helpers (`driverParamsFor`,
`modelSourcesForRole`, `modelUrlsFromRegistry`) out of `KWSPanel.tsx` into
`src/workspace/kws-config.ts` so Step C and the (kept) panel share one source
of truth.

---

## 9. Persistence model + migration

### 9.1 Project snapshot

- New `WorkspaceConfig` type + `workspace` key in `ProjectConfigSnapshot`
  (**optional** so existing IndexedDB projects load unchanged; no DB bump
  needed — `defaultConfigSnapshot()` fills it on new projects):
  ```ts
  interface WorkspaceConfig {
    enabled: { afe: boolean; kws: boolean; afeStages: { aec: boolean; bss: boolean; ns: boolean } }
    source: { kind: 'mic' | 'file'; deviceId?: string; micOptions: MicSourceConfig; files: FileSourceItem[] }
    kws: {
      modelSources: Record<string, string | undefined>
      customUrls: Record<string, string>
      driverValues: Record<string, ParamValue>
    }
    persistence: Record<PersistStageId, { enabled: boolean; maxSeconds?: number }>
  }
  ```
- `useProjectStageConfig('workspace')` seeds + persists Step A/B/C/D state on
  project switch (the panels remount by `key={current.id}` today — the
  workspace view does the same).
- Fix the today-missing persists: AFE bypass + full params, KWS driver values,
  model sources, `fsConfig` (few-shot), and sync `project.sampleIds` /
  `project.prototypeIds` when a prototype is built/deleted.

### 9.2 Clips store (new)

`wake-studio-clips` IndexedDB (id, projectId, stageId, name, durationMs,
sampleRate, blob) — independent of the projects DB.

### 9.3 E2E compatibility

The redesign **keeps these current selectors working** (verified in audit) to
avoid churning ~25 assertions across 6 specs; any that must move are updated
in the same PR:

- smoke: headings "Live AFE pipeline", "KWS detection", "Configuration
  (backend", "Model sources", "AEC → BSS → NS → KWS", "PLiX Few-Shot
  enrollment"; buttons "Load models", "Load PLiX encoder"; Backend select;
  "Mel front-end" combobox; "Tunable parameters" hidden for plix.
- model-source-ui: "Model sources", "Mel front-end" / "Wake-word classifier"
  comboboxes, `option[value=openwakeword-alexa|hey-jarvis]`, custom-URL
  input, file-import flow, "Saved: …".
- kws specs: "Load models", "Reload models", "Load PLiX encoder", "EP:
  WASM/WebGPU", "Stop detection", "PLiX encoder loaded".
- project flow: "New project…", "Project name"/"Wake word" textboxes,
  "E2E Word" name visible + survives reload.

New e2e to add: component toggles gate the KWS config step; unified Start
with KWS enabled auto-loads (assert `EP:` label appears after clicking Start
without pressing Load); file source adds a file and shows channel rows;
persistence panel lists a clip after a short run; TopBar recent-project list
opens a project.

---

## 10. Suggested implementation order (each a reviewable PR)

1. **Foundations** — shared viz extraction (§8.3) + `WorkspaceConfig` +
   persistence fixes (§9.1) + few-shot descriptor/wiring fixes (§4.1).
   No UX change; green tests.
2. **Input source** — `deviceList` + `AFEPipeline` source abstraction
   (mic options) (§5.1) + source row in canvas.
3. **File source** — decoder + `FileScheduler` + per-channel loop/offset UI
   (§5.2).
4. **Pipeline runner + unified Start/Stop** — `usePipelineRunner`, component
   selection canvas, auto-load/auto-detect KWS (§3, §4).
5. **Per-stage persistence** — worklet persist flag, clips store, replay/
   export panel (§6); remove `RecordReplay`.
6. **Recent projects in TopBar** (§7).
7. **Config/preview step layout** — restructure `WorkspaceView` into Phase 1
   (Steps A–D) + Phase 2 (preview) (§2, §8); keep e2e texts; add new e2e.

Steps 1–3 land without touching the run UX; 4–7 reshape it. Each PR keeps
`pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, and the e2e suite green.

---

## 11. Decisions (confirmed by human, 2026-08-07)

1. **Per-stage persistence v1 scope: raw / NS / KWS only.** AEC/BSS are
   passthrough for v1 (ADR-016); their persistence wiring lands with the
   real engines. → §6 updated.
2. **KWS load on Start: keep auto-load but gate it behind a "preload"
   toggle (default ON).** When ON, Start auto-loads models if not ready;
   when OFF, Start runs AFE only until models are loaded manually.
   → §4 updated.
3. **File source model: multiple files play concurrently (mixed),** each
   file/channel with its own **loop + offset** controls. → §5.2 updated.
4. **Persistence output: persist to files (WAV download to disk)** plus an
   IndexedDB list; **replay from persisted data includes both audio and
   waveform visualization**; browser-supported formats only. → §6 updated.
5. **Project snapshot key: `workspace`** confirmed. → §9.1.

> Open question carried forward: persistence default duration — recommended
> until-stop ring with a configurable cap (e.g. 60 s/stage), settable in
> Step D.
