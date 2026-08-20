/**
 * Dataset module - the `dataset.json` manifest schema (ADR-044, task #203).
 *
 * A dataset is a first-class artifact: one `wake-studio-dataset.zip` carrying a
 * `dataset.json` manifest (the portability contract) + a canonical
 * `label/*.wav` tree (16 kHz mono PCM WAV). The manifest declares each label's
 * SEMANTIC role (`positive` / `unknown` / `noise`) - it never bakes
 * trainer-specific folder magic (`_background_noise_`, `_unknown_`) into the
 * contract. Per-trainer materializers create the folders an upstream trainer
 * expects (docs/modules/data-sources.md §4/§6).
 *
 * The TypeScript types here are the source of truth; the studio-backend
 * Python importer (wake_train_kit/dataset.py) mirrors these rules so the same
 * manifest validates identically in the browser and the backend.
 */

/** Where the dataset came from. */
export type DatasetKind = 'builtin' | 'generated' | 'uploaded' | 'public'

/** What the dataset is for (top-level intent). */
export type DatasetRole = 'positive' | 'unknowns' | 'noise' | 'mixed'

/** Semantic role of one label - the portable vocabulary across trainers. */
export type LabelRole = 'positive' | 'unknown' | 'noise'

/** Whether the clip audio is real speech or synthetic (TTS). */
export type AudioSource = 'real' | 'synthetic'

export const DATASET_KINDS: readonly DatasetKind[] = [
  'builtin',
  'generated',
  'uploaded',
  'public',
]

export const DATASET_ROLES: readonly DatasetRole[] = [
  'positive',
  'unknowns',
  'noise',
  'mixed',
]

export const LABEL_ROLES: readonly LabelRole[] = ['positive', 'unknown', 'noise']

/** The manifest spec version. Bump only on a breaking manifest shape change. */
export const DATASET_MANIFEST_SCHEMA_VERSION = 1

/** The canonical audio format: 16 kHz mono PCM WAV (ADR-044). */
export const CANONICAL_SAMPLE_RATE = 16000
export const CANONICAL_ENCODING = 'pcm_s16le'

export interface DatasetLabel {
  /** Folder name of this label in the canonical `audio/<label>/` tree (sanitized). */
  name: string
  /** Semantic role - the portable vocabulary (docs/modules/data-sources.md §4.2). */
  role: LabelRole
  /** ISO language tag (optional; e.g. "zh-CN", "en-US"). */
  language?: string
  /** Per-clip provenance: real vs synthetic (synthetic-to-real gap, #209). */
  source?: AudioSource
  /** Distinct TTS voices used for this label (voice-coverage warning, #209). */
  voices?: string[]
}

export interface DatasetAudio {
  sampleRate: number
  channels: number
  /** Canonical encoding: "pcm_s16le". */
  encoding: string
  clips: number
  durationSec: number
}

export interface DatasetProvenanceEntry {
  name: string
  license: string
  /** False = the model is NOT commercially exportable if trained with this dataset (#210). */
  commercialUse: boolean
  source?: string
}

export interface DatasetRecipe {
  /** TTS engine id (edge-tts | piper | <online-http-tts> | <llm-tts>), ADR-044. */
  engine: string
  phrases?: string[]
  languages?: string[]
  /** Reproducibility seed - regenerate is byte-reproducible (#209). */
  seed?: number
  toolVersions?: Record<string, string>
  [key: string]: unknown
}

export interface DatasetStorage {
  /** Backend store path, e.g. "datasets/<id>/". */
  backend: string
  /** Optional cloud ref, e.g. "hf://user/ds" | "r2://bucket" | "gdrive://". */
  cloud?: string
  /** Optional read-only URL for built-in / public datasets. */
  url?: string
}

/**
 * The `dataset.json` portability contract (docs/modules/data-sources.md §4.2).
 */
export interface DatasetManifest {
  schemaVersion: number
  id: string
  name: string
  /** A new dataset (any content change bumps version; contentHash detects it). */
  version: number
  kind: DatasetKind
  role: DatasetRole
  audio: DatasetAudio
  labels: DatasetLabel[]
  provenance: DatasetProvenanceEntry[]
  recipe?: DatasetRecipe
  /** sha256 over the canonical payload (manifest minus hash/storage + all clip bytes). */
  contentHash?: string
  storage?: DatasetStorage
  createdAtMs?: number
}

export interface ManifestValidation {
  ok: boolean
  /** Human-readable problems (empty when ok). */
  errors: string[]
}

/** True when a value is one of the known label roles. */
export function isLabelRole(value: unknown): value is LabelRole {
  return typeof value === 'string' && (LABEL_ROLES as readonly string[]).includes(value)
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Validate a parsed `dataset.json` against the manifest contract (ADR-044).
 *
 * Shared by the web importer and the backend importer's mirror. Returns a
 * `{ ok, errors }` result - callers decide how to surface it (the importer
 * throws a typed {@link DatasetImportError}).
 */
export function validateDatasetManifest(raw: unknown): ManifestValidation {
  const errors: string[] = []
  if (!isPlainRecord(raw)) {
    return { ok: false, errors: ['dataset.json must be a JSON object'] }
  }

  const m = raw as Record<string, unknown>

  if (m.schemaVersion !== DATASET_MANIFEST_SCHEMA_VERSION) {
    errors.push(
      `schemaVersion must be ${DATASET_MANIFEST_SCHEMA_VERSION} (got ${String(m.schemaVersion)})`,
    )
  }
  if (!isNonEmptyString(m.id)) errors.push('id must be a non-empty string')
  if (!isNonEmptyString(m.name)) errors.push('name must be a non-empty string')
  if (typeof m.version !== 'number' || !Number.isInteger(m.version) || (m.version as number) < 1) {
    errors.push('version must be an integer >= 1')
  }
  if (typeof m.kind !== 'string' || !(DATASET_KINDS as readonly string[]).includes(m.kind)) {
    errors.push(`kind must be one of: ${DATASET_KINDS.join(', ')}`)
  }
  if (typeof m.role !== 'string' || !(DATASET_ROLES as readonly string[]).includes(m.role)) {
    errors.push(`role must be one of: ${DATASET_ROLES.join(', ')}`)
  }

  // audio block
  const audio = m.audio
  if (!isPlainRecord(audio)) {
    errors.push('audio must be an object')
  } else {
    if (typeof audio.sampleRate !== 'number' || audio.sampleRate <= 0) {
      errors.push('audio.sampleRate must be a positive number')
    }
    if (typeof audio.channels !== 'number' || audio.channels <= 0) {
      errors.push('audio.channels must be a positive number')
    }
    if (!isNonEmptyString(audio.encoding)) {
      errors.push('audio.encoding must be a non-empty string')
    } else if (audio.encoding !== CANONICAL_ENCODING) {
      errors.push(
        `audio.encoding must be "${CANONICAL_ENCODING}" in the canonical form (derived formats are materialized, not stored)`,
      )
    }
    if (typeof audio.clips !== 'number' || audio.clips < 0) {
      errors.push('audio.clips must be a number >= 0')
    }
    if (typeof audio.durationSec !== 'number' || audio.durationSec < 0) {
      errors.push('audio.durationSec must be a number >= 0')
    }
  }

  // labels block - the portability contract (semantic roles)
  if (!Array.isArray(m.labels) || m.labels.length === 0) {
    errors.push('labels must be a non-empty array')
  } else {
    const seen = new Set<string>()
    m.labels.forEach((label, i) => {
      if (!isPlainRecord(label)) {
        errors.push(`labels[${i}] must be an object`)
        return
      }
      const name = label.name
      if (!isNonEmptyString(name)) errors.push(`labels[${i}].name must be a non-empty string`)
      else if (seen.has(name)) errors.push(`labels[${i}].name duplicates "${name}"`)
      seen.add(String(name ?? ''))
      if (!isLabelRole(label.role)) {
        errors.push(`labels[${i}].role must be one of: ${LABEL_ROLES.join(', ')}`)
      }
    })
  }

  // provenance block - the license-gate input (#210)
  if (!Array.isArray(m.provenance) || m.provenance.length === 0) {
    errors.push('provenance must be a non-empty array')
  } else {
    m.provenance.forEach((entry, i) => {
      if (!isPlainRecord(entry)) {
        errors.push(`provenance[${i}] must be an object`)
        return
      }
      if (!isNonEmptyString(entry.name)) errors.push(`provenance[${i}].name must be a non-empty string`)
      if (!isNonEmptyString(entry.license)) {
        errors.push(`provenance[${i}].license must be a non-empty string`)
      }
      if (typeof entry.commercialUse !== 'boolean') {
        errors.push(`provenance[${i}].commercialUse must be a boolean`)
      }
    })
  }

  if (m.contentHash !== undefined && !isNonEmptyString(m.contentHash)) {
    errors.push('contentHash, when present, must be a non-empty string')
  }

  return { ok: errors.length === 0, errors }
}
