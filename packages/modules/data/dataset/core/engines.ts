/**
 * Dataset module - TTS engine catalog contract (ADR-044 §5, task #205).
 *
 * Engines are MODULES, not descriptor files: each `data`-category module
 * (`packages/modules/data/<engine>/`) declares `spec.tts` (kind / runtime /
 * provenanceTemplate) and `spec.params` (its generated panel, like KWS
 * drivers). `scripts/build-dataset-engines.mjs` discovers those modules and
 * generates the runtime catalog `apps/web/public/dataset-engines.json` (the
 * same way `train-modules.json` is generated from `spec.train`).
 *
 * This module keeps the TYPES + helpers; the catalog is a runtime asset the
 * web fetches (never a hard-coded list). Adding an engine = adding a module,
 * no host-module edits (ADR-033 self-registration).
 */

export type TTSEngineKind = 'classic-tts' | 'online-http-tts' | 'llm-tts'
export type TTSEngineRuntime = 'browser' | 'backend'

export const TTS_ENGINE_KINDS: readonly TTSEngineKind[] = [
  'classic-tts',
  'online-http-tts',
  'llm-tts',
]

export interface TTSEngineProvenanceTemplate {
  name: string
  license: string
  commercialUse: boolean
  source?: string
}

/** One engine entry in the generated catalog (from an engine module's spec). */
export interface TTSEngineDescriptor {
  id: string
  name: string
  kind: TTSEngineKind
  /** Where the engine may run; `runtime` decides the executor (#208). */
  runtime: TTSEngineRuntime[]
  /** The engine module's spec.params (ModuleParam[]) - renders its panel. */
  params: Array<Record<string, unknown>>
  defaultModel?: string
  provenanceTemplate: TTSEngineProvenanceTemplate
}

/** The generated `dataset-engines.json` payload. */
export interface DatasetEngineCatalog {
  note?: string
  engines: TTSEngineDescriptor[]
}

export interface EngineValidation {
  ok: boolean
  errors: string[]
}

/** Validate an engine catalog (unique ids, known kind/runtime, params present). */
export function validateEngineCatalog(catalog: DatasetEngineCatalog): EngineValidation {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const e of catalog.engines ?? []) {
    if (!e.id) errors.push('engine without id')
    else if (seen.has(e.id)) errors.push(`duplicate engine id: ${e.id}`)
    seen.add(e.id)
    if (!TTS_ENGINE_KINDS.includes(e.kind)) {
      errors.push(`engine ${e.id}: invalid kind ${e.kind}`)
    }
    if (!Array.isArray(e.runtime) || e.runtime.length === 0) {
      errors.push(`engine ${e.id}: runtime must be a non-empty array`)
    } else if (!e.runtime.every((r) => r === 'browser' || r === 'backend')) {
      errors.push(`engine ${e.id}: runtime must be browser|backend`)
    }
    if (!Array.isArray(e.params)) {
      errors.push(`engine ${e.id}: params must be an array`)
    }
    if (!e.provenanceTemplate || typeof e.provenanceTemplate !== 'object') {
      errors.push(`engine ${e.id}: provenanceTemplate must be an object`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/** Look up an engine in a catalog by id (undefined when unknown). */
export function engineById(
  catalog: DatasetEngineCatalog,
  id: string,
): TTSEngineDescriptor | undefined {
  return (catalog.engines ?? []).find((e) => e.id === id)
}

/** True when an engine may run in the browser (online HTTP engines). */
export function isBrowserCapable(engine: TTSEngineDescriptor): boolean {
  return engine.runtime.includes('browser')
}
