/**
 * Notebook reviewer (issue #105) — a read-only .ipynb viewer.
 *
 * Fetches the notebook from the app's own origin and renders its cells:
 * markdown cells through the mini markdown renderer, code cells with line
 * numbers (long cells collapse), raw cells as text. A chapter outline (from
 * markdown headings) jumps to the matching cell. Used inside FileReviewCard
 * on the wizard's Ready step and the train details "inputs review".
 */

import { useEffect, useMemo, useState } from 'react'
import { cn } from '../../components/cn'
import { renderMarkdown, markdownHeadings } from './markdown'

interface NotebookCell {
  cell_type: 'markdown' | 'code' | 'raw'
  source?: string[] | string
  execution_count?: number | null
}

export interface NotebookPreviewProps {
  rawUrl: string
  className?: string
}

const MAX_COLLAPSED_CODE_LINES = 24

function cellSource(cell: NotebookCell): string {
  return Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? '')
}

export function NotebookPreview({ rawUrl, className }: NotebookPreviewProps) {
  const [cells, setCells] = useState<NotebookCell[]>([])
  const [failed, setFailed] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())

  useEffect(() => {
    let alive = true
    setCells([])
    setFailed(false)
    fetch(rawUrl)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((nb: { cells?: NotebookCell[] }) => {
        if (!alive) return
        setCells(Array.isArray(nb.cells) ? nb.cells : [])
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [rawUrl])

  // Chapter outline: markdown headings with their cell index.
  const chapters = useMemo(() => {
    const out: Array<{ text: string; cell: number }> = []
    cells.forEach((cell, i) => {
      if (cell.cell_type !== 'markdown') return
      const headings = markdownHeadings(cellSource(cell))
      if (headings.length > 0) out.push({ text: headings[0].text, cell: i })
    })
    return out
  }, [cells])

  if (failed) {
    return (
      <div className="px-4 pb-4 text-[11px] text-ink-3">
        Could not fetch the notebook (offline?) — use the Download button above.
      </div>
    )
  }

  if (cells.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 pb-4 text-[11px] text-ink-3">
        <span aria-hidden>⏳</span> Loading notebook cells…
      </div>
    )
  }

  const toggle = (i: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })

  return (
    <div className={cn('border-t border-line', className)}>
      {/* Chapter outline. */}
      {chapters.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line bg-surface-3 px-4 py-2">
          {chapters.map((ch, k) => (
            <button
              key={k}
              type="button"
              onClick={() =>
                document.getElementById(`nb-cell-${ch.cell}`)?.scrollIntoView({ block: 'start' })
              }
              className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] text-ink-2 transition-colors hover:border-brand-500/40 hover:text-ink-1"
            >
              {ch.text}
            </button>
          ))}
        </div>
      )}

      <div className="max-h-[26rem] overflow-y-auto">
        {cells.map((cell, i) => {
          const src = cellSource(cell)
          const isCode = cell.cell_type === 'code'
          const isMarkdown = cell.cell_type === 'markdown'
          const lines = src.split('\n')
          const tooLong = isCode && lines.length > MAX_COLLAPSED_CODE_LINES
          const showCollapsed = tooLong && collapsed.has(i)

          return (
            <div key={i} id={`nb-cell-${i}`} className="border-b border-line last:border-b-0">
              <div className="flex items-center gap-2 bg-surface-3 px-4 py-1 text-[10px] text-ink-3">
                <span className="font-mono">[{i}]</span>
                <span className="uppercase tracking-wide">{cell.cell_type}</span>
                {isCode && typeof cell.execution_count === 'number' && (
                  <span className="font-mono">· executed {cell.execution_count}×</span>
                )}
                {tooLong && (
                  <button
                    type="button"
                    onClick={() => toggle(i)}
                    className="ml-auto text-[10px] text-brand-500 underline-offset-2 hover:underline"
                  >
                    {showCollapsed ? 'Expand' : 'Collapse'}
                  </button>
                )}
              </div>

              {src.trim() && (
                <div className="px-4 py-2.5">
                  {isCode && (
                    <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-1">
                      {lines
                        .slice(0, showCollapsed ? MAX_COLLAPSED_CODE_LINES : undefined)
                        .map((l, ln) => (
                          <span key={ln} className="block">
                            <span className="mr-3 inline-block w-6 select-none text-right text-ink-3/70">
                              {ln + 1}
                            </span>
                            {l || ' '}
                          </span>
                        ))}
                      {showCollapsed && lines.length > MAX_COLLAPSED_CODE_LINES && (
                        <span className="block text-ink-3">… {lines.length - MAX_COLLAPSED_CODE_LINES} more lines</span>
                      )}
                    </pre>
                  )}

                  {isMarkdown && (
                    <div
                      className="prose-notebook text-xs leading-relaxed text-ink-2"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(src) }}
                    />
                  )}

                  {cell.cell_type === 'raw' && (
                    <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-relaxed text-ink-2">
                      {src}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}