# Module Spec — declarative contract for a WakeStudio module (ADR-025)

- **Status:** Accepted (2026-08-05; validated by the RNNoise pilot + the full
  module migration - 10 modules ship specs)
- **Related:** ADR-025 (module platform), ADR-017 (config panel),
  ADR-026 (testing layers), ADR-027 (build-artifact SOP)

Every WakeStudio module ships a **`module.spec.json`** describing itself. The
panel generator, the playground router, the test runner, and the artifact
fetcher all consume this one file. A module is complete when every section
below is filled in **and** the referenced deliverables exist.

## 1. Lifecycle of a module spec

1. Draft spec (docs-first; matches the repo's docs-first rule).
2. Human review — module boundaries and deliverables are agreed.
3. Implementation — the spec's referenced artifacts (code, tests, playground,
   targets) are built against the spec; the spec is the acceptance checklist.
4. Release — the spec is versioned; the README status table renders from the
   per-module scorecards (no hand-maintained statuses).

## 2. The spec schema

```jsonc
{
  "$schema": "../../module-spec.schema.json",
  "meta": {
    "id": "rnnoise",                 // unique, kebab-case (ADR-030: may differ
                                       // from the dir basename, e.g. id
                                       // "kws-engine" in dir kws/engine/)
    "name": "RNNoise Noise Suppression",
    "category": "afe",               // afe | kws | few-shot | training | data | export | platform
    "version": "1.0.0",
    "maturity": "pilot",             // draft | pilot | stable | deprecated
    "owner": "WakeStudio team",
    "license": "BSD-3-Clause (RNNoise) + MIT (integration)",
    "status": "proposed"             // proposed | accepted | released
  },

  "params": [
    {
      "id": "strength",
      "label": "Noise reduction strength",
      "group": "primary",            // primary | advanced
      "type": "number",              // number | boolean | select | enum | slider | secret
      "default": 1.0,
      "min": 0,
      "max": 1,
      "step": 0.1,
      "unit": "",
      "description": "Aggressiveness of the noise gate.",
      "validation": { "required": true, "if": "vadEnabled" }  // optional
    }
  ],

  "actions": [
    {
      "id": "load",
      "label": "Load RNNoise model",
      "kind": "load",                // load | start | stop | export | train | record | reset
      "confirm": false,
      "progress": "determinate",     // none | determinate | indeterminate
      "requires": ["params.vadEnabled", "platform.mic"]
    }
  ],

  "status": [
    {
      "id": "noiseLevel",
      "label": "Noise level",
      "renderer": "bar",             // bar | waveform | badge | gauge | text | curve
      "source": "event:stageFrame",  // event:<name> | engine:<getter> | spec:<const>
      "refreshMs": 100
    }
  ],

  "runtime": {
    "web": {
      "engine": "AFEPipeline",
      "wasm": { "url": "/modules/afe/rnnoise/rnnoise.wasm", "loader": "classic" },
      "worker": false
    },
    "local": {                        // Node service, if applicable
      "command": "node services/rnnoise/cli.mjs",
      "ports": [],
      "protocol": "stdio"
    },
    "cloud": {                        // CI/Colab, if applicable
      "workflowRef": ".github/workflows/build-rnnoise-wasm.yml",
      "artifact": "rnnoise-wasm"
    },
    "device": {                       // device SDK glue, if applicable (ADR-021)
      "sdkModule": "@wake-studio/sdk-afe",
      "targets": ["arm-cortex-m4", "esp32-s3"]
    }
  },

  "train": {                          // train scripts (ADR-028) OR upstream
    "entry": "train/train.py",        //   local uv script - OR (ADR-031):
    "python": "3.11",                //   "script": { pinned upstream repo script }
    "deps": "train/pyproject.toml",   //   "notebook": { upstream .ipynb }
    "invocation": ["subprocess", "ci"],   // who may invoke: subprocess (studio-backend), ci, colab
    "outputs": { "checkpoint": "out/model.onnx", "metrics": "out/metrics.json" },
    "adapter": "standardize-results"  // optional: normalize ANY run dir into
                                        //   the standard bundle (ADR-031)
  },

  "build": {
    "recipe": "workflow",            // workflow | script | none
    "workflowRef": ".github/workflows/build.yaml",  // generic skeleton (ADR-027 §6.7)
    "script": "scripts/build-<id>.mjs",             // module-owned build logic
    "artifactName": "rnnoise-wasm",
    "toolchains": { "emsdk": "4.0.23" },           // installed by the workflow
    "inputs": [{ "id": "<param>", "label": "...", "type": "string" }]
    "registryEntry": "public/model-registry.json#rnnoise"
  },

  "tests": {
    "l1": "packages/modules/afe/rnnoise/tests/constants.test.ts",        // unit (vitest)
    "l2": "packages/modules/afe/rnnoise/tests/wasm-runtime.test.ts", // Node wasm runtime
    "l3": "e2e/rnnoise.spec.ts",                          // Playwright
    "required": ["l1", "l2", "l3"]
  },

  "playground": {
    "route": "/playground/rnnoise",
    "entry": "packages/modules/afe/rnnoise/web/playground.tsx"
  },

  "interfaces": {
    "provides": [ "AFEOutputFrame" ],      // contracts this module implements
    "consumes": [ "AFEOutputFrame" ]       // contracts it depends on (from other modules)
  }
}
```

## 3. Panel generation rules

- `renderPanel(spec)` is a **pure function**: given a `ModuleSpec`, it returns
  a React component. No module ships hand-written panel JSX.
- Layout is chosen by `meta.category` + the shape of `params`/`actions`:
  - **pipeline** (afe): stage cards + live curve.
  - **classification** (kws): backend select + threshold/smoothing controls +
    score curve.
  - **training** (training): primary/advanced dual layer (ADR-024).
- `group: "primary" | "advanced"` drives the collapsible Advanced section.
- Parameter `type` maps 1:1 to a control; a new type requires a spec change,
  not a new panel.

## 4. Maturity scorecard (per module)

| Axis | Evidence |
|---|---|
| Core | engine/backend headlessly usable, unit-tested (L1) |
| Spec | `module.spec.json` complete, human-reviewed |
| Panel | rendered by generator (no hard-coded panel) |
| Tests | L1 + L2 + L3 all green in CI |
| Playground | route + entry exist and load |
| Targets | web + (as applicable) local / cloud / device deliverables |

A module is "Complete" only when all six axes are satisfied. The README table
is generated from these scorecards.

## 5. Module directory convention

```
packages/modules/<category>/<module>/  # e.g. packages/modules/afe/rnnoise/
  index.ts                        # public exports (contract surface only)
  spec/module.spec.json           # this spec
  core/                           # portable TS: types, DSP, engine facade
  web/                            # wasm loader + panel config + playground.tsx
  node/                           # native/subprocess impl for the studio-backend
  train/                          # train.py + pyproject.toml (uv, ADR-028)
  device/                         # C/C++ + CMakeLists.txt (pulled into device/ tree)
  assets/                         # module-owned binary artifacts (ADR-025):
  │                               #   served at /modules/<category>/<module>/assets/...
  │                               #   gitignored (ADR-011), fetched via ADR-027 SOP
  __tests__/                      # L1 unit + L2 wasm-runtime
e2e/<module>.spec.ts             # L3 browser tests
```

> **Asset location rule (ADR-025):** a module's binary artifacts live in its
> own `assets/` directory, NOT in a central pool. The web app serves them via
> the vite middleware at `/modules/<category>/<module>/assets/...`; the
> legacy `apps/web/prebuilts/` pool was retired (2026-08-05); all assets now
> live in the owning module's `assets/` (Q-K2). Artifacts that ship embedded
> in source (e.g. RNNoise's base64 wasm glue) need no `assets/` entry.

## 5a. Dependency rules (ADR-034)

Modules split into **capability** and **impl** (implementation) classes, and
imports are strictly one-directional:

- **Capability modules** (contracts, kws-engine, few-shot, module-kit,
  platform) define the seams (`registerKwsBackend`, specs, artifact types)
  and may be imported freely by hosts and by each other.
- **Impl modules** (the KWS drivers: openwakeword, plix, sherpa, streaming)
  self-register into those seams at import time. They may be imported ONLY by
  a **composition root** (a wire).

Direction: `contracts ← capability modules ← impl modules`; the only arrow
pointing at an impl module comes from a wire file.

**Wires (generated, committed):**

| Bundle context | Wire file | Imported by |
|---|---|---|
| Host (PWA) | `apps/web/src/module-wire.ts` | `main.tsx` |
| KWS worker | `packages/modules/kws/engine/web/worker-wire.ts` | `web/worker.ts` |

Both wires are generated from the module specs by
`node scripts/gen-module-wires.mjs --update` (a driver = kws category + spec
`runtime.web.worker`, excluding the engine itself); `--check` fails when they
are stale. Adding a driver = adding its spec; the wires regenerate, no host
or capability edits.

**Enforcement:**
- The engine's decoupling test scans `core/` + `web/` (except the worker
  wire) and fails on any driver import; the app's module-wire test does the
  same for `apps/web/src` (except the host wire). Both also run the
  generator's `--check`.
- Cheap grep guard (CI backup):
  `rg "module-kws-(openwakeword|plix|sherpa|streaming)" apps packages --files-with-matches | grep -v -E 'wire'`
  must be empty (test fixtures under `e2e-fixtures/` and `tests/` are
  allowed - they exercise drivers directly).
- The rule is generic: it extends to any future capability/impl split (e.g.
  a second AFE stage implementation) with the same wire pattern.

## 6. Train scripts (ADR-028)

- Every module that needs training ships a `train/` directory:
  `train.py` (or `train.sh` wrapping `uv run python train.py`),
  `pyproject.toml` (pinned deps + python version), and the spec's `train` block.
- Invoked with `uv run --project <module>/train python train.py ...` from the
  module's working directory; artifacts land under `out/` and are registered in
  `model-registry.json` (ADR-027).
- Both the studio-backend (`train-runner.ts`) and CI (`train-<module>.yml`, using
  `astral-sh/setup-uv`) call the same command — one code path, two callers.
- Docker is optional per module, only when system/GPU deps exceed what `uv`
  provides.
