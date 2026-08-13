/**
 * Training console — train file card + notebook preview (issue #105).
 *
 * Shows a train input file for review. For a Colab notebook (.ipynb, served
 * from this app's own origin — no GitHub fetch) the cells are rendered
 * read-only on the panel; for scripts a plain card with download/link is
 * shown. Used in the wizard's "Ready to start" step and the train details
 * pane ("inputs review").
 */

import { useEffect, useState } from 'react'
import { cn } from '../../components/cn'
import { IconSpinner } from '../../components/icons'

export interface FileReviewCardProps {
  title: string
  fileName: string
  /** 'notebook' renders the cells read-only; 'script' is a plain card. */
  kind: 'notebook' | 'script'
  /** URL the file is fetched from (the app's own origin for module files). */
  rawUrl?: string
  /** Primary open link (e.g. "Open in Colab"). */
  openUrl?: string
  openLabel?: string
  description?: string
  className?: string
}

interface NotebookCell {
  cell_type: 'markdown' | 'code' | 'raw'
  source?: string[] | string
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

async function fetchNotebook(rawUrl: string): Promise<{ cells: NotebookCell[]; sizeBytes: number }> {
  const res = await fetch(rawUrl)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const bytes = await res.arrayBuffer()
  const text = new TextDecoder().decode(bytes)
  let cells: NotebookCell[] = []
  try {
    const nb = JSON.parse(text) as { cells?: NotebookCell[] }
    cells = Array.isArray(nb.cells) ? nb.cells : []
  } catch {
    /* not a notebook JSON — cells stay empty, size still shown */
  }
  return { cells, sizeBytes: bytes.byteLength }
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

function cellSource(cell: NotebookCell): string {
  return Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? '')
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
  const [cells, setCells] = useState<NotebookCell[]>([])
  const [sizeBytes, setSizeBytes] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setCells([])
    setSizeBytes(null)
    setFailed(false)
    if (!rawUrl) return
    fetchNotebook(rawUrl)
      .then((nb) => {
        if (!alive) return
        setCells(kind === 'notebook' ? nb.cells : [])
        setSizeBytes(nb.sizeBytes)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [rawUrl, kind])

  const showCells = kind === 'notebook' && cells.length > 0

  return (
    <div className={cn('rounded-xl border border-line bg-surface-2', className)}>
      {/* Header. */}
      <div className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink-1">{title}</div>
            <div className="mt-0.5 truncate font-mono text-xs text-ink-3" title={fileName}>
              {fileName}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {sizeBytes !== null ? (
              <span className="text-[11px] text-ink-3">
                {showCells ? `${cells.length} cells · ` : ''}
                {formatBytes(sizeBytes)}
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
            Could not fetch the file (offline?) — the download may fail.
          </p>
        )}
      </div>

      {/* Notebook cells (read-only preview). */}
      {showCells && (
        <div className="max-h-96 overflow-y-auto border-t border-line">
          {cells.map((cell, i) => {
            const src = cellSource(cell)
            const isCode = cell.cell_type === 'code'
            return (
              <div
                key={i}
                className="border-b border-line last:border-b-0"
              >
                <div className="flex items-center gap-2 bg-surface-3 px-4 py-1 text-[10px] text-ink-3">
                  <span className="font-mono">[{i}]</span>
                  <span className="uppercase tracking-wide">{cell.cell_type}</span>
                </div>
                {src.trim() && (
                  <div className="px-4 py-2">
                    {isCode ? (
                      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-1">
                        {src}
                      </pre>
                    ) : (
                      <div className="whitespace-pre-wrap text-xs leading-relaxed text-ink-2">
                        {src}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}