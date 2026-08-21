/**
 * Datasets — TTS engine catalog loader (ADR-044 §5, #205).
 *
 * Fetches `dataset-engines.json` (generated from the data-category engine
 * modules' `spec.tts` by scripts/build-dataset-engines.mjs) and validates it
 * with `validateEngineCatalog`. The generation wizard renders each engine's
 * own `params` and reads its `runtime` + `provenanceTemplate`.
 */

import {
  validateEngineCatalog,
  type DatasetEngineCatalog,
  type TTSEngineDescriptor,
} from '@wake-studio/module-dataset'
import { resolveAsset } from '@wake-studio/platform'

let cache: TTSEngineDescriptor[] | null = null
let cacheError: string | null = null

/** Fetch + validate the engine catalog once per session (cached). */
export async function fetchDatasetEngines(): Promise<{
  engines: TTSEngineDescriptor[]
  error: string | null
}> {
  if (cache) return { engines: cache, error: cacheError }
  try {
    const res = await fetch(resolveAsset('dataset-engines.json'))
    if (!res.ok) throw new Error(`engine catalog (HTTP ${res.status})`)
    const catalog = (await res.json()) as DatasetEngineCatalog
    const validation = validateEngineCatalog(catalog)
    if (!validation.ok) {
      throw new Error(`engine catalog is invalid: ${validation.errors.join('; ')}`)
    }
    cache = catalog.engines
    cacheError = null
  } catch (err) {
    cache = []
    cacheError = err instanceof Error ? err.message : String(err)
  }
  return { engines: cache, error: cacheError }
}

export function findDatasetEngine(
  engines: TTSEngineDescriptor[],
  id: string | undefined,
): TTSEngineDescriptor | undefined {
  return engines.find((e) => e.id === id)
}
