/**
 * Datasets — built-in catalog loader (ADR-044 §7, #207).
 *
 * Fetches the static built-in catalog (`apps/web/public/datasets.json`,
 * generated from `packages/modules/data/dataset/catalog/builtins.json` by
 * `scripts/build-dataset-catalog.mjs`) and validates it with
 * `validateDatasetCatalog` (the same check the DatasetPicker runs). Shared by
 * the Datasets console and the Training wizard's `datasets[]` picker.
 *
 * A missing/invalid catalog degrades to an empty built-in list (the console
 * and picker still show backend/local datasets) — never a hard failure.
 */

import {
  validateDatasetCatalog,
  type DatasetCatalogEntry,
  type DatasetBuiltinCatalog,
} from '@wake-studio/module-dataset'
import { resolveAsset } from '@wake-studio/platform'

let cache: DatasetCatalogEntry[] | null = null
let cacheError: string | null = null

/** Fetch + validate the built-in catalog once per session (cached). */
export async function fetchBuiltinDatasets(): Promise<{
  builtins: DatasetCatalogEntry[]
  error: string | null
}> {
  if (cache) return { builtins: cache, error: cacheError }
  try {
    const res = await fetch(resolveAsset('datasets.json'))
    if (!res.ok) throw new Error(`built-in catalog (HTTP ${res.status})`)
    const catalog = (await res.json()) as DatasetBuiltinCatalog
    const validation = validateDatasetCatalog(catalog)
    if (!validation.ok) {
      throw new Error(`built-in catalog is invalid: ${validation.errors.join('; ')}`)
    }
    cache = catalog.datasets
    cacheError = null
  } catch (err) {
    cache = []
    cacheError = err instanceof Error ? err.message : String(err)
  }
  return { builtins: cache, error: cacheError }
}
