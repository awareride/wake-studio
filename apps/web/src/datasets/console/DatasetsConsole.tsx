/**
 * Datasets console — layout (ADR-044 §8, issue #208).
 *
 * Mirrors the Training console: a top-level `Datasets` view with a header
 * (+ New generation task), a left rail (the consolidated dataset list:
 * built-ins + the backend `datasets/` store + browser-local datasets), and a
 * right details pane (manifest / provenance / storage / quality report +
 * actions). The generation wizard is a full panel that replaces the
 * list-detail layout (generation-wizard PR of #208).
 *
 * The consolidated store comes from `useDatasetsStore` (built-ins + the first
 * configured managed backend's `GET /datasets` + the browser-local IndexedDB
 * store). Selection survives view switches via `rememberSelection` (the same
 * sessionStorage pattern the Training console uses).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@radix-ui/themes'
import { ConsolePanel } from '../../components/ConsolePanel'
import { IconWand } from '../../components/icons'
import { useAppSettings } from '../../settings'
import { rememberSelection, rememberedSelection } from '../../view-selection'
import { useDatasetsStore, type ConsoleDataset } from '../store'
import { DatasetList } from './DatasetList'
import { DatasetDetails } from './DatasetDetails'

type View =
  | { kind: 'empty' }
  | { kind: 'details'; id: string }
  | { kind: 'wizard' }

export function DatasetsConsole() {
  const { backends } = useAppSettings()
  // The consolidated store is fed by the first configured managed backend
  // (same convention as the Training console's datasets[] picker).
  const backend = backends[0]
  const store = useDatasetsStore(backend?.baseUrl, backend?.token)
  const [view, setView] = useState<View>(() => {
    const last = rememberedSelection('datasets')
    return last ? { kind: 'details', id: last } : { kind: 'empty' }
  })

  // Restore the last-selected dataset once the store has loaded.
  useEffect(() => {
    if (store.loading || view.kind === 'details') return
    const last = rememberedSelection('datasets')
    if (last && store.datasets.some((d) => d.id === last)) {
      setView({ kind: 'details', id: last })
    }
  }, [store.loading, store.datasets, view.kind])

  const selected = useMemo<ConsoleDataset | null>(() => {
    if (view.kind !== 'details') return null
    return store.datasets.find((d) => d.id === view.id) ?? null
  }, [view, store.datasets])

  const open = useCallback((id: string) => {
    rememberSelection('datasets', id)
    setView({ kind: 'details', id })
  }, [])

  return (
    <>
      {view.kind === 'wizard' ? (
        /* The generation wizard is a full panel (no rail) — lands in the
           generation-wizard PR of #208. */
        <div className="flex h-full items-center justify-center rounded-xl border border-line bg-surface-2 p-8 text-sm text-ink-2">
          Generation wizard coming in this change set.
        </div>
      ) : (
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
          railCount={store.datasets.length}
          rail={(close) => (
            <DatasetList
              datasets={store.datasets}
              selectedId={selected?.id ?? null}
              loading={store.loading}
              onSelect={(id) => {
                open(id)
                close()
              }}
            />
          )}
          details={
            view.kind === 'details' && selected ? (
              <>
                <DatasetDetails key={selected.id} dataset={selected} />
                {store.backendError && (
                  <div className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-xs text-danger">
                    Could not load the backend dataset store: {store.backendError}
                  </div>
                )}
                {store.builtinError && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-700">
                    Built-in catalog unavailable: {store.builtinError}
                  </div>
                )}
              </>
            ) : null
          }
          detailsEmpty={
            view.kind === 'details' ? (
              <div className="rounded-xl border border-line bg-surface-2 p-6 text-sm text-ink-2">
                This dataset is no longer in the list (deleted?). Pick another from the rail.
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-surface-2 p-8 text-center">
                <p className="text-sm font-medium text-ink-1">No dataset selected</p>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-3">
                  Pick a dataset in the left rail to inspect its manifest, provenance, storage
                  and quality report, or press{' '}
                  <span className="font-medium text-ink-2">New</span> (the wizard wand) to
                  generate one.
                </p>
              </div>
            )
          }
        />
      )}
    </>
  )
}

export default DatasetsConsole
