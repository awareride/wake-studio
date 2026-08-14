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

const CODE_PARAMS = `# --- Params (edit if needed) ---------------------------------------------
import os

# Leave empty to generate a random token (printed in the last cell).
WAKE_SERVICE_TOKEN = os.environ.get("WAKE_SERVICE_TOKEN", "")
WAKE_SERVICE_PORT = int(os.environ.get("WAKE_SERVICE_PORT", "4824"))
`

const CODE_LAUNCH = `# --- Start the studio-backend service + tunnel -----------------------------
# Installs the service from this repo (pinned to main) and starts it with the
# colab launcher: service thread + cloudflared, URL printed, fresh URL on
# reconnect (issue #123). The service reports instance=short-term via /health.
import os, secrets

!pip install -q "git+https://github.com/awareride/wake-studio@main#subdirectory=apps/studio-backend"
!pip install -q uv  # the service's train runner (ADR-028)

from wake_training_service.colab_launcher import launch

WAKE_SERVICE_TOKEN = WAKE_SERVICE_TOKEN or secrets.token_urlsafe(24)

launcher = launch(
    registry={},  # no module train scripts in this generic runtime
    port=WAKE_SERVICE_PORT,
    token=WAKE_SERVICE_TOKEN,
    instance="short-term",
    db=os.path.abspath("./wake-studio-runtime/wake-service.db"),
    artifacts_dir=os.path.abspath("./wake-studio-runtime/artifacts"),
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
  return [cell('markdown', MD_INTRO), cell('code', CODE_PARAMS), cell('code', CODE_LAUNCH)]
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
