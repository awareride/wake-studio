/**
 * L1 tests — notebook markdown renderer (issue #105).
 *
 * The renderer escapes input first (no HTML injection) and supports the
 * markdown subset the module-owned notebooks use.
 */

import { describe, it, expect } from 'vitest'
import { escapeHtml, renderMarkdown, markdownHeadings } from '../markdown'

describe('escapeHtml', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    )
  })
})

describe('renderMarkdown', () => {
  it('renders ATX headings', () => {
    expect(renderMarkdown('# Title')).toBe('<h1>Title</h1>')
    expect(renderMarkdown('### Sub')).toBe('<h3>Sub</h3>')
  })

  it('renders bold, italic, inline code and links', () => {
    const out = renderMarkdown('a **bold** *em* `code` [link](https://example.com)')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<em>em</em>')
    expect(out).toContain('<code>code</code>')
    expect(out).toContain('<a href="https://example.com" target="_blank" rel="noreferrer">link</a>')
  })

  it('does not style ** inside inline code', () => {
    const out = renderMarkdown('`a **b** c`')
    expect(out).toContain('<code>a **b** c</code>')
    expect(out).not.toContain('<strong>')
  })

  it('renders fenced code blocks escaped', () => {
    const out = renderMarkdown('```python\nprint("<x>")\n```')
    expect(out).toContain('<pre><code>print(&quot;&lt;x&gt;&quot;)</code></pre>')
  })

  it('renders bullet and numbered lists', () => {
    expect(renderMarkdown('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>')
    expect(renderMarkdown('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>')
  })

  it('renders blockquotes and horizontal rules', () => {
    expect(renderMarkdown('> note')).toBe('<blockquote>note</blockquote>')
    expect(renderMarkdown('---')).toBe('<hr/>')
  })

  it('groups plain lines into paragraphs', () => {
    expect(renderMarkdown('line one\nline two')).toBe('<p>line one line two</p>')
  })

  it('never emits raw HTML from the source', () => {
    const out = renderMarkdown('# Hi <img src=x onerror=alert(1)>')
    expect(out).not.toContain('<img')
  })
})

describe('markdownHeadings', () => {
  it('extracts an outline from markdown cells', () => {
    expect(markdownHeadings('# A\nb\n## C\n# D')).toEqual([
      { level: 1, text: 'A' },
      { level: 2, text: 'C' },
      { level: 1, text: 'D' },
    ])
  })
})