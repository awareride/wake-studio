/**
 * Colab results registration (issue #97 - 'Import Colab results' flow).
 *
 * After `importColabBundle` (training module) validates the picked zip, this
 * helper registers the trained model for the rest of the PWA:
 *
 *   1. the model binary lands in the user model library (IndexedDB) under the
 *      `classifier` role - the existing KWS load path (ADR-024) consumes it,
 *      so the user can Load it in the KWS panel and test in-browser;
 *   2. a `train` provisioning artifact (ADR-033) persists the bundle metadata
 *      + provenance - the Phase 4 export license gate reads provenance from
 *      here (user-owned = exportable).
 *
 * Client-side only: nothing leaves the browser, no WakeStudio server
 * involved (ADR-013/023).
 */

import { importColabBundle } from '@wake-studio/module-training'
import type { ArtifactBundle } from '@wake-studio/module-training'
import { importModelFile, saveProvisionArtifact } from '../model-library'
import type { UserModel, UserArtifact } from '../model-library'

/** The result of a successful Colab bundle import + registration. */
export interface ColabImportResult {
  /** The validated bundle (manifest + model bytes). */
  bundle: ArtifactBundle
  /** The stored model-library entry (role 'classifier'). */
  model: UserModel
  /** The stored train artifact (ADR-033; carries the provenance). */
  artifact: UserArtifact
  /** Model-source reference for the KWS panel: `user:<modelId>`. */
  classifierRef: string
}

/**
 * Persist a validated Colab bundle into the user library and wire it for
 * in-browser test + export:
 *  - model binary -> user model library (role 'classifier');
 *  - bundle metadata + provenance -> train artifact (ADR-033).
 *
 * The caller updates the app-level KWS model-source defaults so the KWS
 * panel's openwakeword classifier role points at the imported model on the
 * next Load.
 */
export async function registerColabBundle(
  bundle: ArtifactBundle,
): Promise<ColabImportResult> {
  const modelBytes = bundle.files.model
  if (!modelBytes) {
    throw new Error('The validated bundle has no model file to register.')
  }
  const format = bundle.modelFormat ?? 'onnx'
  const file = new File([modelBytes as BlobPart], `model.${format}`, {
    type: 'application/octet-stream',
  })

  const phrase = String(bundle.files.metadata.params.wakePhrase ?? '')
  const jobId = bundle.jobId
  const license = bundle.files.provenance.license

  const model = await importModelFile(
    file,
    'classifier',
    `Imported from Colab bundle ${jobId} (license: ${license})`,
  )

  const artifact = await saveProvisionArtifact(
    {
      kind: 'train' as const,
      backendId: bundle.files.metadata.moduleId,
      payload: {
        urls: { classifier: `user:${model.id}` },
      },
    },
    {
      name: phrase ? `Trained “${phrase}”` : `Trained model · ${jobId}`,
      notes: `Colab bundle ${jobId} · license ${license} · provenance feeds the Phase 4 export gate`,
    },
  )

  return {
    bundle,
    model,
    artifact,
    classifierRef: `user:${model.id}`,
  }
}

/** Validate + register a picked zip in one step (the UI entry point). */
export async function importColabResultsZip(
  file: File,
): Promise<ColabImportResult> {
  const bundle = await importColabBundle(file)
  return registerColabBundle(bundle)
}