/**
 * Notebook review dialog — full/big review of a .ipynb (issue #105).
 *
 * Uses `notebook-viewer-ts` (NotebookTs) to render the notebook: real
 * markdown (micromark), code highlighting (highlight.js), cell outputs and
 * folding. The library is lazy-loaded (dynamic import) so highlight.js /
 * micromark / katex stay out of the main bundle.
 *
 * The library's HTML is post-processed to give every cell its own
 * Collapse/Expand toggle, plus global Collapse-all / Expand-all buttons in
 * the dialog header. The notebook is fetched from the app's own origin.
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

/** Add a Collapse/Expand toggle to every cell the library rendered. */
function addPerCellToggles(html: string): string {
  let index = 0
  return html.replace(/<div class="cell ([^"]*)">/g, (_m, cls: string) => {
    const id = `cell-${index++}`
    const toggle =
      `<button type="button" class="nb-cell-toggle" data-toggle="#${id}" ` +
      `aria-label="Collapse or expand cell">&minus;</button>`
    return `<div class="cell ${cls}" data-cell-id="${id}">${toggle}`
  })
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
        const json = (await res.json()) as unknown
        const { Notebook } = await import('notebook-viewer-ts')
        const nb = new Notebook(json as string | object)
        if (!alive) return
        setHtml(addPerCellToggles(nb.render('tailwind')))
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [open, rawUrl])

  const toggleCell = useCallback((targetId: string, button: HTMLElement) => {
    const content = containerRef.current?.querySelector<HTMLElement>(targetId)
    if (!content) return
    const hidden = content.classList.toggle('hidden')
    const glyph = button.querySelector('span')
    if (glyph) glyph.textContent = hidden ? '▸' : '▾'
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
  const setAll = useCallback(
    (collapsed: boolean) => {
      setCollapsedAll(collapsed)
      containerRef.current
        ?.querySelectorAll<HTMLElement>('.cell > div[id^="cell-"]')
        .forEach((el) => el.classList.toggle('hidden', collapsed))
      containerRef.current
        ?.querySelectorAll<HTMLElement>('.nb-cell-toggle span')
        .forEach((s) => (s.textContent = collapsed ? '▸' : '▾'))
    },
    [],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        centered={false}
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