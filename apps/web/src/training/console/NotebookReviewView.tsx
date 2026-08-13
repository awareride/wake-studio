/**
 * Notebook review — full panel of the training view (issue #105).
 *
 * Replaces the dialog: the Review button switches the current panel
 * (wizard Ready step or train details) to this full-panel review with a
 * Back button. Rendered with `notebook-viewer-ts` (NotebookTs: markdown,
 * highlight.js, outputs, folding), lazy-loaded. Every cell gets a −/+ toggle
 * (title shown while collapsed), plus global Collapse-all / Expand-all.
 *
 * When `personalize` is provided (the user's configured params), the
 * notebook is generated from the template with the params baked in — the
 * review shows exactly what will be downloaded and run.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { personalizeNotebook, type EnvParam } from '@wake-studio/module-training'
import { cn } from '../../components/cn'
import { IconChevronLeft } from '../../components/icons'
import './notebook-review.css'

export interface NotebookReviewViewProps {
  fileName: string
  rawUrl: string
  /** Back to the previous panel (wizard step / train details). */
  onBack: () => void
  /** User-configured params to bake into the rendered notebook. */
  personalize?: {
    params: readonly EnvParam[]
    values: Record<string, string>
  }
}

interface RawCell {
  cell_type?: 'markdown' | 'code' | 'raw'
  id?: string
  source?: string[] | string
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

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

/** Add a −/+ toggle + collapsed-title to every cell the library rendered. */
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

export function NotebookReviewView({
  fileName,
  rawUrl,
  onBack,
  personalize,
}: NotebookReviewViewProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [collapsedAll, setCollapsedAll] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
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
        const rendered = personalize
          ? personalizeNotebook(json, personalize.params, personalize.values)
          : json
        const nb = new Notebook(rendered as string | object)
        if (!alive) return
        const titles = (rendered.cells ?? []).map((c) => cellTitle(c as RawCell))
        setHtml(addPerCellToggles(nb.render('tailwind'), titles))
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [rawUrl, personalize])

  const toggleCell = useCallback((targetId: string, button: HTMLElement) => {
    const content = containerRef.current?.querySelector<HTMLElement>(targetId)
    if (!content) return
    const hidden = content.classList.toggle('hidden')
    button.closest('.cell')?.classList.toggle('collapsed', hidden)
    const glyph = button.querySelector('.nb-glyph')
    if (glyph) glyph.textContent = hidden ? '+' : '−'
  }, [])

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-toggle]')
      if (!btn) return
      const selector = btn.getAttribute('data-toggle')
      if (selector?.startsWith('#')) toggleCell(selector, btn)
    },
    [toggleCell],
  )

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

  const bakedIn = useMemo(
    () =>
      personalize
        ? personalize.params
            .filter(
              (p) =>
                p.env && personalize.values[p.id] !== undefined && personalize.values[p.id] !== null,
            )
            .map((p) => p.id)
        : [],
    [personalize],
  )

  return (
    <div className="space-y-4">
      {/* Panel header. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-3"
          >
            <IconChevronLeft className="h-3.5 w-3.5" /> Back
          </button>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-ink-1">Notebook review — {fileName}</h3>
            {bakedIn.length > 0 && (
              <p className="truncate text-[11px] text-ink-3">
                Your params are baked in: {bakedIn.join(', ')}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setAll(!collapsedAll)}
            className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-surface-3"
          >
            {collapsedAll ? 'Expand all' : 'Collapse all'}
          </button>
        </div>
      </div>

      {/* Scrollable notebook. */}
      <div
        ref={containerRef}
        onClick={handleClick}
        className={cn(
          'notebook-review max-h-[calc(100dvh-14rem)] min-h-[24rem] overflow-y-auto rounded-xl border border-line bg-surface-2 p-5',
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
    </div>
  )
}