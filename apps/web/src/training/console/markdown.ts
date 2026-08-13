/**
 * Mini safe markdown renderer for the notebook reviewer (issue #105).
 *
 * Renders the subset of markdown the module-owned notebooks use: ATX
 * headings, bold/italic, inline code, fenced code blocks, bullet/numbered
 * lists, blockquotes, horizontal rules, paragraphs, and links. Input is
 * HTML-escaped FIRST, so only tags this renderer itself emits can appear in
 * the output (no raw HTML injection). Pure + unit-testable.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Inline styles: `code`, **bold**, *italic*, [text](url). Applied after escape. */
function inline(text: string): string {
  // Protect inline code with placeholders so ** inside it is never styled.
  // Private-use char (not a control char — passes no-control-regex).
  const codeSpans: string[] = []
  const protectedText = text.replace(/`([^`]+)`/g, (_m, c: string) => {
    codeSpans.push(`<code>${c}</code>`)
    return `\uE000${codeSpans.length - 1}\uE000`
  })
  const styled = protectedText
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
  return styled.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => codeSpans[Number(i)] ?? '')
}

function isFence(line: string): boolean {
  return /^\s*```/.test(line)
}

/**
 * Render markdown source to a safe HTML fragment. Block-level: fenced code,
 * headings, lists, blockquotes, hr, blank-line paragraphs.
 */
export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (isFence(line)) {
      // Fenced code block.
      const buf: string[] = []
      i++
      while (i < lines.length && !isFence(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++ // closing fence
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      out.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`)
      i++
      continue
    }

    if (/^\s*[-*_]{3,}\s*$/.test(line.trim())) {
      out.push('<hr/>')
      i++
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${inline(escapeHtml(buf.join(' ')))}</blockquote>`)
      continue
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(inline(escapeHtml(lines[i].replace(/^\s*[-*]\s+/, ''))))
        i++
      }
      out.push(`<ul>${items.map((it) => `<li>${it}</li>`).join('')}</ul>`)
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(inline(escapeHtml(lines[i].replace(/^\s*\d+\.\s+/, ''))))
        i++
      }
      out.push(`<ol>${items.map((it) => `<li>${it}</li>`).join('')}</ol>`)
      continue
    }

    if (line.trim() === '') {
      i++
      continue
    }

    // Paragraph: consume until a blank line or a block start.
    const buf: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !isFence(lines[i]) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      buf.push(lines[i])
      i++
    }
    out.push(`<p>${inline(escapeHtml(buf.join(' ')))}</p>`)
  }

  return out.join('\n')
}

/** Extract a chapter outline (markdown headings) for notebook navigation. */
export function markdownHeadings(src: string): Array<{ level: number; text: string }> {
  const out: Array<{ level: number; text: string }> = []
  for (const line of src.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line)
    if (m) out.push({ level: m[1].length, text: m[2] })
  }
  return out
}