/**
 * Notebook review dialog — full/big review of a .ipynb (issue #105).
 *
 * Uses `notebook-viewer-ts` (NotebookTs) to render the notebook: real
 * markdown (micromark), code highlighting (highlight.js), cell outputs and
 * folding. The library is lazy-loaded (dynamic import) so highlight.js /
 * micromark / katex stay out of the main bundle.
 *
 * The library's HTML is post-processed so every cell gets its own
 * Collapse/Expand toggle: the glyph flips `−` (expanded) → `+` (collapsed),
 * and a collapsed cell shows its title (markdown heading / first code line)
 * so you know what is hidden. Global Collapse-all / Expand-all buttons live
 * in the dialog header. The notebook is fetched from the app's own origin.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui'
import { cn } from '../../components/cn'
import './notebook-review.css'

export interface NotebookReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileName: string
  rawUrl: string
}

interface RawCell {
  cell_type?: 'markdown' | 'code' | 'raw'
  source?: string[] | string
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

/** A short title for a cell: markdown heading (or first line) / first code line. */
function cellTitle(cell: RawCell): string {
  const src = Array.isArray(cell.source) ? cell.source.join('') : (cell.source ?? '')
  if (cell.cell_type === 'markdown') {
    for (const line of src.split('\n')) {
      const h = /^#{1,6}\s+(.*)$/.exec(line.trim())
      if (h) return h[1].slice(0, 60)
    }
  }
  const first = src
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  return (first ?? 'cell').slice(0, 60)
}

/**
 * Add a Collapse/Expand toggle + title to every cell the library rendered.
 * The toggle is a compact −/+ button; the cell title (markdown heading or
 * first code line) sits beside it as a title-like label, shown only while
 * the cell is collapsed (issue #105). The library's own toggle buttons
 * (metadata.collapsed cells) are stripped to avoid duplicates.
 */
function addPerCellToggles(html: string, titles: string[]): string {
  let out = html.replace(
    /<button[^>]*class="[^"]*\btoggle-btn\b[^"]*"[^>]*>.*?<\/button>/gs,
    '',
  )
  let index = 0
  out = out.replace(/<div class="cell ([^"]*)">/g, (_m, cls: string) => {
    const id = `cell-${index}`
    const title = titles[index] ?? ''
    index++
    const head =
      `<div class="nb-cell-head">` +
      `<button type="button" class="nb-cell-toggle" data-toggle="#${id}" ` +
      `aria-label="Collapse or expand cell"><span class="nb-glyph">&minus;</span></button>` +
      (title
        ? `<span class="nb-cell-title" title="${escapeAttr(title)}">${escapeAttr(title)}</span>`
        : '') +
      `</div>`
    return `<div class="cell ${cls}" data-cell-id="${id}">${head}`
  })
  return out
}

export function NotebookReviewDialog({
  open,
  onOpenChange,
  fileName,
  rawUrl,
}: NotebookReviewDialogProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsedAll, setCollapsedAll] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Load + render when opened (lazy: the library is code-split).
  useEffect(() => {
    if (!open) return
    let alive = true
    setHtml(null)
    setError(null)
    setCollapsedAll(false)
    void (async () => {
      try {
        const res = await fetch(rawUrl)
        if (!res.ok) throw new Error(`Could not fetch the notebook (HTTP ${res.status})`)
        const json = (await res.json()) as { cells?: RawCell[] }
        const { Notebook } = await import('notebook-viewer-ts')
        const nb = new Notebook(json as string | object)
        if (!alive) return
        const titles = (json.cells ?? []).map(cellTitle)
        setHtml(addPerCellToggles(nb.render('tailwind'), titles))
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [open, rawUrl])

  /** Toggle one cell: content hidden + `collapsed` class + glyph −/+. */
  const toggleCell = useCallback((targetId: string, button: HTMLElement) => {
    const content = containerRef.current?.querySelector<HTMLElement>(targetId)
    if (!content) return
    const hidden = content.classList.toggle('hidden')
    button.closest('.cell')?.classList.toggle('collapsed', hidden)
    const glyph = button.querySelector('.nb-glyph')
    if (glyph) glyph.textContent = hidden ? '+' : '−'
  }, [])

  /** Click delegation: the library's [data-toggle] buttons + our per-cell toggles. */
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-toggle]')
      if (!btn) return
      const selector = btn.getAttribute('data-toggle')
      if (selector?.startsWith('#')) toggleCell(selector, btn)
    },
    [toggleCell],
  )

  /** Global Collapse-all / Expand-all. */
  const setAll = useCallback((collapsed: boolean) => {
    setCollapsedAll(collapsed)
    const root = containerRef.current
    root
      ?.querySelectorAll<HTMLElement>('.cell')
      .forEach((cell) => cell.classList.toggle('collapsed', collapsed))
    root
      ?.querySelectorAll<HTMLElement>('.cell > div[id^="cell-"]')
      .forEach((el) => el.classList.toggle('hidden', collapsed))
    root
      ?.querySelectorAll<HTMLElement>('.nb-glyph')
      .forEach((s) => (s.textContent = collapsed ? '+' : '−'))
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        centered={false}
        overlayClassName="bg-slate-900/45 backdrop-blur-sm"
        className="fixed left-1/2 top-1/2 flex max-h-[88vh] w-[min(96vw,64rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl p-0"
      >
        {/* Header. */}
        <div className="flex items-center justify-between gap-3 border-b border-line p-4">
          <div className="min-w-0">
            <DialogTitle className="text-sm">Notebook review — {fileName}</DialogTitle>
            <DialogDescription className="text-xs text-ink-3">
              Read-only preview of the training notebook (rendered with notebook-viewer-ts).
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setAll(!collapsedAll)}
              className="rounded-lg border border-line bg-surface-3 px-3 py-1.5 text-xs font-medium text-ink-1 transition-colors hover:bg-surface-4"
            >
              {collapsedAll ? 'Expand all' : 'Collapse all'}
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close notebook review"
              className="rounded-lg border border-line bg-surface-3 px-3 py-1.5 text-xs text-ink-2 transition-colors hover:bg-surface-4"
            >
              Close
            </button>
          </div>
        </div>

        {/* Body. */}
        <div
          ref={containerRef}
          onClick={handleClick}
          className={cn(
            'notebook-review min-h-0 flex-1 overflow-y-auto p-5',
            !html && !error && 'flex items-center justify-center text-sm text-ink-3',
          )}
        >
          {error ? (
            <p className="text-sm text-danger">{error}</p>
          ) : html ? (
            <div dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <span>Loading notebook…</span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}