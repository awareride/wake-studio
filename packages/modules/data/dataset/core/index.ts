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

export {
  MATERIALIZERS,
  MATERIALIZER_IDS,
  KWS_STREAMING_MATERIALIZER,
  OPENWAKEWORD_MATERIALIZER,
  materializerFor,
  roleFolderName,
  validateDatasetRequirements,
  planKwsStreamingLayout,
  type MaterializerId,
  type MaterializerDescriptor,
  type RoleMapping,
  type DatasetValidationInput,
  type DatasetRequirementsValidation,
} from './materialize'

export type { TrainerDatasetRequirements, LabelMode } from '@wake-studio/contracts'

export {
  BUILTIN_CATALOG_SCHEMA_VERSION,
  BUILTIN_MATERIALIZE_TYPES,
  isBuiltinAvailable,
  validateDatasetCatalog,
  type BuiltinMaterialize,
  type DatasetCatalogEntry,
  type DatasetBuiltinCatalog,
  type CatalogValidation,
} from './catalog'

export {
  sanitizeLabel,
  pcmToWav,
  isWavBytes,
  writeSilenceWav,
  buildGeneratedManifest,
  assembleDatasetZip,
  type GenerationParams,
  type GeneratedClip,
} from './generate'

export {
  ZIP_EOCD_MAX_COMMENT,
  findZipEnd,
  parseCentralDirectory,
  listZipEntries,
  extractZipEntrySlice,
  extractZipEntry,
  type ZipEndRecord,
  type ZipEntryInfo,
} from './zip'

export {
  STORAGE_BACKEND_KINDS,
  STORAGE_CAPABILITIES,
  BUILTIN_STORAGE_BACKENDS,
  validateStorageCatalog,
  storageBackendById,
  storageAuthKeys,
  type StorageBackendKind,
  type StorageBackendCapability,
  type StorageBackendDescriptor,
  type StorageCatalog,
  type StorageCatalogValidation,
} from './storage'
