/**
 * Dataset module - TTS engine descriptors + registry (ADR-044 §5, task #205).
 *
 * A TTS engine is a pluggable capability (ADR-033 self-registration style),
 * NOT a hard-coded list: an engine is a small JSON descriptor (this dir is
 * `spec/engines/*.json`), and the generated catalog `dataset-engines.json`
 * (via `scripts/build-dataset-engines.mjs`) drives the Datasets generation
 * wizard (#208). Adding a vendor = dropping in a descriptor + a backend
 * adapter - no host-module edits.
 *
 * Kinds (docs/modules/data-sources.md §5.1):
 *   - classic-tts      : local TTS runtimes (edge-tts, piper) -> backend
 *   - online-http-tts  : any user-configured online TTS API + key (e.g.
 *                        mimo.mi.com) -> browser AND backend
 *   - llm-tts          : heavy LLM-TTS (qwen, vibe-voice, F5-TTS) -> backend GPU
 */

import edgeTts from '../spec/engines/edge-tts.json'
import piper from '../spec/engines/piper.json'
import mimoHttp from '../spec/engines/mimo-http.json'
import qwenLlmTts from '../spec/engines/qwen-llm-tts.json'

export type TTSEngineKind = 'classic-tts' | 'online-http-tts' | 'llm-tts'
export type TTSEngineRuntime = 'browser' | 'backend'
export type TTSParamType = 'string' | 'number' | 'boolean' | 'string[]' | 'secret'

export const TTS_ENGINE_KINDS: readonly TTSEngineKind[] = [
  'classic-tts',
  'online-http-tts',
  'llm-tts',
]

export interface TTSEngineParam {
  type: TTSParamType
  label: string
  default?: unknown
  required?: boolean
}

export interface TTSEngineProvenanceTemplate {
  name: string
  license: string
  commercialUse: boolean
  source?: string
}

/** One TTS engine descriptor (spec/engines/<id>.json). */
export interface TTSEngineDescriptor {
  id: string
  name: string
  kind: TTSEngineKind
  /** Where the engine can run; `runtime` decides the executor (#208). */
  runtime: TTSEngineRuntime[]
  params: Record<string, TTSEngineParam>
  provenanceTemplate: TTSEngineProvenanceTemplate
}

/** The built-in engine descriptors (web + build script share this shape). */
export const DATASET_ENGINES: TTSEngineDescriptor[] = [
  edgeTts as TTSEngineDescriptor,
  piper as TTSEngineDescriptor,
  mimoHttp as TTSEngineDescriptor,
  qwenLlmTts as TTSEngineDescriptor,
]

const BY_ID = new Map(DATASET_ENGINES.map((e) => [e.id, e]))

/** Look up an engine descriptor by id (undefined when unknown). */
export function engineById(id: string): TTSEngineDescriptor | undefined {
  return BY_ID.get(id)
}

export interface EngineValidation {
  ok: boolean
  errors: string[]
}

/** Validate the engine descriptor list (unique ids, known kind/runtime/params). */
export function validateEngineCatalog(
  engines: readonly TTSEngineDescriptor[],
): EngineValidation {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const e of engines) {
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
    if (!e.params || typeof e.params !== 'object') {
      errors.push(`engine ${e.id}: params must be an object`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/** True when an engine may run in the browser (online HTTP engines). */
export function isBrowserCapable(engine: TTSEngineDescriptor): boolean {
  return engine.runtime.includes('browser')
}
