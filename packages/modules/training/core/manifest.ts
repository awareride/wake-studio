import { unzipSync } from 'fflate'
import type { TrainingJob } from './job'

type TrainingJobBackend = TrainingJob['backend']

/**
 * Training module - artifact bundle manifest (docs/modules/training.md §4).
 *
 * ONE manifest serves all backends (studio-backend / cloud / Colab) so the PWA
 * has a single importer that validates + imports any trained model. The
 * provenance is the license-gate input (goal.plan Phase 4): a trained model is
 * user-owned / commercially clean.
 */

export interface ArtifactBundleMetadata {
  jobId: string
  moduleId: string
  backend: TrainingJobBackend
  provider?: string
  params: Record<string, string>
  /** Ordered wake-word labels matching the model class index (ADR-039 §4.5). */
  labels?: string[]
  trainedAtMs: number
}

export interface ArtifactProvenance {
  /** 'user-owned' = trained = commercially clean; else the third-party license. */
  license: 'user-owned' | string
  sourceData?: Array<{ name: string; license: string; source: string }>
  notes?: string
  /**
   * Inherited commercial flag (#210). `false` when any consumed dataset is
   * research-only — the trained model is then NOT commercially exportable.
   * Absent on pre-#210 bundles (fall back to `license === 'user-owned'`).
   */
  commercialUse?: boolean
  /** Names of the consumed datasets/sources that restricted commercial use (#210). */
  restrictedBy?: string[]
}

/** The standard bundle layout (wake-studio-results/<job-id>/). */
export interface ArtifactBundle {
  jobId: string
  /** Which model file the bundle carries ('onnx' | 'tflite'). Undefined for
   *  inference-only / pre-model bundles. */
  modelFormat?: 'onnx' | 'tflite'
  files: {
    /** model.onnx | model.tflite */
    model?: Uint8Array
    /** Standard ordered label list (labels.json, ADR-039 §4.5): matches the
     *  model class index, so a multi-class model can be tested per phrase. */
    labels?: string[]
    metrics?: Record<string, number>
    metadata: ArtifactBundleMetadata
    provenance: ArtifactProvenance
    /** AFE/KWS/Few-Shot config snapshot used for training. */
    configSnapshot?: Record<string, unknown>
  }
}

/**
 * Output-normalization adapter (docs/modules/training.md §4.3).
 *
 * `standardize-results` is the single importer: given an upstream run's
 * output dir (ANY shape - openWakeWord, micro-wake-word, wakeforge/ww_trainer,
 * ...), it finds the model + metrics + provenance and produces the standard
 * bundle. The upstream artifact is never changed (human decision 2026-08-05:
 * we adapt to the script, not vice versa).
 */
export interface ResultsAdapter {
  /** Adapter id (e.g. "standardize-results"). */
  readonly id: string
  /**
   * Normalize an upstream run's output dir into the standard bundle.
   * @param runDir   the upstream script's output directory (any shape)
   * @param options  adapterOptions from spec/train (modelRegex, metricsParser, ...)
   */
  standardize(runDir: string, options?: Record<string, unknown>): Promise<ArtifactBundle>
}

/**
 * Validate an imported bundle against the manifest shape (docs/modules/training.md §6).
 *
 * Shared by every backend (ADR-013): the PWA has ONE importer that validates
 * any trained model. Checks the fields the producers write and the consumers
 * read:
 *   - a non-empty job id
 *   - a metadata block with a job id + a known backend
 *   - a provenance block carrying a license (the Phase 4 export-gate input)
 *
 * No model file is required here — an inference-only bundle (e.g. a metrics/
 * provenance-only run) is still a structurally valid bundle. Callers that need
 * a model (the 'Import Colab results' flow) check `hasBundleModel` after.
 */
export function validateBundle(bundle: Partial<ArtifactBundle>): bundle is ArtifactBundle {
  const meta = bundle.files?.metadata
  const prov = bundle.files?.provenance
  return (
    typeof bundle.jobId === 'string' &&
    bundle.jobId.trim().length > 0 &&
    !!meta &&
    typeof meta.jobId === 'string' &&
    meta.jobId.trim().length > 0 &&
    (meta.backend === 'self-hosted' || meta.backend === 'cloud' || meta.backend === 'colab') &&
    !!prov &&
    typeof prov.license === 'string' &&
    prov.license.trim().length > 0
  )
}

/**
 * Whether a trained bundle is commercially exportable (#210).
 *
 * The Phase 4 export gate input: the bundle's provenance.json INHERITS the
 * restriction from any consumed dataset with `commercialUse: false` (a
 * research-only dataset makes the whole model non-commercially-exportable).
 * Pre-#210 bundles carry no `commercialUse`; fall back to the historical
 * `license === 'user-owned'` convention.
 */
export function isCommerciallyExportable(prov: ArtifactProvenance): boolean {
  if (prov.commercialUse === false) return false
  if ((prov.restrictedBy ?? []).length > 0) return false
  return prov.license === 'user-owned'
}

/**
 * Whether a bundle carries a model file (model.onnx | model.tflite). */
export function hasBundleModel(bundle: ArtifactBundle): boolean {
  return !!bundle.files.model
}

/**
 * Error raised by {@link importColabBundle} when a picked zip is not a valid
 * Colab artifact bundle. `code` lets the UI show a precise, human-readable
 * message instead of a generic "import failed".
 */
export class BundleImportError extends Error {
  /** Stable machine-readable code (surfaced in the UI + tests). */
  readonly code: BundleImportErrorCode

  constructor(code: BundleImportErrorCode, message: string) {
    super(message)
    this.name = 'BundleImportError'
    this.code = code
  }
}

export type BundleImportErrorCode =
  | 'no-zip'
  | 'empty-zip'
  | 'missing-metadata'
  | 'missing-provenance'
  | 'invalid-metadata'
  | 'invalid-provenance'
  | 'invalid-labels'
  | 'missing-model'

/** Messages shown to the user for each {@link BundleImportErrorCode}. */
export const BUNDLE_IMPORT_ERROR_MESSAGES: Record<BundleImportErrorCode, string> = {
  'no-zip': "That file isn't a zip archive — pick the downloaded wake-studio-results.zip.",
  'empty-zip': 'The zip is empty — it should contain metadata.json, provenance.json and a model.',
  'missing-metadata': 'metadata.json is missing from the zip (the artifact bundle manifest).',
  'missing-provenance': 'provenance.json is missing — the license gate needs it.',
  'invalid-metadata':
    'metadata.json is invalid — it must declare jobId, moduleId and a known backend (colab, self-hosted or cloud).',
  'invalid-provenance':
    'provenance.json is invalid — it must declare a license (e.g. “user-owned”).',
  'invalid-labels':
    'labels.json is invalid — it must be a non-empty array of non-empty strings matching the model class index (ADR-039).',
  'missing-model': 'No model found — the zip should contain model.onnx or model.tflite.',
}

/**
 * Parse a `File` (or node Buffer) that is a trained-results zip into an
 * {@link ArtifactBundle}. Client-side only — no WakeStudio server involved.
 *
 * ONE importer serves every backend (ADR-013 / docs/modules/training.md §4):
 * the same standard bundle shape is produced by the module-owned Colab
 * notebook (ADR-035), the studio-backend train runner (ADR-036) and future
 * cloud adapters, so the PWA validates + imports any trained model with the
 * same code path.
 *
 * The zip layout (wake-studio-results/<job-id>/):
 *
 * ```
 * model.onnx | model.tflite
 * labels.json   (optional, ADR-039: ordered, matches the class index)
 * metrics.json
 * metadata.json   (jobId, moduleId, backend: colab|self-hosted|cloud, params, trainedAtMs)
 * provenance.json (license: user-owned → Phase 4 export gate)
 * config.json
 * ```
 *
 * @throws {BundleImportError} with a stable `code` on any invalid/missing part.
 */
export async function importColabBundle(
  input: File | ArrayBuffer | Uint8Array,
): Promise<ArtifactBundle> {
  const data = input instanceof Uint8Array ? input : await readZipBytes(input)
  if (data.byteLength === 0) throw new BundleImportError('no-zip', BUNDLE_IMPORT_ERROR_MESSAGES['no-zip'])

  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(data)
  } catch {
    throw new BundleImportError('no-zip', BUNDLE_IMPORT_ERROR_MESSAGES['no-zip'])
  }

  const names = Object.keys(entries)
  if (names.length === 0) {
    throw new BundleImportError('empty-zip', BUNDLE_IMPORT_ERROR_MESSAGES['empty-zip'])
  }

  // Match backing files by basename (the zip prefixes entries with the job id).
  const byName = new Map<string, Uint8Array>()
  for (const name of names) {
    const base = name.split('/').pop() ?? name
    if (!byName.has(base)) byName.set(base, entries[name])
  }

  const decoder = new TextDecoder()
  const readJson = (name: string): unknown => {
    const bytes = byName.get(name)
    if (!bytes) return undefined
    try {
      return JSON.parse(decoder.decode(bytes))
    } catch {
      return undefined
    }
  }

  const metadata = readJson('metadata.json') as Partial<ArtifactBundleMetadata> | undefined
  if (!metadata) {
    throw new BundleImportError('missing-metadata', BUNDLE_IMPORT_ERROR_MESSAGES['missing-metadata'])
  }
  const provenance = readJson('provenance.json') as Partial<ArtifactProvenance> | undefined
  if (!provenance) {
    throw new BundleImportError('missing-provenance', BUNDLE_IMPORT_ERROR_MESSAGES['missing-provenance'])
  }

  const jobId = metadata.jobId
  const moduleId = metadata.moduleId
  const backend = metadata.backend
  const isKnownBackend =
    backend === 'colab' || backend === 'self-hosted' || backend === 'cloud'
  if (
    !jobId ||
    typeof jobId !== 'string' ||
    jobId.trim().length === 0 ||
    !moduleId ||
    typeof moduleId !== 'string' ||
    moduleId.trim().length === 0 ||
    !isKnownBackend
  ) {
    throw new BundleImportError('invalid-metadata', BUNDLE_IMPORT_ERROR_MESSAGES['invalid-metadata'])
  }

  const license = provenance.license
  if (typeof license !== 'string' || license.trim().length === 0) {
    throw new BundleImportError('invalid-provenance', BUNDLE_IMPORT_ERROR_MESSAGES['invalid-provenance'])
  }

  const modelOnnx = byName.get('model.onnx')
  const model = modelOnnx ?? byName.get('model.tflite')
  if (!model) {
    throw new BundleImportError('missing-model', BUNDLE_IMPORT_ERROR_MESSAGES['missing-model'])
  }

  const metrics = readJson('metrics.json') as Record<string, number> | undefined
  const config = readJson('config.json') as Record<string, unknown> | undefined

  // Standard ordered label list (ADR-039 §4.5). Optional for back-compat with
  // pre-ADR bundles, but when present it must be a non-empty array of
  // non-empty strings (the model class index contract).
  const labels = readJson('labels.json') as unknown
  if (labels !== undefined) {
    const isLabels =
      Array.isArray(labels) &&
      labels.length > 0 &&
      labels.every((l) => typeof l === 'string' && l.trim().length > 0)
    if (!isLabels) {
      throw new BundleImportError('invalid-labels', BUNDLE_IMPORT_ERROR_MESSAGES['invalid-labels'])
    }
  }
  const labelsList: string[] | undefined = Array.isArray(labels)
    ? (labels as string[])
    : undefined

  const bundle: ArtifactBundle = {
    jobId,
    modelFormat: modelOnnx ? 'onnx' : 'tflite',
    files: {
      model,
      labels: labelsList,
      metrics,
      metadata: {
        jobId,
        moduleId,
        backend,
        provider: metadata.provider,
        params: metadata.params ?? {},
        labels: labelsList,
        trainedAtMs: metadata.trainedAtMs ?? 0,
      },
      provenance: {
        license,
        sourceData: provenance.sourceData,
        notes: provenance.notes,
        // #210: the inherited restriction (absent on pre-#210 bundles).
        commercialUse:
          typeof provenance.commercialUse === 'boolean'
            ? provenance.commercialUse
            : undefined,
        restrictedBy:
          Array.isArray(provenance.restrictedBy) &&
          provenance.restrictedBy.every((r) => typeof r === 'string')
            ? provenance.restrictedBy
            : undefined,
      },
      configSnapshot: config,
    },
  }

  if (!validateBundle(bundle) || !hasBundleModel(bundle)) {
    throw new BundleImportError('invalid-metadata', BUNDLE_IMPORT_ERROR_MESSAGES['invalid-metadata'])
  }
  return bundle
}

/**
 * Generic alias for the single bundle importer (ADR-013 §6).
 *
 * `importColabBundle` predates the other backends and kept its name for
 * back-compat; new callers that are not Colab-specific should use this name.
 */
export const importResultBundle = importColabBundle

async function readZipBytes(input: File | ArrayBuffer): Promise<Uint8Array> {
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  return new Uint8Array(await input.arrayBuffer())
}
