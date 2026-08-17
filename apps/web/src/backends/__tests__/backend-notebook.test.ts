/**
 * "Free On Google Colab" notebook template tests.
 */

import { describe, expect, it } from 'vitest'
import {
  BACKEND_NOTEBOOK_FILENAME,
  buildBackendNotebook,
  buildBackendNotebookJson,
} from '../backend-notebook'

describe('backend notebook template', () => {
  it('produces a valid nbformat-4 notebook with the three cells', () => {
    const nb = JSON.parse(buildBackendNotebookJson())
    expect(nb.nbformat).toBe(4)
    expect(nb.cells).toHaveLength(3)
    expect(nb.cells.map((c: { cell_type: string }) => c.cell_type)).toEqual([
      'markdown',
      'code',
      'code',
    ])
    // sources are arrays of lines (the NotebookTs reviewer contract)
    for (const c of nb.cells) {
      expect(Array.isArray(c.source)).toBe(true)
      expect(c.source.length).toBeGreaterThan(0)
    }
    // code cells must carry outputs: [] (notebook-viewer-ts CodeCell requires it)
    for (const c of nb.cells.filter((c: { cell_type: string }) => c.cell_type === 'code')) {
      expect(Array.isArray(c.outputs)).toBe(true)
    }
  })

  it('the launch cell starts the launcher as a short-term instance', () => {
    const src = buildBackendNotebook()
      .map((c) => c.source.join(''))
      .join('\n')
    expect(src).toContain('from wake_training_service.colab_launcher import launch')
    expect(src).toContain('instance="short-term"')
    expect(src).toContain('wait_for_url(timeout=120)')
    expect(src).toContain('trycloudflare')
  })

  it('stays fully generic - no module names, no tarball fetching (#159)', () => {
    const src = buildBackendNotebook()
      .map((c) => c.source.join(''))
      .join('\n')
    // the service package must NOT carry module train deps (#159); the module
    // env is built by uv at job time (engine=uv, extras in the module pyproject)
    expect(src).toContain('"studio-backend @ git+')
    // module staging is the SERVICE's job (ModuleStager, staged_dir) - the
    // notebook only points at the staging root
    expect(src).toContain('staged_dir')
    expect(src).toContain('wake-studio-runtime')
    // no per-module knowledge may leak into the notebook
    for (const forbidden of ['dry-run', 'dry_run.py', 'kws-streaming', 'codeload', 'third_party', 'UPSTREAM_DIR', 'registry=']) {
      expect(src).not.toContain(forbidden)
    }
  })

  it('downloads under the stable filename', () => {
    expect(BACKEND_NOTEBOOK_FILENAME).toBe('studio-backend.ipynb')
  })

  it('renders a Colab form panel for token / port / revisions (#159)', () => {
    const src = buildBackendNotebook().map((c) => c.source.join('')).join('\n')
    expect(src).toContain('#@title Params')
    expect(src).toContain('WAKE_SERVICE_TOKEN = "" #@param {type:"string"}')
    expect(src).toContain('WAKE_SERVICE_PORT = 4824 #@param {type:"integer"}')
    expect(src).toContain('REVISION = "main" #@param {type:"string"}')
    expect(src).toContain('STAGING_REVISION = "" #@param {type:"string"}')
    // the install line reads the form value (IPython $-expansion), not a baked string
    expect(src).toContain('@$REVISION#subdirectory=apps/studio-backend')
    // staging revision: empty follows REVISION, explicit choice wins
    expect(src).toContain('os.environ["WAKE_REVISION"] = STAGING_REVISION or REVISION')
  })

  it('checks for a GPU first, with CPU fallback guidance', () => {
    const src = buildBackendNotebook().map((c) => c.source.join('')).join('\n')
    expect(src).toContain('GPU first')
    expect(src).toContain('nvidia-smi')
    expect(src).toContain('Change runtime type')
  })
})
