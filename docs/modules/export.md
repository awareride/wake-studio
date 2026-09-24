# Export — Module Specification

- **Status:** Pilot (generator core implemented for #189; binary staging/ZIP remains #41)
- **Owner:** WakeStudio team
- **Plan phase:** Phase 4 (ADR-021; epic #31)
- **Related ADRs:** ADR-009 (license policy), ADR-011 (asset licensing amendment), ADR-019 (target matrix), ADR-021 (device-side SDK), ADR-025 (module platform), ADR-027 (build artifacts), ADR-040 (SDK core), ADR-047 (device metadata in module specs)
- **Depends on (modules):** SDK (bundle contract, `docs/modules/sdk.md` §9), KWS (per-backend drivers + model files), AFE (portable stages + config)
- **Last updated:** 2026-09-24

## 1. Purpose

The Export module turns a Studio project — a selected target, a KWS backend,
an AFE configuration, and a trained or enrolled model — into a **buildable,
runnable device project bundle**: model files, AFE config, SDK adapter,
generated composition root, `demo/`, `README.md`, `LICENSES.md`, and a
`test/` FAR/FRR script (the layout defined in `docs/modules/sdk.md` §9).
Every export is built upon the device-side SDK (ADR-021): the generator emits
a project *against* the SDK, never a fork of it. The license gate (#42)
blocks non-commercial models from commercial exports.

## 2. Scope & boundaries

- **In scope:** the bundle layout contract; the bundle generator (#189) that
  reads selected modules' `module.spec.json` and emits the CMake target list,
  the composition root, the config file with spec defaults, `README.md`,
  the aggregated `LICENSES.md`, and the FAR/FRR `test/` script; the
  client-side `.zip` assembly of the emitted project (#41).
- **Out of scope:** the SDK itself (owned by the SDK module); training
  (Training module / Phase 5); model hosting and fetch recipes (ADR-027,
  owned by each module's `assets/` recipe); the license *policy* (LICENSES.md
  + ADR-009/011 — this module only aggregates declarations and enforces the
  gate decision).
- **Public surface:** the bundle directory layout; the generator's
  input contract (which spec fields it consumes); the FAR/FRR script
  interface; the license-gate verdict shape consumed by the export UI.

## 3. Dependencies

- **Upstream (consumes from):** SDK (`KWSBackend` C ABI, composition-root
  convention ADR-040 §3, capabilities); KWS drivers (each module's `device/`
  target, ops symbol, model file names); AFE stages (graph order ADR-001,
  per-stage tunables); module specs (`params` defaults, `meta.license`,
  `runtime.device` hints).
- **Downstream (provides to):** the Studio export UI flow (target/backend
  pick → gate verdict → download); Phase 5 training (a trained model is
  commercially ownable only after its FAR/FRR report passes through export).
- **External libraries / models:** JSZip (client-side `.zip` assembly);
  per-bundle model weights as declared by each module (see `LICENSES.md`).
  openWakeWord pre-trained models are CC BY-NC-SA 4.0 (demo-only) and must
  never enter a commercial bundle — the gate enforces this.

## 4. Public API & types

### 4.1 Generator API

The generator is a pure capability in `@wake-studio/module-kit` (ADR-025): it
accepts selected `ModuleSpec` objects and returns a deterministic map of
bundle-relative UTF-8 files. It performs no filesystem writes and imports no ZIP
library, so #41 can stage model bytes and wrap the same file map in a browser
ZIP without coupling browser concerns to the text generator.

```ts
export interface BundleGeneratorInput {
  profile: 'mcu' | 'app'
  kwsBackendId: string
  afeStageIds?: readonly string[]
  labels: readonly string[]
  qualityThresholds: { farThreshold: number; frrThreshold: number }
  specs: readonly ModuleSpec[]
}

export interface GeneratedBundle {
  profile: 'mcu' | 'app'
  kwsBackendId: string
  labels: readonly string[]
  qualityThresholds: { farThreshold: number; frrThreshold: number }
  modules: readonly GeneratedBundleModule[]
  files: Readonly<Record<string, string>>
}
```

Exactly one KWS backend is selected. AFE stages are optional and always emitted
in ADR-001 order (AEC → BSS → NS), independent of caller order. Invalid module
metadata, duplicate registrations, profile mismatches, invalid quality limits,
and empty/duplicate labels fail with a typed `BundleGenerationError` before any
file is returned. FAR/FRR limits are explicit caller input: a module may later
publish recommended defaults in `runtime.device.thresholds`, but the generator
never invents product acceptance thresholds.

### 4.2 Bundle layout (from `docs/modules/sdk.md` §9)

Every emitted bundle is a directory with this shape:

```
<target>-bundle/
├── models/               # driver-declared model files (ADR-040 §4.1: the
│                         # driver reads names it declared from model_dir)
├── labels.json           # keyword labels for the bundled model
├── afe.conf              # generated profile/backend + module-spec defaults
├── CMakeLists.txt        # generated target list (core + selected module device/ dirs)
├── composition_root.cxx  # generated root: one registration line per module (ADR-040 §3)
├── demo/                 # runnable demo (target-idiomatic: .py / .c / .kt / .swift)
├── test/                 # generated composition-root test + FAR/FRR script (§4.4)
├── README.md             # generated: build + run + hardware notes
└── LICENSES.md           # aggregated per-module declarations (see §4.3)
```

### 4.3 License aggregation and gate verdict

Each module declares its license in `meta.license`. The generator emits one
section per selected module into the bundle `LICENSES.md`, with the module id,
version, name, and declaration copied directly from the spec at generation time.
There is no parallel per-module license manifest to drift. The gate (#42)
evaluates the complete model/runtime set before commercial assembly:

```ts
export interface LicenseGateVerdict {
  readonly allowed: boolean;
  readonly commercialUse: boolean;
  readonly blocking: { module: string; license: string; reason: string }[];
}
```

A bundle containing a CC BY-NC-SA model with `commercialUse: true` is
blocked; the UI offers training a clean replacement (Phase 5) instead.

### 4.4 FAR/FRR test script contract

Each bundle ships `test/` with a generated composition-root test plus a script
that, given positive and negative audio sets, reports false-accept and
false-reject rates in a fixed shape:

```
test/
├── composition_root_test.cxx # verifies every emitted registration link + id
├── far_frr.sh                # host POSIX harness; target adapters may wrap it
└── README.md                 # runner + audio-set contract
```

- Inputs: `--positives <dir> --negatives <dir> --config <afe.conf>`.
- `WAKE_FAR_FRR_RUNNER` points to a target-appropriate executable that receives
  `<wav> --config <path>` and returns 0 for trigger, 1 for no trigger.
- Output (stdout): `FAR=<x> FRR=<y> N_POS=<n> N_NEG=<m>` plus per-file lines.
- Exit code: 0 when both rates are under the explicit `qualityThresholds`
  passed to the generator, 1 when a limit is exceeded, and 2 for invalid
  input/runner failures.

## 5. Data flow / sequence

Happy path (Studio export flow):

1. User picks (target profile, KWS backend, AFE mode, model) in the export UI.
2. Generator reads the selected modules' `module.spec.json`: `params`
   defaults → `afe.conf`; `meta.license` → generated license sections;
   `runtime.device` → CMake target list + composition-root lines.
3. License gate evaluates (#42 verdict). Blocked → stop with reasons.
4. Generator emits the deterministic build/config/license/test file map
   (§4.1) and the exact model basenames declared by `runtime.device.modelFiles`.
5. #41 stages model bytes from the owning module's fetched artifact or trained
   result, enables the selected runtime options, assembles the client-side ZIP,
   and packages the SDK/module source trees consumed by the generated CMake
   project.
6. Validation: the emitted project builds natively (host profile) in CI and
   the composition-root test passes (#189 criterion); on-hardware runs are
   golden-path acceptance only (Cortex-M triggers; Pi bundle runs + triggers).

## 6. Configuration & constants

| Parameter | Default | Range | Notes |
|---|---|---|---|
| `targetProfile` | `app` | `mcu` \| `app` | Selects SDK profile macros, heap/threading model (ADR-040 §4). |
| `kwsBackend` | — | driver id (`rms`, `plixkws`, `openwakeword`, `kws-streaming`, `sherpa-onnx-kws`, `microwakeword`) | Must be registered for the profile (capabilities query). |
| `afeMode` | spec defaults | per-stage params | Keys come from each stage's `module.spec.json` `params` — one schema, two worlds. |
| `qualityThresholds.farThreshold` / `frrThreshold` | required explicit generator input | [0,1] | Product acceptance limits emitted into `test/far_frr.sh`; never inferred from a trigger threshold. |

## 7. Error model & failure modes

- Gate-blocked export: hard stop with per-module reasons (never a warning
  the user can click through for commercial use).
- Missing model files while staging the final bundle: fail with the selected
  module's fetch/provenance pointer (ADR-027), never emit a ZIP with dangling
  model paths. The pure #189 generator emits the required-name manifest first.
- Unknown backend id / profile mismatch: fail before emitting (the
  capabilities query is the source of truth for what a profile supports).
- Runtime-gated drivers (no `-DHAS_RUNTIME=ON` build): allowed in the
  bundle only with their runtime staged; `load()` fails loudly on device
  otherwise (never silent warmup in a shipped bundle).

## 8. Observability

- The generator logs which spec version (module id + spec `version`) fed
  each emitted file, stamped into `README.md`, so a bundle is traceable to
  its specs.
- The `demo/` output shape mirrors the browser `KWSScoreSample` /
  `KWSTriggerEvent` (score/VAD/latency per frame), so Studio-side and
  device-side runs are comparable.

## 9. Testing strategy

- **Generator unit (L1):** fixture specs → assert deterministic output, emitted
  CMake target list, canonical AFE order, composition-root lines, config
  defaults/secret redaction, LICENSES sections, model manifest, and FAR/FRR
  thresholds. The generated shell is parsed with `sh -n`.
- **Emitted-project build (native CI, #189 criterion):** generate the
  host-profile project from the real AEC/BSS/RNNoise/openWakeWord specs, build
  it, and run the generated composition-root CTest. The test runs automatically
  in the native CI image (which provides CMake) and reports skipped in shells
  without CMake rather than hiding a build failure when CMake is present.
- **License gate (L1 + CI):** matrix of (model license × commercial flag) →
  verdict; the CC BY-NC-SA × commercial case must block (#42 acceptance).
- **FAR/FRR script:** runs against the repo's trigger-clip / ambient
  fixtures; exact fixture set is an open question below.
- **On-hardware:** golden paths only (Cortex-M trigger, Pi run + trigger).

## 10. Security & privacy

- No credentials are bundled into exported artifacts (ADR-013 security note).
- Mic audio stays on-device in exported deployments; the `test/` script
  processes local audio sets only.
- Licenses travel with every bundle (§4.3); the gate decision is recorded
  in the bundle `README.md`.

## 11. Open questions

- `[Q-EXP-3]` FAR/FRR fixture corpus: which trigger clips + ambient sets
  ship as the canonical fixture, and where do they live (release-hosted
  per ADR-027, or in-repo samples)?

### Resolved during #189

- `[Q-EXP-1]` **Resolved by ADR-047:** extend `runtime.device` with
  `sourceDir`, `cmakeTarget`, `supportedProfiles`, registration kind/id/symbol,
  and model filenames; optional `thresholds` may later carry a module's
  recommended FAR/FRR defaults. Existing device-capable specs are backfilled;
  `meta.license` remains the single module-license declaration.
  micro-wake-word currently has a device implementation but no
  `module.spec.json`; it cannot be selected by the spec-driven generator until
  #185 supplies that module contract.
- `[Q-EXP-2]` **Scoped to #41:** the generator returns a deterministic text file
  map. Binary model staging, streaming/progress behavior for large ZIPs,
  runtime option enablement, and browser download integration remain the client
  ZIP task, not generator-core concerns.

## 12. References

- `docs/modules/sdk.md` §9 (bundle generation contract), §4.1 (model_dir),
  §12 (sequence: bindings → generator #39/#41).
- `docs/roadmap.md` §Phase 4 (export kits, license gate).
- ADRs: ADR-009/011 (license policy), ADR-019 (target matrix), ADR-021
  (device-side SDK), ADR-025 (module platform), ADR-027 (artifacts),
  ADR-040 (SDK core/profiles/composition root), ADR-047 (device metadata in
  module specs).
- Issues: #31 (Phase 4 epic), #41 (bundle layout / client-side zip),
  #42 (license gate), #189 (bundle generator).
- `LICENSES.md` (license matrix); `docs/module-spec.md` (spec platform);
  `packages/contracts/src/module-spec.schema.json` (`runtime.device`).

## 13. Change log

| Date | Change | Author |
|---|---|---|
| 2026-09-24 | #189 generator core: pure file-map API, structured `runtime.device` (ADR-047), real-spec emitted-project test, license/config/test generation. | WakeStudio team |
| 2026-09-21 | Initial draft (docs-first for #189). | WakeStudio team |
