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

1. **Workflow** — the **generic build skeleton** `.github/workflows/build.yaml`
   (ADR-027 §6.7) builds any module's artifact: it reads the module's
   `spec/module.spec.json` `build` block (script, toolchains, inputs,
   artifactName), installs the declared toolchains, runs
   `node scripts/build-module.mjs <module-id>`, and uploads the artifact.
   Module-owned build logic lives in `scripts/build-<id>.mjs` under the module
   (e.g. `packages/modules/kws/sherpa/scripts/build-sherpa-kws.mjs`). The
   bespoke `build-sherpa-onnx-kws-wasm.yml` / `export-plixkws.yml` were folded
   into this skeleton (2026-08-05).

   **Passing module inputs at dispatch (2026-08-10).** GitHub Actions has no
   dynamic `workflow_dispatch` inputs, so a module's `build.inputs` cannot each
   become a form field. The workflow takes an `inputs_json` object and expands it
   into the `INPUT_<ID>` env vars `build-module.mjs` already reads:

   ```bash
   gh workflow run build.yaml -f module=kws-streaming \
     -f inputs_json='{"checkpoints":"kwt1","validate":"true"}'
   ```

   Omitted keys fall back to the spec defaults.
2. **Fetch script** — `scripts/fetch-artifact.mjs <module-id>` (shared, generic;
   reads the module spec's `build.artifactName`) downloads the artifact into
   the owning module's `assets/`, or copies from a local dir
   (`--from <dir>`). It fails loudly on mismatch.
3. **Registry entry** — `apps/web/public/model-registry.json` records per
   artifact: version, source workflow, artifact name, sha256, fetch command,
   updated date. This is the **single shared fact source** for the web app and
   the studio-backend (ADR-027).
4. **Package script** — each module's `fetch:all` runs
   `node ../../../../scripts/fetch-artifact.mjs <module-id>`; a top-level
   `pnpm fetch:all` runs every module's fetch.
5. **Missing-asset UX** — if the artifact is absent at runtime, the module
   surfaces "run `pnpm fetch:<artifact>`" instead of failing silently.

### 2.1 Training artifacts

Train scripts are **not** built by these artifact workflows; they are run by the
module's `train/` directory via `uv run` (ADR-028) from either the
studio-backend (uv runner, `studio-backend` invocation, ADR-036) or a CI
`train-<module>.yml` workflow. The trained output (checkpoint + metrics) is
registered in `model-registry.json` exactly like a built artifact — same
hash/version/fetch discipline, so the web app and studio-backend consume
trained models identically.

## 3. Fetch script contract

```bash
node scripts/fetch-<artifact>.mjs [--force] [--version <v>]
```

- Reads the expected version/hash from `public/model-registry.json`
  (single source of truth).
- Downloads via the GitHub Actions artifact REST API (default;
  `build.artifactName`), or from a GitHub Release when the module spec's
  `build.fetch.source = "release"` (`build.fetch.releaseTag` + `pattern`;
  for static, non-CI-built models — see the `kws-openwakeword` / `kws-plix`
  rows below), extracts into the target dir, verifies sha256.
- Exits non-zero with a clear message if the artifact is missing/expired.

## 4. Checklist for adding a new artifact

- [ ] Workflow exists and produces a downloadable artifact
- [ ] `scripts/fetch-<artifact>.mjs` follows the contract above
- [ ] Registry entry in `model-registry.json`
- [ ] `pnpm fetch:<artifact>` wired; `fetch:all` updated
- [ ] Module L2 test (ADR-026) loads the artifact in Node and asserts boot
- [ ] **The artifact is validated, not just built.** A build that only proves
      "the file exists and the graph loads" can still ship a numerically wrong
      model (bad weight layout, dropped transform, permuted outputs). Where a
      ground truth exists, assert it in the build: `kws-streaming` runs its
      export over real Speech Commands clips and fails below a minimum argmax
      accuracy (`scripts/validate-kws-streaming.py`).
- [ ] Missing-asset error message present in the UI

## 5. Current inventory

| Artifact | Build (module build block) | Fetch | Dest | Registry key |
|---|---|---|---|---|
| sherpa-onnx-kws wasm | `kws-sherpa` (`.github/workflows/build.yaml` + `scripts/build-sherpa-kws.mjs`) | `scripts/fetch-artifact.mjs kws-sherpa` | `packages/modules/kws/sherpa/assets/` | `kws-sherpa` |
| openwakeword + hey-buddy onnx | `kws-openwakeword` (static; hosted on Release `models-openwakeword-v1`, `build.fetch.source=release`) | `scripts/fetch-artifact.mjs kws-openwakeword` | `packages/modules/kws/openwakeword/assets/` | `melspectrogram`, `speech_embedding`, `silero-vad`, `openwakeword-*`, `hey-buddy` |
| PLiX ONNX encoder | `kws-plix` (export script `scripts/build-plix.mjs`; hosted on Release `models-plix-v1`, `build.fetch.source=release`) | `scripts/fetch-artifact.mjs kws-plix` | `packages/modules/kws/plix/assets/` | `plixkws`, `plixkws-small` |
| kws-streaming ONNX (Keyword Transformer / att_mh_rnn) | `kws-streaming` (`.github/workflows/build.yaml` + `scripts/build-kws-streaming.mjs`) | `scripts/fetch-artifact.mjs kws-streaming` | `packages/modules/kws/streaming/assets/kws-streaming/` | `kws-streaming-*` |
| RNNoise wasm (pilot) | embedded base64 in `web/vendor/`; standalone CI build planned | (not needed while embedded) | `packages/modules/afe/rnnoise/assets/` | `rnnoise` |

> **Asset placement rule (ADR-025):** new artifacts go into the owning module's
> `assets/` dir (served at `/modules/<category>/<module>/assets/...`). All assets
> migrated to module `assets/` on 2026-08-05; the legacy `apps/web/prebuilts/`
> and `apps/web/public/sherpa-onnx-kws/` pools were retired.

> Inventory entries are filled as the SOP lands; the RNNoise row is the ADR-025
> pilot and will prove the SOP end-to-end.

## 6. Serving heavy assets from R2 (`VITE_ASSETS_MODE=external`, ADR-046)

Cloudflare Pages rejects any single file above **25 MiB**, which the heavy
artifacts exceed (sherpa-onnx KWS wasm bundle ~50 MB extracted;
`ort-wasm-simd-threaded.jsep.wasm` 25.58 MiB). The web app therefore has two
runtime-asset modes, selected at build time:

| Mode | `dist/` contents | Served by | Used by |
|---|---|---|---|
| `bundled` (default) | `modules/**` + `ort/**` copied in | the deploy origin (static files) | local dev/preview, GitHub Pages |
| `external` | app shell only + `_routes.json` | Pages Functions (`/modules/*`, `/ort/*`) reading the private R2 bucket | Cloudflare Pages |

The client URL layout is the same in both modes, so nothing in the app, the
model registry or the service worker changes.

**`dist/` hygiene in `external` mode.** Vite still emits a hashed copy of the
onnxruntime-web wasm for the library's internal `new URL(..., import.meta.url)`
fallback. That fallback never runs here - every ORT consumer sets
`ort.env.wasm.wasmPaths` to `/ort/` - and at 25.58 MiB the copy alone would
still trip the 25 MiB/file limit. The `wake-studio:prune-external-dist` plugin
(`apps/web/vite.config.ts`) therefore drops `ort-wasm-*.wasm` from the build
output and fails the build if any remaining file is over the limit, so an
oversized artifact breaks the **build** and not the deploy.

**Bucket & binding.** `apps/web/wrangler.toml` declares the Pages project and
the binding:

```toml
name = "wake-studio"
pages_build_output_dir = "dist"

[[r2_buckets]]
binding = "RUNTIME_ASSETS"
bucket_name = "wake-studio-assets"
```

The bucket is private: it needs no public access, custom domain or CORS rules.
The only reader is the `RUNTIME_ASSETS` binding used by
`apps/web/functions/{modules,ort}/[[path]].ts`.

**Publishing.** `scripts/publish-r2.mjs` uploads the module assets and the
vendored onnxruntime-web runtime with keys that mirror the URL paths
(`modules/<category>/<module>/assets/...`, `ort/...`), setting the content type
and `Cache-Control` per object. It talks to the Cloudflare REST API directly
(same endpoint as `wrangler r2 object put`) and needs:

```bash
export CLOUDFLARE_API_TOKEN=...   # Workers R2 Storage: Edit (+ Pages: Edit)
export CLOUDFLARE_ACCOUNT_ID=...
pnpm fetch:all                    # populate module assets/ first
pnpm publish:assets               # or: node scripts/publish-r2.mjs --dry-run
```

The `deploy.yml` Cloudflare job runs it after the build and before
`wrangler pages deploy`, so a new build never goes live before its assets.
Uploads are idempotent overwrites; objects removed from a module are not
deleted from the bucket (prune manually if needed).

**Local testing of `external` mode.** `pnpm dev`/`pnpm preview` serve assets
from disk (`bundled` behavior). To exercise the Functions locally:

```bash
cd apps/web
npx wrangler pages dev        # Miniflare local R2; seed it with
                              # `npx wrangler r2 object put --local ...`
```

**Operational notes**

- The bucket must exist before the first deploy; the binding is validated at
  deploy time. The Pages project itself is created by the deploy job on its
  first run (Direct Upload, production branch `main`).
- `wrangler.toml` becomes the source of truth for the Pages project — check the
  dashboard settings once with `npx wrangler pages download config wake-studio`.
- The ORT files are resolved from the onnxruntime-web version pnpm links for the
  KWS drivers (`^1.27.0`), not from the first `onnxruntime-web@*` entry in the
  pnpm store (which can be a different version pulled by an optional
  dependency). Keep the wasm/loader pair and the bundled JS on the same version.
