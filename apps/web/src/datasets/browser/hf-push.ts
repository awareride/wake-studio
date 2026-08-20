/**
 * Datasets — direct browser push to Hugging Face (ADR-044 §8.1, #208).
 *
 * The BROWSER executor's cloud save: upload the canonical
 * `wake-studio-dataset.zip` straight to a Hugging Face dataset repo via
 * `fetch` + the Settings `cloud.hf.token` (client-side, masked, never
 * persisted). Feasible in the browser today (plain REST — no SDK). Cloudflare
 * R2 (S3 SigV4) and Google Drive (OAuth flow) are NOT wired browser-side and
 * are flagged as such — same treatment as issue #107 for the backend SDKs.
 */

export class HfPushError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HfPushError'
  }
}

const HF_API = 'https://huggingface.co/api'

export interface HfPushOptions {
  /** Dataset repo id, e.g. "user/wake-words-zh-en". */
  repoId: string
  /** Settings cloud.hf.token (client-side only). */
  token: string
  /** The canonical `wake-studio-dataset.zip` bytes. */
  zipBytes: Uint8Array
  fileName?: string
  commitMessage?: string
}

/** Create the dataset repo if it does not exist yet (409 = already there —
 *  not an error). Best-effort: a read-only token surfaces a clear message. */
async function ensureRepo(repoId: string, token: string): Promise<void> {
  const res = await fetch(`${HF_API}/repos/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ type: 'dataset', name: repoId }),
  })
  if (res.status !== 409 && !res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string }
      detail = body.error ? ` — ${body.error}` : ''
    } catch {
      /* ignore parse failure */
    }
    throw new HfPushError(
      `Could not create the dataset repo “${repoId}” (HTTP ${res.status}${detail}). ` +
        `Check the token has write access (Settings → Cloud storage → Hugging Face).`,
    )
  }
}

/** Upload the dataset zip to a Hugging Face dataset repo. Returns the repo id. */
export async function pushToHuggingFace(options: HfPushOptions): Promise<string> {
  const {
    repoId,
    token,
    zipBytes,
    fileName = 'wake-studio-dataset.zip',
    commitMessage = 'add dataset',
  } = options
  if (!repoId.trim() || !token) {
    throw new HfPushError(
      'A Hugging Face repo id AND a token are required — set the token in Settings → Cloud storage.',
    )
  }
  const cleanRepo = repoId.trim().replace(/^https?:\/\/huggingface\.co\/datasets\//, '')

  await ensureRepo(cleanRepo, token)

  // huggingface_hub-style multipart upload: a `file` part + commit query.
  const form = new FormData()
  form.append(
    'file',
    new Blob([zipBytes.slice().buffer as ArrayBuffer], { type: 'application/zip' }),
    fileName,
  )
  const url = `${HF_API}/datasets/${cleanRepo}/upload/${encodeURIComponent(fileName)}?commit_message=${encodeURIComponent(commitMessage)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  })
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: string }
      detail = body.error ? ` — ${body.error}` : ''
    } catch {
      /* ignore */
    }
    throw new HfPushError(
      `Upload to “${cleanRepo}/${fileName}” failed (HTTP ${res.status}${detail}).`,
    )
  }
  return cleanRepo
}
