/**
 * Dataset module - core exports (ADR-044, task #203).
 *
 * The `dataset.json` manifest contract (schema + validation), the canonical
 * content hash, and the single dataset importer. Generation jobs (engines /
 * storage plugins), materializers, the built-in catalog and the Datasets
 * console land in tasks #204-#210.
 */

export {
  DATASET_KINDS,
  DATASET_ROLES,
  LABEL_ROLES,
  DATASET_MANIFEST_SCHEMA_VERSION,
  CANONICAL_SAMPLE_RATE,
  CANONICAL_ENCODING,
  isLabelRole,
  validateDatasetManifest,
  type DatasetKind,
  type DatasetRole,
  type LabelRole,
  type AudioSource,
  type DatasetLabel,
  type DatasetAudio,
  type DatasetProvenanceEntry,
  type DatasetRecipe,
  type DatasetStorage,
  type DatasetManifest,
  type ManifestValidation,
} from './spec'

export {
  canonicalDatasetPayload,
  datasetContentHash,
  type ClipTree,
} from './hash'

export {
  importDatasetZip,
  DatasetImportError,
  type DatasetImportErrorCode,
  DATASET_IMPORT_ERROR_MESSAGES,
  type DatasetBundle,
} from './manifest'

export {
  TTS_ENGINE_KINDS,
  validateEngineCatalog,
  engineById,
  isBrowserCapable,
  type TTSEngineKind,
  type TTSEngineRuntime,
  type TTSEngineProvenanceTemplate,
  type TTSEngineDescriptor,
  type DatasetEngineCatalog,
  type EngineValidation,
} from './engines'
