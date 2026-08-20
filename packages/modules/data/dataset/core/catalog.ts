/**
 * Dataset module - built-in catalog contract (ADR-044 §7, task #207).
 *
 * Built-ins are IMMUTABLE references (`kind: builtin`) into a spec-driven
 * `datasets.json` catalog (like `train-modules.json`), focused on
 * multi-language + noise coverage. Each entry is a full `DatasetManifest`
 * (the portability contract) plus a `materialize` descriptor saying how the
 * immutable reference becomes a canonical `wake-studio-dataset.zip` on first
 * use.
 *
 * License + `commercialUse` flags are first-class so the Phase 4 export gate
 * stays honest (an entry with `commercialUse: false`, e.g. AudioSet/FMA noise,
 * blocks commercial exports of any model trained on it — #210).
 *
 * Curated source of truth: `packages/modules/data/dataset/catalog/builtins.json`.
 * The web bundle (`apps/web/public/datasets.json`) is generated from it by
 * `scripts/build-dataset-catalog.mjs`; the backend mirrors the same file in
 * `wake_train_kit/builtin_catalog.py`.
 */

import { validateDatasetManifest, type DatasetManifest } from './spec'

/** How a built-in becomes a canonical zip on first use (materialize-on-demand). */
export type BuiltinMaterialize =
  /** A pre-built canonical zip URL: fetch it and import through the store. */
  | { type: 'canonical-zip'; url: string }
  /** Backend conversion of the Speech Commands V2 archive (ADR-022, #152). */
  | { type: 'speech-commands-v2' }
  /** Declared (license/provenance known) but no hosted zip yet — not trainable. */
  | { type: 'pending-host'; note?: string }

/** One catalog entry: a valid built-in manifest + its materialize descriptor. */
export interface DatasetCatalogEntry extends DatasetManifest {
  kind: 'builtin'
  materialize: BuiltinMaterialize
}

export interface DatasetBuiltinCatalog {
  /** Catalog spec version (bump on a breaking shape change). */
  schemaVersion: number
  note?: string
  datasets: DatasetCatalogEntry[]
}

export interface CatalogValidation {
  ok: boolean
  errors: string[]
}

export const BUILTIN_CATALOG_SCHEMA_VERSION = 1

export const BUILTIN_MATERIALIZE_TYPES: readonly string[] = [
  'canonical-zip',
  'speech-commands-v2',
  'pending-host',
]

/** True when a built-in can be materialized today (vs declared-but-pending). */
export function isBuiltinAvailable(entry: DatasetCatalogEntry): boolean {
  return entry.materialize.type !== 'pending-host'
}

/**
 * Validate a built-in catalog: every entry must be a valid `DatasetManifest`
 * with `kind: builtin`, a materialize descriptor (with the `url` a
 * `canonical-zip` entry requires) and non-empty provenance carrying the
 * `commercialUse` flag the export gate relies on. Mirrored (loosely) by the
 * backend loader.
 */
export function validateDatasetCatalog(catalog: DatasetBuiltinCatalog): CatalogValidation {
  const errors: string[] = []
  if (catalog.schemaVersion !== BUILTIN_CATALOG_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion must be ${BUILTIN_CATALOG_SCHEMA_VERSION} (got ${String(catalog.schemaVersion)})`,
    )
  }
  if (!Array.isArray(catalog.datasets) || catalog.datasets.length === 0) {
    return { ok: false, errors: [...errors, 'datasets must be a non-empty array'] }
  }

  const seen = new Set<string>()
  for (const entry of catalog.datasets) {
    const id = entry.id ?? '(no id)'
    const manifest = validateDatasetManifest(entry)
    if (!manifest.ok) {
      for (const e of manifest.errors) errors.push(`${id}: ${e}`)
    }
    if (seen.has(id)) errors.push(`duplicate dataset id: ${id}`)
    seen.add(id)

    if (entry.kind !== 'builtin') errors.push(`${id}: kind must be "builtin"`)
    if (!entry.materialize || typeof entry.materialize !== 'object') {
      errors.push(`${id}: materialize descriptor is required`)
    } else if (!BUILTIN_MATERIALIZE_TYPES.includes(entry.materialize.type)) {
      errors.push(`${id}: materialize.type must be one of ${BUILTIN_MATERIALIZE_TYPES.join(', ')}`)
    } else if (
      entry.materialize.type === 'canonical-zip' &&
      !(typeof entry.materialize.url === 'string' && entry.materialize.url.length > 0)
    ) {
      errors.push(`${id}: canonical-zip materialize requires a non-empty url`)
    }

    if (!Array.isArray(entry.provenance) || entry.provenance.length === 0) {
      errors.push(`${id}: provenance must be non-empty (the export gate reads commercialUse)`)
    }
  }
  return { ok: errors.length === 0, errors }
}
