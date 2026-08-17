/**
 * "Free On Google Colab" — generates a standalone studio-backend notebook.
 *
 * The notebook is built client-side from a template (no repo asset): it
 * starts the studio-backend service inside the Colab runtime and exposes it
 * through a free trycloudflare tunnel (ADR-023 amendment / issue #123), then
 * prints the tunnel URL + token for the user to paste into the Backends
 * "New" form. `instance=short-term` so /health reports the Colab nature.
 *
 * The generated notebook mirrors the openwakeword notebook's Step 1.5 cell.
 */

export interface NotebookCell {
  cell_type: 'markdown' | 'code'
  metadata: Record<string, never>
  source: string[]
  execution_count?: number | null
  outputs?: unknown[]
}

export const BACKEND_NOTEBOOK_FILENAME = 'studio-backend.ipynb'

const MD_INTRO = `# WakeStudio · Studio-backend on Google Colab (short-term)

This notebook starts the **WakeStudio studio-backend service** inside this
Colab runtime and exposes it through a free **trycloudflare tunnel**, so the
WakeStudio app can drive this runtime as a **short-term backend** — submit
training jobs, watch live progress, pause/resume/cancel, and pull artifacts
(ADR-023 amendment, ADR-036).

## How to use it

1. **Download** this notebook (the download button above) and open it in
   [Google Colab](https://colab.research.google.com) via
   **File → Upload notebook** (drag the file in).
2. **Runtime → Run all.** The cells install the service from the WakeStudio
   repo and start the tunnel (~1–2 min).
3. **Copy the printed URL and token** from the last cell.
4. In WakeStudio, open **Backends → New**, paste the URL + token, and save —
   the kind is detected automatically (short-term).

> The runtime is ephemeral: Colab may recycle it. Re-run the last cell after
> a reconnect — a fresh URL is printed (checkpoint/resume keeps long jobs
> going; see the notebook output for details).
`

const CODE_PARAMS = (revision: string) => `#@title Params
# Colab input panel - edit before running, or run as-is.

# Leave empty to auto-generate a random token (printed in the last cell).
WAKE_SERVICE_TOKEN = "" #@param {type:"string"}
WAKE_SERVICE_PORT = 4824 #@param {type:"integer"}

# Service revision (option A', #159): the wheel bakes it and module staging
# fetches it - the notebook, the installed service, and the staged module
# code are one commit. Default = latest main resolved at download time;
# override to pin an older commit.
REVISION = "${revision}" #@param {type:"string"}
`

function codeLaunch(): string {
  // The service is installed at $REVISION - the value from the Params form
  // (default = the revision the PWA resolved at download time, #159 option
  // A'). The wheel bakes that same revision and ModuleStager stages module
  // assets from it: one commit for notebook, service, and staged module
  // code. IPython ! shell lines expand $REVISION from the Python namespace.
  return `# --- Start the studio-backend service + tunnel -----------------------------
# Installs the service from this repo at revision \`$REVISION\` (Params form;
# the wheel bakes the same revision and module staging fetches the same
# commit - see ModuleStager / repo_tarball_url, #159). instance=short-term so
# /health reports the Colab nature.
#
# This notebook is GENERIC - it knows no module names. The service loads its
# bundled registry (all registered modules) and stages each module's assets
# from the repo tarball on demand (staged_dir / ModuleStager, #159): the
# module the job names decides what gets staged - any registered module works
# without notebook changes.
import os, secrets

!pip install -q "studio-backend @ git+https://github.com/awareride/wake-studio@$REVISION#subdirectory=apps/studio-backend"
!pip install -q uv  # the service's train runner (ADR-028)

from wake_training_service.colab_launcher import launch

WAKE_SERVICE_TOKEN = WAKE_SERVICE_TOKEN or secrets.token_urlsafe(24)

# Hand the Params-form REVISION to the service: module staging (ModuleStager /
# _staging_revision) prefers this explicit value over the wheel's baked one.
os.environ["WAKE_REVISION"] = REVISION

RUNTIME = os.path.abspath("./wake-studio-runtime")
os.makedirs(RUNTIME, exist_ok=True)

print(f"Service revision: {REVISION}")

launcher = launch(
    port=WAKE_SERVICE_PORT,
    token=WAKE_SERVICE_TOKEN,
    instance="short-term",
    db=os.path.join(RUNTIME, "wake-service.db"),
    artifacts_dir=os.path.join(RUNTIME, "artifacts"),
    staged_dir=os.path.join(RUNTIME, "staged"),
)

url = launcher.wait_for_url(timeout=120)
if url:
    print(f"\\n🚀 WakeStudio backend URL: {url}\\n")
else:
    print("\\nTunnel did not come up - check the [cloudflared] output above.")
print(f"Token: {WAKE_SERVICE_TOKEN}")
print("Paste both into WakeStudio -> Backends -> New.")
print("The service keeps running in the background - re-run this cell after a reconnect.")
`
}

/**
 * Resolve the latest main revision to pin the notebook to (option A', #159).
 *
 * The PWA fetches it at download time from the public GitHub API; any failure
 * (offline, rate limit) falls back to "main" - the wheel's baked revision then
 * keeps install + staging consistent with each other.
 */
export async function resolveColabRevision(): Promise<string> {
  try {
    const res = await fetch(
      'https://api.github.com/repos/awareride/wake-studio/commits/main',
      { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) return 'main'
    const data = (await res.json()) as { sha?: unknown }
    return typeof data.sha === 'string' && data.sha.length > 0 ? data.sha : 'main'
  } catch {
    return 'main'
  }
}

function cell(cellType: 'markdown' | 'code', source: string): NotebookCell {
  const base: NotebookCell = {
    cell_type: cellType,
    metadata: {},
    source: source.split('\n').map((l) => (l === '' ? '' : l + '\n')).slice(0, -1).concat(['\n']),
  }
  // notebook-viewer-ts CodeCell requires outputs (c.outputs.map in its ctor).
  if (cellType === 'code') {
    return { ...base, execution_count: null, outputs: [] }
  }
  return base
}

/** Build the standalone studio-backend notebook (nbformat 4). */
export function buildBackendNotebook(revision: string = 'main'): NotebookCell[] {
  return [
    cell('markdown', MD_INTRO),
    cell('code', CODE_PARAMS(revision)),
    cell('code', codeLaunch()),
  ]
}

export function buildBackendNotebookJson(revision: string = 'main'): string {
  const nb = {
    nbformat: 4,
    nbformat_minor: 0,
    metadata: {
      colab: { provenance: [], name: 'WakeStudio - studio-backend (short-term)' },
      kernelspec: { name: 'python3', display_name: 'Python 3' },
      language_info: { name: 'python' },
    },
    cells: buildBackendNotebook(revision),
  }
  return JSON.stringify(nb, null, 1)
}

/**
 * Resolve the pinned revision and trigger a browser download of the notebook.
 */
export async function downloadBackendNotebook(): Promise<string> {
  const revision = await resolveColabRevision()
  const blob = new Blob([buildBackendNotebookJson(revision)], {
    type: 'application/x-ipynb+json',
  })
  return URL.createObjectURL(blob)
}
