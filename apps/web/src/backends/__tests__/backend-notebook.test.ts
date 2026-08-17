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

  it('registers the dry-run demo module so jobs work on a generic runtime', () => {
    const src = buildBackendNotebook()
      .map((c) => c.source.join(''))
      .join('\n')
    expect(src).toContain('dry-run')
    expect(src).toContain('dry_run.py')
  })

  it('stages the kws-streaming module + vendored upstream for real training', () => {
    const src = buildBackendNotebook()
      .map((c) => c.source.join(''))
      .join('\n')
    // installs the service with the real-training extras (TF pins, #159)
    expect(src).toContain('studio-backend[tf,tts] @')
    // fetches the adapter + third_party/kws_streaming from the repo tarball
    expect(src).toContain('codeload.github.com/awareride/wake-studio/tar.gz')
    expect(src).toContain('third_party/kws_streaming')
    expect(src).toContain('KWS_TRAIN_DIR')
    expect(src).toContain('UPSTREAM_DIR')
    // registry comes from the service's own registry.json (single source)
    expect(src).toContain('registry.json')
    expect(src).toContain('REG["kws-streaming"]["cwd"]')
  })

  it('downloads under the stable filename', () => {
    expect(BACKEND_NOTEBOOK_FILENAME).toBe('studio-backend.ipynb')
  })
})
