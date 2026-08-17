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

const CODE_PARAMS = `#@title Params
# Colab input panel - edit before running, or run as-is.

# Leave empty to auto-generate a random token (printed in the last cell).
WAKE_SERVICE_TOKEN = "" #@param {type:"string"}
WAKE_SERVICE_PORT = 4824 #@param {type:"integer"}

# Service revision: the branch/commit the pip-installed studio-backend comes
# from. Default: main.
REVISION = "main" #@param {type:"string"}

# Staging revision: the branch/commit module assets are staged from
# (ModuleStager). Empty = follow REVISION. Set a branch/SHA to test module
# code without changing the installed service.
STAGING_REVISION = "" #@param {type:"string"}
`

function codeLaunch(): string {
  // Revisions come from the Params form (#159): REVISION pins the pip install
  // (default main); STAGING_REVISION pins module staging (empty = follow
  // REVISION) - so module code from any branch can be tested against the
  // installed service. IPython ! shell lines expand $VARS from the Python
  // namespace.
  return `# --- GPU first: check the accelerator before anything else ---------------
import subprocess

try:
    _gpu = subprocess.run(["nvidia-smi", "-L"], capture_output=True, text=True, timeout=10)
    _gpu = _gpu.stdout.strip()
except Exception:
    _gpu = ""
if _gpu:
    print(f"GPU detected: {_gpu}")
else:
    print("No GPU detected - training will run on CPU (slow).")
    print("Runtime -> Change runtime type -> Hardware accelerator: T4 GPU, then re-run.")

# --- Start the studio-backend service + tunnel -----------------------------
# Installs the service from this repo at revision \`$REVISION\` (Params form)
# and stages module assets at \`$STAGING_REVISION or REVISION\` (see
# ModuleStager / staging_revision, #159). instance=short-term so /health
# reports the Colab nature.
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

# Hand the staging revision to the service: empty STAGING_REVISION follows
# REVISION (explicit form choice > wheel's baked revision > main).
os.environ["WAKE_REVISION"] = STAGING_REVISION or REVISION

RUNTIME = os.path.abspath("./wake-studio-runtime")
os.makedirs(RUNTIME, exist_ok=True)

print(f"Service revision: {REVISION} | staging revision: {os.environ['WAKE_REVISION']}")

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
export function buildBackendNotebook(): NotebookCell[] {
  return [
    cell('markdown', MD_INTRO),
    cell('code', CODE_PARAMS),
    cell('code', codeLaunch()),
  ]
}

export function buildBackendNotebookJson(): string {
  const nb = {
    nbformat: 4,
    nbformat_minor: 0,
    metadata: {
      colab: { provenance: [], name: 'WakeStudio - studio-backend (short-term)' },
      kernelspec: { name: 'python3', display_name: 'Python 3' },
      language_info: { name: 'python' },
    },
    cells: buildBackendNotebook(),
  }
  return JSON.stringify(nb, null, 1)
}

/** Trigger a browser download of the generated notebook. */
export function downloadBackendNotebook(): string {
  const blob = new Blob([buildBackendNotebookJson()], {
    type: 'application/x-ipynb+json',
  })
  return URL.createObjectURL(blob)
}
