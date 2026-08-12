# packages/modules/kws/plix/assets

Browser-ready PLiX Few-Shot KWS encoder (`aaqibsaeed/plixkws`,
Apache-2.0; arXiv:2305.03058).

PLiX replaces **WavLM-base-plus** as the in-browser Few-Shot encoder: its
compact CNN (EfficientNet-v2 "base" / TinyNet-E "small") is far lighter and
was designed for end-side / IoT devices.

## Runtime choice (ADR-002)

The encoder can be served by **two runtimes**; the choice depends on the
deployment. Both share the same acoustic front-end and produce the **same
1280-dim embedding**, so prototype-distance scoring is identical.

| Runtime | Needs an `.onnx` file? | How it loads | When to use |
|---|---|---|---|
| **`onnx`** (default) | Yes — `plixkws-base.onnx` | onnxruntime-web (WASM) | Default. Single inference stack with the rest of the app. |
| **`transformers`** | **No** | `@huggingface/transformers` v4 (loaded from the jsDelivr CDN; no `.pt` / no npm install), fetches the ONNX weights itself from a HF repo id or a local HF-style dir | Zero-Python / no-ONNX deployment; avoids exporting/serving an `.onnx` artifact. |

Set the runtime via `runtime` in the model URLs (`'onnx'` or `'transformers'`).
The default is `'onnx'`. The `transformers` runtime still uses ONNX weights
under the hood (HF Transformers wraps onnxruntime-web) — it just fetches and
runs them browser-native, so there is no TorchScript/`.pt` file and no local
Python step required at deploy time.

## ONNX route (default)

Assets are fetched from the GitHub Release `models-plix-v1` (ADR-027;
`pnpm fetch:all` — the spec's `build.fetch.source=release`). What goes here:

- `plixkws-base.onnx` — the **base** encoder (EfficientNet-v2-M, 1280-dim).
  **Not vendored** (the base export is not in the release); select it via a
  custom encoder URL or export with `scripts/build-plix.mjs`.
- `plixkws-small.onnx` — the **small** encoder (TinyNet-E, 1280-dim) — the
  vendored/registry default.
- `plixkws-small.onnx.data` — **external weights** for the `small` export
  (ONNX external-data format). Must sit **next to** `plixkws-small.onnx` so
  onnxruntime-web can resolve it. (The `base` export is a single self-contained
  file; it has no `.data` sidecar.)

Both variants are **first-class and selectable** in the Wake Studio Few-Shot
panel (encoder-variant selector, ADR-002). They emit the **same 1280-dim**
embedding from the same 1×64×100 log-Mel front-end, so prototype-distance
scoring is identical — only compute/params differ (`small` is lighter, for
low-RAM / end-side devices).

Each is an ONNX export whose input is a **1×64×100 log-Mel spectrogram**
(16 kHz, window 400 / hop 160, 64 mel bins, 60–7800 Hz) and whose output
is the **1280-dim** global-average-pooled embedding.

### External-data note (only `small`)

`plixkws-small.onnx` references its large weight tensor via ONNX
`external_data` with `location: plixkws-small.onnx.data` (no `./` prefix).
**The browser build of onnxruntime-web cannot read the filesystem**, so the
external weights are NOT auto-fetched. The app must pass them explicitly via
the `externalData` session option:

```js
await ort.InferenceSession.create('/modules/kws/plix/assets/plixkws-small.onnx', {
  executionProviders: ['wasm'],
  externalData: [
    { path: 'plixkws-small.onnx.data',          // must match the protobuf location
      data: '/modules/kws/plix/assets/plixkws-small.onnx.data' }, // URL | Blob | Uint8Array
  ],
})
```

This is already wired in `src/kws/backends/plix-onnx.ts` (`_externalDataOptions`),
keyed off the model filename. So:

- Keep the two files co-located under this folder (served at
  `/modules/kws/plix/assets/` per ADR-025).
- Serve the `.onnx.data` with a binary content-type (the dev/preview server
  already maps `.data` -> `application/octet-stream` in `vite.config.ts`).
- If you re-export `small` without external data (all weights inlined), no
  `externalData` entry is needed and the `.data` file can be omitted.

If you re-export `small` without external data (all weights inlined), the
`.data` file is not needed.

### Export step (run once, locally)

The published weights are PyTorch `.pt` files on Dropbox (see the
`aaqibsaeed/plixkws` model card / `FewshotML/plix` repo). Convert one to
ONNX:

```bash
pip install "plixkws"          # pulls torch, torchaudio, timm
python packages/modules/kws/plix/scripts/export-plixkws-onnx.py \
    --encoder base --language en \
    --out packages/modules/kws/plix/assets/plixkws-base.onnx
```

(Or run the module build: `node packages/modules/kws/plix/scripts/build-plix.mjs
--out <dir> --input-encoder base`, which wraps the exporter and also stages the
HF-style dir; CI does this via the generic build workflow, ADR-027 §6.7.)

Drop the resulting `plixkws-base.onnx` (and `plixkws-small.onnx[.data]`) into
this folder. The app serves them from `/modules/kws/plix/assets/` and selects
the variant via the encoder selector in the Few-Shot panel (see
`public/model-registry.json`, entries `plixkws` and `plixkws-small`,
`runtime: "onnx"`).

## Transformers.js route (no exported `.onnx` artifact)

No `.onnx` file needs to be exported/served by you. Set `runtime: "transformers"`
and point `plixkws` at either:

1. **A Hugging Face repo id** (e.g. `aaqibsaeed/plixkws`). The encoder loads
   `@huggingface/transformers` v4 from the jsDelivr CDN and fetches the model's
   ONNX weights + `config.json` from the Hub at runtime.
2. **A local HF-style directory** under this folder, e.g.
   `hf/plixkws/` containing:
   ```
   hf/plixkws/
   ├── config.json
   └── onnx/
       ├── model.onnx                 # the exported PLiX graph
       └── plixkws-small.onnx.data     # external weights (only for 'small')
   ```
   Point `plixkws` at `/modules/kws/plix/assets/hf/plixkws`; the encoder sets
   `env.allowRemoteModels = false` and `env.localModelPath` so it loads fully
   offline. The graph inside `onnx/model.onnx` is the SAME
   `plixkws-small.onnx` exported above — just renamed to the `model.onnx`
   that Transformers.js looks for by default, with its external weights
   (`plixkws-small.onnx.data`) kept co-located in the same `onnx/` folder so
   onnxruntime-web can resolve them (the protobuf `location` is
   `plixkws-small.onnx.data`, resolved relative to the graph). Copy, don't
   move, the originals so the default `onnx` runtime keeps working too.

   Quick generation from the local weights (or run the module build, which
   does this automatically):
   ```bash
   mkdir -p hf/plixkws/onnx
   cp plixkws-small.onnx   hf/plixkws/onnx/model.onnx
   cp plixkws-small.onnx.data hf/plixkws/onnx/plixkws-small.onnx.data
   # add hf/plixkws/config.json (see the minimal schema below)
   ```
   (This folder is gitignored — it is a generated, dev-only artifact per
   ADR-011. Regenerate it from the committed-free weights whenever needed.)

How it runs: `@huggingface/transformers` v4 wraps onnxruntime-web. PLiX has no
text/image tokenizer, so rather than the `feature-extraction` pipeline (which
needs a processor) the encoder uses `AutoModel.from_pretrained(id)` and calls
`model(new Tensor('float32', mel, [1,1,64,100]))` with the **same JS-computed
log-Mel front-end** as the ONNX route. The resulting 1280-dim embedding is
identical. WASM binaries come from the HF CDN by default (no local wasm needed).

`@huggingface/transformers` is declared as an `optionalDependency` in
`package.json` and imported **dynamically** only when this runtime is selected
(so it is not a hard dependency of the default ONNX path, and when served from
the CDN no install is required at all).

Minimal `config.json` for a PLiX HF-style dir (adjust to the exported graph):
```json
{
  "_name_or_path": "plixkws",
  "architectures": ["PlixBackbone"],
  "model_type": "plixkws",
  "num_channels": 1,
  "num_mels": 64,
  "num_frames": 100
}
```

## License

Apache-2.0 (FewshotML/plix). Redistributable / commercially clean.
