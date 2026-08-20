/**
 * Datasets console — layout (ADR-044 §8, issue #208).
 *
 * Mirrors the Training console: a top-level `Datasets` view with a header
 * (+ New generation task), a left rail (the dataset list: built-ins + the
 * backend `datasets/` store + browser-local datasets), and a right details
 * pane (manifest / provenance / storage / quality report + actions). The
 * generation wizard is a full panel that replaces the list-detail layout.
 *
 * PR 1 (shell + route) ships the layout shell + empty states; the rail,
 * details pane, wizard and actions land in the #208 follow-up PRs.
 */

import { useState } from 'react'
import { Button } from '@radix-ui/themes'
import { ConsolePanel } from '../../components/ConsolePanel'
import { IconWand } from '../../components/icons'

type View = { kind: 'empty' } | { kind: 'wizard' }

export function DatasetsConsole() {
  const [view, setView] = useState<View>({ kind: 'empty' })

  if (view.kind === 'wizard') {
    // The generation wizard is a full panel (no rail) — lands in the
    // generation-wizard PR of #208.
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-line bg-surface-2 p-8 text-sm text-ink-2">
        Generation wizard coming in this change set.
      </div>
    )
  }

  return (
    <ConsolePanel
      title="Datasets"
      description="First-class training-data artifacts: pick built-ins, generate synthetic audio with a TTS engine, and persist to the backend store and/or your cloud. Every dataset is one canonical wake-studio-dataset.zip (ADR-044)."
      actions={
        <Button
          type="button"
          onClick={() => setView({ kind: 'wizard' })}
          size="2"
          className="shrink-0 gap-1.5 font-semibold"
        >
          <IconWand className="h-4 w-4" />
          New
        </Button>
      }
      railTitle="Datasets"
      rail={() => (
        <div className="px-4 py-6 text-xs leading-relaxed text-ink-3">
          No datasets yet. Press <span className="font-medium text-ink-2">New</span> to generate
          one with a TTS engine — built-ins and generated datasets land here.
        </div>
      )}
      details={null}
      detailsEmpty={
        <div className="rounded-xl border border-line bg-surface-2 p-8 text-center">
          <p className="text-sm font-medium text-ink-1">No dataset selected</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-3">
            Pick a dataset in the left rail to inspect its manifest, provenance and storage, or
            press <span className="font-medium text-ink-2">New</span> to generate one.
          </p>
        </div>
      }
    />
  )
}

export default DatasetsConsole
