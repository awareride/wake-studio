/**
 * 'Import Colab results' (issue #97).
 *
 * The import half of the Colab training loop (ADR-023/035): the user picks
 * the zip the module-owned notebook produced (`wake-studio-results.zip`), the
 * importer validates the manifest (metadata.json + provenance.json), and on
 * success the model registers for in-browser test + export. Client-side only.
 */

import * as React from 'react'
import { Button } from '@radix-ui/themes'
import {
  BundleImportError,
  BUNDLE_IMPORT_ERROR_MESSAGES,
} from '@wake-studio/module-training'
import { useAppSettings } from '../settings/context'
import { useToast } from '../components/toast'
import { cn } from '../components/cn'
import { IconSpinner } from '../components/icons'
import { importColabResultsZip } from './colab-import'
import type { ColabImportResult } from './colab-import'

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function errorMessage(err: unknown): string {
  if (err instanceof BundleImportError) {
    return BUNDLE_IMPORT_ERROR_MESSAGES[err.code]
  }
  return err instanceof Error ? err.message : String(err)
}

function SuccessCard({ result }: { result: ColabImportResult }) {
  const { bundle, model } = result
  const meta = bundle.files.metadata
  const prov = bundle.files.provenance
  const metrics = bundle.files.metrics
  const phrase = String(meta.params.wakePhrase ?? '')
  const exportable = prov.license === 'user-owned'

  return (
    <div className="rounded-xl border border-success/30 bg-success/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-success">
        <span>✓ Model imported</span>
        <span className="text-xs font-normal text-ink-2">
          ready for in-browser test + export
        </span>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-3">Wake phrase</dt>
          <dd className="font-medium text-ink-1">{phrase || '—'}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-3">Job</dt>
          <dd className="truncate font-mono text-ink-1" title={bundle.jobId}>
            {bundle.jobId}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-3">Model</dt>
          <dd className="font-mono text-ink-1">
            {model.name} · {formatBytes(model.sizeBytes)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-3">Backend</dt>
          <dd className="font-mono text-ink-1">{meta.backend}</dd>
        </div>
        {typeof metrics?.recall === 'number' && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Recall</dt>
            <dd className="font-mono text-ink-1">{metrics.recall.toFixed(3)}</dd>
          </div>
        )}
        {typeof metrics?.accuracy === 'number' && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-3">Accuracy</dt>
            <dd className="font-mono text-ink-1">{metrics.accuracy.toFixed(3)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-ink-3">License</dt>
          <dd
            className={cn(
              'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              exportable
                ? 'bg-emerald-500/10 text-emerald-600'
                : 'bg-amber-500/10 text-amber-700',
            )}
          >
            {prov.license}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-xs text-ink-2">
        {exportable
          ? 'User-owned — the Phase 4 export license gate treats it as commercially clean.'
          : 'Not user-owned — the export license gate will block a commercial bundle.'}{' '}
        Open the <span className="font-medium text-ink-1">KWS detection</span> panel and press{' '}
        <span className="font-medium text-ink-1">Load models</span> to test it in-browser
        (the classifier role now points at this trained model).
      </p>
    </div>
  )
}

export interface ImportColabResultsProps {
  /**
   * Called after a bundle imports successfully (training console uses it to
   * record the job in the history rail and auto-advance to Review, #105).
   */
  onImported?: (result: ColabImportResult) => void
}

export function ImportColabResults({ onImported }: ImportColabResultsProps) {
  const { toast } = useToast()
  const { kwsSources, setKwsSources } = useAppSettings()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [importing, setImporting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<ColabImportResult | null>(null)

  const handleFile = React.useCallback(
    async (file: File | undefined) => {
      if (!file) return
      setImporting(true)
      setError(null)
      setResult(null)
      try {
        const reg = await importColabResultsZip(file)
        // Auto-select the trained classifier for the openwakeword classifier
        // role (app-level KWS model-source defaults, #52/#53): the next Load
        // in the KWS panel uses the imported model for in-browser test.
        setKwsSources({
          ...kwsSources,
          modelSources: {
            ...kwsSources.modelSources,
            classifier: reg.classifierRef,
          },
        })
        setResult(reg)
        onImported?.(reg)
        toast({
          title: 'Colab model imported',
          description: `“${reg.bundle.files.metadata.params.wakePhrase ?? reg.bundle.jobId}” is ready to test.`,
          variant: 'success',
        })
      } catch (err) {
        setError(errorMessage(err))
      } finally {
        setImporting(false)
      }
    },
    [kwsSources, onImported, setKwsSources, toast],
  )

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-ink-1">Import Colab results</h3>
        <p className="mt-1 text-xs text-ink-3">
          Pick the <code className="font-mono">wake-studio-results.zip</code> your Colab
          notebook downloaded (open the Training panel for the module, run the
          notebook, download the bundle). The importer validates the manifest —
          <code className="font-mono"> metadata.json</code> +{' '}
          <code className="font-mono">provenance.json</code> — client-side only; no
          WakeStudio server is involved.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip,application/octet-stream"
          className="hidden"
          disabled={importing}
          onChange={(e) => {
            const f = e.target.files?.[0]
            void handleFile(f)
            e.target.value = ''
          }}
        />
        <Button
          onClick={() => inputRef.current?.click()}
          disabled={importing}
          size="2"
        >
          {importing ? 'Importing…' : 'Import Colab results…'}
        </Button>
        {importing && <IconSpinner className="h-4 w-4 text-brand-11" />}
      </div>

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          <div className="font-medium">Import failed</div>
          <p className="mt-1 text-xs text-danger/90">{error}</p>
        </div>
      )}

      {result && <SuccessCard result={result} />}
    </section>
  )
}