/**
 * Training console — train input file resolution (issue #105).
 *
 * Given a trainable module + method, resolve the file the "Ready to start"
 * step (and the train details "inputs review") should show:
 *  - Colab + module-owned notebook (spec.train.notebookLocal) → our repo raw
 *    + Open in Colab (ADR-035).
 *  - Colab + upstream notebook (spec.train.notebook) → the upstream repo raw
 *    + Open in Colab.
 *  - subprocess/ci → the upstream script (spec.train.script) or the local
 *    train entry (spec.train.entry).
 */

import { resolveAsset } from '@wake-studio/platform'
import type { TrainMethodId } from '@wake-studio/module-training'
import type { TrainableModule } from '../train-modules'

/**
 * Module-owned train files (notebookLocal / entry) are copied into the app's
 * public/train/<module-id>/ at build time (scripts/build-model-registry.mjs)
 * and served from the app's own origin — users never fetch them from the
 * WakeStudio GitHub repo (issue #105). Upstream files (spec.train.notebook /
 * script) stay on their third-party repos; we only link to those.
 */
function moduleOwnedUrl(moduleId: string, fileName: string): string {
  return resolveAsset(`train/${moduleId}/${fileName}`)
}

/** 'https://github.com/org/repo' | 'org/repo' → 'org/repo'. */
function repoSlug(repo: string): string {
  return repo.replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '')
}

function rawUrl(org: string, repo: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${org}/${repo}/${ref}/${path}`
}

function upstreamRawUrl(repo: string, ref: string, path: string): string {
  const [org, name] = repoSlug(repo).split('/')
  return rawUrl(org, name, ref, path)
}

function colabUrl(repo: string, ref: string, path: string): string {
  return `https://colab.research.google.com/github/${repoSlug(repo)}/blob/${ref}/${path}`
}

function githubBlobUrl(repo: string, ref: string, path: string): string {
  return `https://github.com/${repoSlug(repo)}/blob/${ref}/${path}`
}

export interface TrainInputFile {
  kind: 'notebook' | 'script'
  title: string
  fileName: string
  rawUrl?: string
  openUrl?: string
  openLabel?: string
  description?: string
}

/** Resolve the file to review for a module + method (null when none). */
export function trainInputFile(
  module: TrainableModule,
  method: TrainMethodId,
): TrainInputFile | null {
  const t = module.train

  if (method === 'colab') {
    if (t.notebookLocal) {
      const fileName = t.notebookLocal.split('/').pop() ?? 'train.ipynb'
      return {
        kind: 'notebook',
        title: 'Training notebook (module-owned)',
        fileName,
        rawUrl: moduleOwnedUrl(module.id, fileName),
        description:
          'WakeStudio-owned template notebook (ADR-035): generates synthetic data (Piper), runs the pinned upstream trainer, and writes the standard result bundle. Download it and upload it to Google Colab — the repo only provides the template, your run is your own.',
      }
    }
    if (t.notebook) {
      return {
        kind: 'notebook',
        title: 'Training notebook (upstream)',
        fileName: t.notebook.path.split('/').pop() ?? 'notebook.ipynb',
        rawUrl: upstreamRawUrl(t.notebook.repo, t.notebook.ref, t.notebook.path),
        openUrl: colabUrl(t.notebook.repo, t.notebook.ref, t.notebook.path),
        openLabel: 'Open in Colab',
        description: `Upstream notebook — ${t.notebook.repo}@${t.notebook.ref} (we adapt to it, we do not rewrite it).`,
      }
    }
  }

  if (t.script) {
    return {
      kind: 'script',
      title: 'Train script (upstream)',
      fileName: t.script.path.split('/').pop() ?? 'train.py',
      rawUrl: upstreamRawUrl(t.script.repo, t.script.ref, t.script.path),
      openUrl: githubBlobUrl(t.script.repo, t.script.ref, t.script.path),
      openLabel: 'View source',
      description: `${t.script.entrypoint ?? 'python'} · ${t.script.repo}@${t.script.ref}`,
    }
  }

  if (t.entry) {
    const fileName = t.entry.split('/').pop() ?? 'train.py'
    return {
      kind: 'script',
      title: 'Train script (module-owned)',
      fileName,
      rawUrl: moduleOwnedUrl(module.id, fileName),
      description: `Module-owned train entry — ${t.python ?? 'python'} runtime, deps in ${t.deps ?? 'train/pyproject.toml'}.`,
    }
  }

  return null
}