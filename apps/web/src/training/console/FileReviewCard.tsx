/**
 * Training console — train file card (issue #105).
 *
 * Header + actions for a train input file. Notebooks offer a "Review" button
 * that switches the current panel to the full NotebookReviewView (no inline
 * preview). For notebooks, the Download produces a PERSONALIZED .ipynb:
 * the user's configured params are baked into the Step-0 cell (spec
 * train.params env mapping), so running the notebook uses exactly what was
 * configured. Module-owned files are served from the app's own origin.
 */

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@radix-ui/themes'
import {
  personalizeNotebook,
  personalizedParamIds,
  type EnvParam,
} from '@wake-studio/module-training'
import { cn } from '../../components/cn'
import { IconSpinner } from '../../components/icons'

export interface FileReviewCardProps {
  title: string
  fileName: string
  /** 'notebook' offers a full Review panel; 'script' is a plain card. */
  kind: 'notebook' | 'script'
  /** URL the file is fetched from (the app's own origin for module files). */
  rawUrl?: string
  /** Optional secondary open link (upstream notebooks/scripts only). */
  openUrl?: string
  openLabel?: string
  description?: string
  className?: string
  /** Open the full notebook review panel (notebook kind). */
  onReview?: () => void
  /** User-configured params + the module's train param defs (for the
   *  personalized download — spec.train.params with env). */
  params?: Record<string, string>
  paramMeta?: readonly EnvParam[]
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

async function fetchSize(rawUrl: string): Promise<number> {
  const res = await fetch(rawUrl)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const bytes = await res.arrayBuffer()
  return bytes.byteLength
}

/** Download a file from a raw URL (fallback: open it). */
function downloadRaw(rawUrl: string, fileName: string) {
  void fetch(rawUrl)
    .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((blob) => {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    })
    .catch(() => {
      window.open(rawUrl, '_blank', 'noreferrer')
    })
}

/** Download the notebook with the user's params baked in (issue #105). */
function downloadPersonalized(
  rawUrl: string,
  fileName: string,
  params: Record<string, string>,
  paramMeta: readonly EnvParam[],
) {
  void fetch(rawUrl)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((json) => JSON.stringify(personalizeNotebook(json, paramMeta, params), null, 1))
    .then((blob) => {
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    })
    .catch(() => downloadRaw(rawUrl, fileName))
}

export function FileReviewCard({
  title,
  fileName,
  kind,
  rawUrl,
  openUrl,
  openLabel = 'Open',
  description,
  className,
  onReview,
  params,
  paramMeta,
}: FileReviewCardProps) {
  const [sizeBytes, setSizeBytes] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setSizeBytes(null)
    setFailed(false)
    if (!rawUrl) return
    fetchSize(rawUrl)
      .then((bytes) => alive && setSizeBytes(bytes))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [rawUrl])

  const isNotebook = kind === 'notebook'
  const bakedIn = useMemo(
    () => (isNotebook && paramMeta ? personalizedParamIds(paramMeta, params ?? {}) : []),
    [isNotebook, paramMeta, params],
  )

  return (
    <div className={cn('rounded-xl border border-line bg-surface-2 p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink-1">{title}</div>
          <div className="mt-0.5 truncate font-mono text-xs text-ink-3" title={fileName}>
            {fileName}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {sizeBytes !== null ? (
            <span className="text-[11px] text-ink-3">{formatBytes(sizeBytes)}</span>
          ) : rawUrl && !failed ? (
            <IconSpinner className="h-3.5 w-3.5 text-ink-3" />
          ) : null}
        </div>
      </div>

      {description && <p className="mt-2 text-xs leading-relaxed text-ink-2">{description}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {isNotebook && onReview && (
          <Button
            type="button"
            onClick={onReview}
            size="2"
            className="gap-1.5 text-xs font-semibold"
          >
            Review
          </Button>
        )}
        {rawUrl && (
          <Button
            type="button"
            onClick={() =>
              isNotebook && params && paramMeta
                ? downloadPersonalized(rawUrl, fileName, params, paramMeta)
                : downloadRaw(rawUrl, fileName)
            }
            variant="surface"
            size="2"
            className="text-xs font-medium"
          >
            Download {fileName}
          </Button>
        )}
        {openUrl && (
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-3 px-3 py-1.5 text-xs font-medium text-ink-1 transition-colors hover:bg-surface-4"
          >
            {openLabel}
          </a>
        )}
      </div>

      {bakedIn.length > 0 && (
        <p className="mt-2 text-[11px] text-success">
          ✓ This download includes your params ({bakedIn.join(', ')}) baked into the notebook.
        </p>
      )}

      {failed && (
        <p className="mt-2 text-[11px] text-ink-3">
          Could not fetch the file (offline?) — the download may fail.
        </p>
      )}
    </div>
  )
}