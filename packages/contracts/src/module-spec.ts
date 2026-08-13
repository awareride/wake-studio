/**
 * ModuleSpec - the declarative contract every WakeStudio module ships
 * (ADR-025, docs/module-spec.md).
 *
 * This is the SINGLE shared fact source: the web panel generator, the
 * studio-backend route registry, and the CI build/train workflows all consume
 * one spec per module. It lives in `packages/contracts` so web, studio-backend,
 * and modules import the same types (no drift between worlds).
 */

/** Param control kinds (ADR-017 leaf; panel generator maps 1:1). */
export type ParamType = 'number' | 'boolean' | 'select' | 'enum' | 'slider' | 'secret' | 'string'

export interface ParamValidation {
  required?: boolean
  /** A dotted param id (e.g. "params.vadEnabled") this param depends on. */
  if?: string
}

export interface ModuleParam {
  id: string
  label: string
  /** primary | advanced drives the collapsible Advanced section (ADR-024). */
  group: 'primary' | 'advanced'
  type: ParamType
  default: number | boolean | string
  min?: number
  max?: number
  step?: number
  unit?: string
  description: string
  /**
   * Allowed values for `select` / `enum` params.
   *
   * Two forms are accepted on purpose: the JSON schema declares a plain
   * `string[]` (concise, and what most specs use), while `{ value, label }`
   * lets a spec give a human-readable label. Renderers must handle both -
   * use `normalizeSelectOptions` from `@wake-studio/module-kit` rather than
   * assuming a shape (assuming objects rendered blank dropdowns).
   */
  options?: ReadonlyArray<string | { value: string; label: string }>
  validation?: ParamValidation
}

export type ActionKind = 'load' | 'start' | 'stop' | 'export' | 'train' | 'record' | 'reset' | 'enroll'

export interface ModuleAction {
  id: string
  label: string
  kind: ActionKind
  confirm?: boolean
  /** none | determinate | indeterminate */
  progress?: 'none' | 'determinate' | 'indeterminate'
  /** Dotted requirements, e.g. ["params.vadEnabled", "platform.mic"]. */
  requires?: string[]
}

export type StatusRenderer = 'bar' | 'waveform' | 'badge' | 'gauge' | 'text' | 'curve'

export interface ModuleStatus {
  id: string
  label: string
  renderer: StatusRenderer
  /** "event:<name>" | "engine:<getter>" | "spec:<const>". */
  source: string
  refreshMs?: number
}

/** Runtime shape for each target world. */
export interface ModuleRuntime {
  web?: {
    engine: string
    wasm?: { url: string; loader: 'classic' | 'emscripten' }
    worker?: boolean
  }
  local?: {
    command: string
    ports?: number[]
    protocol: 'stdio' | 'http' | 'ws'
  }
  cloud?: {
    workflowRef: string
    artifact?: string
  }
  device?: {
    sdkModule?: string
    targets?: string[]
  }
}

/** Train-script declaration (ADR-028: run via `uv run`). */
export interface ModuleTrain {
  /** Local uv script (ADR-028), e.g. "train/train.py". */
  entry?: string
  /**
   * Repo-relative path to the module-owned Colab notebook (e.g.
   * "packages/modules/kws/openwakeword/train/colab/train.ipynb"). Distinct
   * from `notebook` (upstream ref): the notebook lives in this repo; the
   * generated panel renders an "Open in Colab" action from it (ADR-035).
   * Repo-relative to match `playground.entry` / `tests.*` path conventions.
   */
  notebookLocal?: string
  python?: string
  deps?: string
  /**
   * The module's OWN train params (issue #105) — the wizard's Configure
   * step renders these spec-driven, so each module owns its train config
   * (a wake phrase + steps for openwakeword, feature type / training steps
   * for kws_streaming, none for frozen-weight rnnoise). Same shape as the
   * top-level `params`. Mirrors the module-spec JSON schema `train.params`.
   */
  params?: ModuleParam[]
  /** Who may invoke: "subprocess" (studio-backend), "ci", "colab". */
  invocation: Array<'subprocess' | 'ci' | 'colab'>
  outputs: Record<string, string>
  /**
   * Upstream-script adapter (human decision 2026-08-05): invoke a pinned
   * upstream repo script we do NOT own, without rewriting it. Either `script`
   * or `notebook` (not both with `entry`).
   */
  script?: {
    repo: string
    path: string
    ref: string
    language: 'python' | 'node' | 'shell'
    entrypoint?: string
    args?: string[]
    env?: Record<string, string>
  }
  /** Upstream Colab notebook adapter (ADR-023). */
  notebook?: {
    repo: string
    path: string
    ref: string
    paramsCell?: number
    outputsCell?: string
  }
  /** Output-normalization adapter id (e.g. "standardize-results"). */
  adapter?: string
  adapterOptions?: {
    modelRegex?: string
    metricsParser?: string
    [key: string]: unknown
  }
}

/** A build input for the generic build workflow (workflow_dispatch input). */
export interface ModuleBuildInput {
  id: string
  label: string
  type: 'string' | 'boolean' | 'choice'
  default?: string
  required?: boolean
  description?: string
  /** For type === 'choice': the allowed options. */
  options?: string[]
}

/** Toolchains the generic build workflow installs before running the script. */
export interface ModuleBuildToolchains {
  /** Emscripten/emsdk version, e.g. "4.0.23". */
  emsdk?: string
  /** Python version, e.g. "3.11". */
  python?: string
  /** Install `uv` (Astral) and run via it. */
  uv?: boolean
}

export interface ModuleBuild {
  /** "workflow" | "script" | "none". */
  recipe: 'workflow' | 'script' | 'none'
  workflowRef?: string
  /** Module-owned build logic; run by the generic workflow with inputs as env. */
  script?: string
  fetchScript?: string
  artifactName?: string
  registryEntry?: string
  /** How `scripts/fetch-artifact.mjs` unpacks the artifact into assets/. */
  fetch?: {
    /** File whitelist; when set, only these basenames are copied (drops demo extras). */
    include?: string[]
    /** Subdirectory of assets/ to copy into (default: assets/ root). */
    subdir?: string
  }
  /** Toolchains the generic workflow installs (keyed by tool). */
  toolchains?: ModuleBuildToolchains
  /** workflow_dispatch inputs declared by the module (dynamic UI). */
  inputs?: ModuleBuildInput[]
}

export interface ModuleTests {
  /** Paths to the L1/L2/L3 test entrypoints (ADR-026). */
  l1?: string
  l2?: string
  l3?: string
  required: Array<'l1' | 'l2' | 'l3'>
}

export interface ModulePlayground {
  route: string
  entry: string
}

export interface ModuleInterfaces {
  provides: string[]
  consumes: string[]
}

export type ModuleCategory = 'afe' | 'kws' | 'few-shot' | 'training' | 'data' | 'export' | 'platform'
export type ModuleMaturity = 'draft' | 'pilot' | 'stable' | 'deprecated'
export type ModuleStatusFlag = 'proposed' | 'accepted' | 'released'

export interface ModuleMeta {
  id: string
  name: string
  category: ModuleCategory
  version: string
  maturity: ModuleMaturity
  owner: string
  license: string
  status: ModuleStatusFlag
}

/** The full module spec (ADR-025; schema in docs/module-spec.md). */
export interface ModuleSpec {
  $schema?: string
  meta: ModuleMeta
  params: ModuleParam[]
  actions: ModuleAction[]
  status: ModuleStatus[]
  runtime: ModuleRuntime
  train?: ModuleTrain
  build?: ModuleBuild
  tests: ModuleTests
  playground: ModulePlayground
  interfaces: ModuleInterfaces
}

/** A module's maturity scorecard (ADR-025 §4; drives the README table). */
export interface ModuleScorecard {
  meta: ModuleMeta
  axes: {
    core: boolean
    spec: boolean
    panel: boolean
    tests: boolean
    playground: boolean
    targets: boolean
  }
}

// ---------------------------------------------------------------------------
// Cross-module stage interface (ADR-025; AFE stage modules)
// ---------------------------------------------------------------------------

/** A pluggable AFE stage (AEC / BSS / NS), per the per-stage module design. */
export type AFEStageKind = 'aec' | 'bss' | 'ns'

/** Result of one processed frame; stages denoise in place and report metrics. */
export interface AFEStageResult {
  /** VAD probability in [0,1] (NS stages; AEC/BSS may return 0). */
  vadProbability: number
  /** RMS level of the frame after processing, for visualization. */
  levelDb: number
}

/** A single AFE stage module's headless engine (usable in any JS env). */
export interface AFEStage {
  readonly kind: AFEStageKind
  /** Process one frame in place; returns stage metrics. */
  process(frame: Float32Array): AFEStageResult
  /** Reset internal state (e.g. on stop/record). */
  reset(): void
}
