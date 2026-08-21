/**
 * Datasets — upload-to-cloud action (ADR-044 §8.1/§8, #208).
 *
 * "Upload to cloud" uploads a dataset's canonical zip to the user's cloud,
 * using the BROWSER executor's direct push (feasible client-side today:
 * Hugging Face via `fetch` + the Settings cloud token). Cloudflare R2
 * (S3 SigV4) and Google Drive (OAuth flow) are NOT wired browser-side and
 * are flagged — same treatment as issue #107 for the backend SDKs. Works for
 * any origin: the zip is fetched (browser-local store or the backend
 * GET /datasets/{id}/download) and pushed client-side.
 */

import { pushToHuggingFace } from './browser/hf-push'
import type { ConsoleDataset } from './store'

export type CloudTarget = 'hf' | 'r2' | 'gdrive'

export const CLOUD_TARGETS: ReadonlyArray<{
  id: CloudTarget
  label: string
  wired: boolean
  note: string
}> = [
  {
    id: 'hf',
    label: 'Hugging Face',
    wired: true,
    note: 'Dataset repo upload via fetch + your Settings token (direct browser push).',
  },
  {
    id: 'r2',
    label: 'Cloudflare R2',
    wired: false,
    note: 'S3 SigV4 signing is not wired browser-side yet (see issue #107 for the backend SDKs).',
  },
  {
    id: 'gdrive',
    label: 'Google Drive',
    wired: false,
    note: 'OAuth flow is not wired browser-side yet (see issue #107 for the backend SDKs).',
  },
]

export interface UploadToCloudInput {
  dataset: ConsoleDataset
  /** The canonical zip bytes (already fetched by the caller). */
  zipBytes: Uint8Array
  target: CloudTarget
  /** Hugging Face repo id, e.g. "user/wake-words-zh-en". */
  hfRepoId?: string
  /** Settings cloud.hf.token. */
  hfToken?: string
}

/** Upload a dataset's zip to the chosen cloud. Returns the cloud ref
 *  (e.g. "hf://user/ds") or throws a clear error. */
export async function uploadDatasetToCloud(input: UploadToCloudInput): Promise<string> {
  const { zipBytes, target } = input
  if (target === 'hf') {
    if (!input.hfRepoId?.trim() || !input.hfToken) {
      throw new Error(
        'A Hugging Face repo id AND a token are required — set the token in Settings → Cloud storage.',
      )
    }
    const repo = await pushToHuggingFace({
      repoId: input.hfRepoId,
      token: input.hfToken,
      zipBytes,
      fileName: `${input.dataset.id}-wake-studio-dataset.zip`,
    })
    return `hf://${repo}`
  }
  const meta = CLOUD_TARGETS.find((c) => c.id === target)
  throw new Error(
    `${meta?.label ?? target} is not wired browser-side yet — ${meta?.note ?? ''} (issue #107).`,
  )
}
