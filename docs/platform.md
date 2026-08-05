# Platform Layer - Package Specification

- **Status:** Draft (docs-first; migration §6.1)
- **Owner:** WakeStudio team
- **Plan phase:** Module migration (module-migration.plan §6.1); consumed by all modules
- **Related ADRs:** ADR-011 (lazy model registry), ADR-012 (base path),
  ADR-016 (AFE), ADR-021 (device SDK), ADR-025 (module platform),
  ADR-027 (build artifacts)
- **Depends on (modules):** none (platform is the base)
- **Last updated:** 2026-08-05

## 1. Purpose

`@wake-studio/platform` is the shared **capability layer** for WakeStudio:
base-path resolution (ADR-012), the lazy model manager (ADR-011/027), a
runtime-agnostic wasm loader seam, and audio-io abstractions. It exists so
**modules never import app internals** and `apps/web` focuses on **product
interaction, not capability** (Q-P1, resolved). It is the platform layer the
ADR-025 module boundary rules require ("a module depends on the platform layer
(`src/platform/*`: audio io, wasm loader, runtime abstraction)").

## 2. Scope & boundaries

- **In scope:**
  - **base-path resolver** — `APP_BASE`, `resolveAsset()` (moved from
    `apps/web/src/config.ts`), so every asset URL survives sub-path deployment
    (GitHub Pages `/<repo>/`, Cloudflare `/`).
  - **lazy model manager** — `loadRegistry()` + the typed `RegistryModel`
    loader and the `isCommerciallyUsable()` license gate (moved from
    `apps/web/src/data/registry.ts`), plus a small runtime service
    (load/get/status) with integrity check (ADR-011/027).
  - **wasm loader seam** — a thin, runtime-agnostic loader interface
    (emscripten / classic / onnxruntime) that modules implement against,
    replacing per-module ad-hoc loaders.
  - **audio-io abstractions** — capture/stream interfaces (WebAudio behind a
    seam) so AFE / Few-Shot depend on the seam, not on `window`/`AudioContext`
    directly.
- **Out of scope:** any product logic; any UI; module internals; the device SDK
  (ADR-021, Phase 4); the projects store, session log, router, shell (app-level
  glue stays in apps/web).
- **Public surface:** the interfaces/functions above, exported from the package
  root (browser-neutral) and, for browser-only bits, the `./web` subpath.

## 3. Scope guard (YAGNI)

Only abstractions with **≥2 consumers** land here. A one-consumer abstraction
stays local until a second consumer appears. The package must stay thin.

## 4. Public API & types

```ts
// --- base path (from apps/web/src/config.ts) ---
export const APP_BASE: string            // import.meta.env.BASE_URL ?? '/'
export function resolveAsset(path: string): string

// --- model registry (from apps/web/src/data/registry.ts) ---
export type ModelTier = 'low-power' | 'high-performance'
export type ModelClass = 'redistributable' | 'demo-only'
export interface RegistryModel { id, name, tier, source, url, format,
  license, commercial, class, sha256, sizeBytes, encoderVariant?,
  transformersModel?, embeddingDim?, externalData?, notes? }
export interface ModelRegistry { version, updated, note?, models[] }
export async function loadRegistry(signal?: AbortSignal): Promise<ModelRegistry>
export function isCommerciallyUsable(model: RegistryModel): boolean

// --- wasm loader seam ---
export interface WasmLoader { load(src: string): Promise<unknown> }
// (runtime-agnostic; modules implement/provide loaders)

// --- audio io seam (browser via ./web) ---
export interface AudioSource { start(): Promise<void>; stop(): void }
```

## 5. Data flow / sequence

- `apps/web` and modules import `resolveAsset`/`loadRegistry` from the package;
  the registry JSON is fetched lazily at runtime (never bundled, ADR-011) from
  a base-aware URL. Model Library and license gate consume the same service.
- Modules receive runtime abstractions (wasm loader, audio io) through the
  package's interfaces; the concrete browser implementations live in the
  package's `./web` subpath (or are injected by the app).

## 6. Configuration & constants

| Constant | Default | Notes |
|---|---|---|
| `APP_BASE` | `import.meta.env.BASE_URL ?? '/'` | set by Vite from `VITE_BASE_PATH` (ADR-012) |
| registry URL | `model-registry.json` (base-resolved) | lazy fetch, integrity-checked (ADR-027) |

## 7. Error model & failure modes

- Registry fetch failure: throws `Error('Failed to load model registry: HTTP <status>')` (same as today).
- Asset fetch/probe failure: reported via state (`ok | error`); never silently retried (ADR-011 amendment).

## 8. Observability

- None beyond the registry load status the Model Library renders today.

## 9. Testing strategy

- L1 unit: move `apps/web/src/data/__tests__/registry.test.ts` (license gate +
  probe) with the code; add a base-path resolve test.
- No L2/L3 (no wasm/UI here).

## 10. Security & privacy

- No mic audio, no credentials. Registry URLs are public model artifacts.

## 11. Open questions

- None for this step. (Wasm/audio seams are minimal contracts; concrete
  implementations land with their consumer modules in §6.2–§6.4.)

## 12. References

- ADR-011/012/025/027; module-migration.plan §6.1; `docs/architecture.md` §3.
- Legacy homes: `apps/web/src/config.ts`, `apps/web/src/data/registry.ts`.

## 13. Change log

| Date | Change | Author |
|---|---|---|
| 2026-08-05 | Initial draft (docs-first, §6.1). | agent |
