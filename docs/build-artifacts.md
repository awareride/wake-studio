# Build-Artifact SOP — external artifacts are built in CI, synced locally (ADR-027)

- **Status:** Draft (formalizes existing practice)
- **Related:** ADR-011 (lazy model registry; artifacts never committed),
  ADR-025 (module platform), ADR-026 (testing layers)

## 1. Principle

Anything that needs a build toolchain we do not want on a dev machine — wasm
(emsdk/CMake), onnx (Python/torch), trained models — is **built in GitHub
Actions** and **synced to local** via a standard fetch script. Dev machines
never build these; they only download. `main` stays protected; all artifact
workflows are `workflow_dispatch` and never push.

## 2. The five steps for every artifact

1. **Workflow** — `.github/workflows/<artifact>.yml`, `workflow_dispatch`,
   uploads the artifact (name + version pinned in the workflow). Existing:
   `build-sherpa-onnx-kws-wasm.yml`, `export-plixkws.yml`.
2. **Fetch script** — `scripts/fetch-<artifact>.mjs` (shared pattern; see §3)
   downloads the artifact into `prebuilts/` or `public/<module>/`, verifies the
   expected files + hash, and fails loudly on mismatch.
3. **Registry entry** — `apps/web/public/model-registry.json` records per
   artifact: version, source workflow, artifact name, sha256, fetch command,
   updated date. This is the **single shared fact source** for the web app and
   the local service (ADR-027).
4. **Package script** — `pnpm fetch:<artifact>`; a top-level `pnpm fetch:all`
   runs every fetch script.
5. **Missing-asset UX** — if the artifact is absent at runtime, the module
   surfaces "run `pnpm fetch:<artifact>`" instead of failing silently.

### 2.1 Training artifacts

Train scripts are **not** built by these artifact workflows; they are run by the
module's `train/` directory via `uv run` (ADR-028) from either the local
service (`train-runner.ts`, `subprocess` invocation) or a CI `train-<module>.yml`
workflow. The trained output (checkpoint + metrics) is registered in
`model-registry.json` exactly like a built artifact — same hash/version/fetch
discipline, so the web app and local service consume trained models
identically.

## 3. Fetch script contract

```bash
node scripts/fetch-<artifact>.mjs [--force] [--version <v>]
```

- Reads the expected version/hash from `public/model-registry.json`
  (single source of truth).
- Downloads via the GitHub Actions artifact REST API (or a pinned release URL
  for third-party assets), extracts into the target dir, verifies sha256.
- Exits non-zero with a clear message if the artifact is missing/expired.

## 4. Checklist for adding a new artifact

- [ ] Workflow exists and produces a downloadable artifact
- [ ] `scripts/fetch-<artifact>.mjs` follows the contract above
- [ ] Registry entry in `model-registry.json`
- [ ] `pnpm fetch:<artifact>` wired; `fetch:all` updated
- [ ] Module L2 test (ADR-026) loads the artifact in Node and asserts boot
- [ ] Missing-asset error message present in the UI

## 5. Current inventory

| Artifact | Workflow | Fetch script | Dest | Registry key |
|---|---|---|---|---|
| sherpa-onnx-kws wasm | `build-sherpa-onnx-kws-wasm.yml` | `fetch-sherpa-kws-assets.mjs` | `apps/web/public/sherpa-onnx-kws/` (legacy; moves to `packages/modules/kws/.../assets/` when the KWS module lands) | `sherpa-kws` |
| PLiX ONNX encoder | `export-plixkws.yml` | (pending standardized script) | `apps/web/prebuilts/plixkws/` (legacy; moves with the Few-Shot module) | `plixkws` |
| RNNoise wasm (pilot) | embedded base64 in `web/vendor/`; standalone CI build planned | (not needed while embedded) | `packages/modules/afe/rnnoise/assets/` | `rnnoise` |

> **Asset placement rule (ADR-025):** new artifacts go into the owning module's
> `assets/` dir (served at `/modules/<category>/<module>/assets/...`). The
> `apps/web/prebuilts/` and `apps/web/public/sherpa-onnx-kws/` entries above are
> legacy locations for assets whose owning module hasn't been extracted yet;
> they migrate into module `assets/` as the KWS / Few-Shot modules land.

> Inventory entries are filled as the SOP lands; the RNNoise row is the ADR-025
> pilot and will prove the SOP end-to-end.
