/**
 * Trained-results registration (issue #97 'Import Colab results'; issue #159
 * auto pull + import). One registration path serves every backend: after the
 * single bundle importer validates a bundle (Colab zip or a pulled
 * studio-backend / tunnel artifact), this helper registers the trained model
 * for the rest of the PWA:
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

import { importResultBundle } from '@wake-studio/module-training'
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

  // The canonical wake-word source is now the standard ADR-039 labels list
  // (metadata.labels from labels.json). Fall back to the legacy param keys
  // (the Colab notebook writes `wakePhrase`, the studio-backend kws-streaming
  // runner writes `wakePhrases`) for bundles produced before ADR-039.
  const metaParams = bundle.files.metadata.params ?? {}
  const labels = bundle.files.metadata.labels ?? []
  const phrase =
    labels.length > 0
      ? labels.join(', ')
      : String(metaParams.wakePhrase ?? metaParams.wakePhrases ?? '')
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
  const bundle = await importResultBundle(file)
  return registerColabBundle(bundle)
}

/**
 * Pull a trained-results bundle from a backend and register it (issue #159):
 * fetch the zip from the studio-backend / Colab-tunnel artifact endpoint
 * (`GET /artifacts/{jobId}/{name}`, ADR-036 §3), validate it with the single
 * bundle importer, and persist it into the user library.
 *
 * This is the auto/on-demand counterpart to the manual zip upload — the PWA
 * no longer needs the download-then-upload round trip for tracked jobs.
 */
export async function pullAndImportBundle(
  artifactUrl: string,
): Promise<ColabImportResult> {
  let res: Response
  try {
    res = await fetch(artifactUrl)
  } catch (err) {
    throw new Error(
      `Could not reach the backend to pull the artifact: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  if (!res.ok) {
    throw new Error(`Pulling the artifact failed (HTTP ${res.status}).`)
  }
  const bytes = new Uint8Array(await res.arrayBuffer())
  const bundle = await importResultBundle(bytes)
  return registerColabBundle(bundle)
}
