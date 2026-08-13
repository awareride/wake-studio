/**
 * Training console — train file card (issue #105).
 *
 * Header + actions for a train input file. Notebooks get a "Review" button
 * that opens the full NotebookTs review dialog (the panel itself never shows
 * the cells inline); scripts are plain cards. Module-owned files are served
 * from the app's own origin (public/train/<module-id>/) — the WakeStudio
 * repo only provides the template, never fetched at runtime.
 */

import { useEffect, useState } from 'react'
import { cn } from '../../components/cn'
import { IconSpinner } from '../../components/icons'
import { NotebookReviewDialog } from './NotebookReviewDialog'

export interface FileReviewCardProps {
  title: string
  fileName: string
  /** 'notebook' offers a full Review dialog; 'script' is a plain card. */
  kind: 'notebook' | 'script'
  /** URL the file is fetched from (the app's own origin for module files). */
  rawUrl?: string
  /** Optional secondary open link (upstream notebooks/scripts only). */
  openUrl?: string
  openLabel?: string
  description?: string
  className?: string
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

function downloadFile(rawUrl: string, fileName: string) {
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

export function FileReviewCard({
  title,
  fileName,
  kind,
  rawUrl,
  openUrl,
  openLabel = 'Open',
  description,
  className,
}: FileReviewCardProps) {
  const [sizeBytes, setSizeBytes] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

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
        {isNotebook && rawUrl && (
          <button
            type="button"
            onClick={() => setReviewOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-ink-1 transition-colors hover:bg-brand-400"
          >
            Review
          </button>
        )}
        {rawUrl && (
          <button
            type="button"
            onClick={() => downloadFile(rawUrl, fileName)}
            className="rounded-lg border border-line bg-surface-3 px-3 py-1.5 text-xs font-medium text-ink-1 transition-colors hover:bg-surface-4"
          >
            Download {fileName}
          </button>
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

      {failed && (
        <p className="mt-2 text-[11px] text-ink-3">
          Could not fetch the file (offline?) — the download may fail.
        </p>
      )}

      {isNotebook && rawUrl && (
        <NotebookReviewDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          fileName={fileName}
          rawUrl={rawUrl}
        />
      )}
    </div>
  )
}