/**
 * Training console — file review card (issue #105).
 *
 * Shows a train input file (the Colab .ipynb notebook, an upstream script,
 * or a local train entry) for review: name, size, cell count when it is a
 * notebook, plus Download and Open (Colab / source) actions. Used in the
 * wizard's "Ready to start" step and in the train details pane ("inputs
 * review"). Fetches the raw file client-side; degrades to a link card when
 * offline.
 */

import { useEffect, useState } from 'react'
import { cn } from '../../components/cn'
import { IconSpinner } from '../../components/icons'

export interface FileReviewCardProps {
  title: string
  fileName: string
  /** Raw URL the file is fetched from (download + preview metadata). */
  rawUrl?: string
  /** Primary open link (e.g. "Open in Colab"). */
  openUrl?: string
  openLabel?: string
  description?: string
  className?: string
}

interface NotebookMeta {
  cells: number
  sizeBytes: number
}

async function fetchMeta(rawUrl: string): Promise<NotebookMeta> {
  const res = await fetch(rawUrl)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const bytes = await res.arrayBuffer()
  const text = new TextDecoder().decode(bytes)
  let cells = 0
  try {
    const nb = JSON.parse(text)
    if (Array.isArray(nb.cells)) cells = nb.cells.length
  } catch {
    /* not a notebook JSON — just show the size */
  }
  return { cells, sizeBytes: bytes.byteLength }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
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
      // Fall back to opening the raw file (user can save manually).
      window.open(rawUrl, '_blank', 'noreferrer')
    })
}

export function FileReviewCard({
  title,
  fileName,
  rawUrl,
  openUrl,
  openLabel = 'Open',
  description,
  className,
}: FileReviewCardProps) {
  const [meta, setMeta] = useState<NotebookMeta | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setMeta(null)
    setFailed(false)
    if (!rawUrl) return
    fetchMeta(rawUrl)
      .then((m) => alive && setMeta(m))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [rawUrl])

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
          {meta ? (
            <span className="text-[11px] text-ink-3">
              {meta.cells > 0 ? `${meta.cells} cells · ` : ''}
              {formatBytes(meta.sizeBytes)}
            </span>
          ) : rawUrl && !failed ? (
            <IconSpinner className="h-3.5 w-3.5 text-ink-3" />
          ) : null}
        </div>
      </div>

      {description && <p className="mt-2 text-xs leading-relaxed text-ink-2">{description}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-ink-1 transition-colors hover:bg-brand-400"
          >
            {openLabel}
          </a>
        )}
      </div>

      {failed && (
        <p className="mt-2 text-[11px] text-ink-3">
          Could not fetch the file (offline?) — the download link may fail.
        </p>
      )}
    </div>
  )
}