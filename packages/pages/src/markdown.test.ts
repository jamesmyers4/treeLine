import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { extractTitle, renderMarkdownFragment } from './markdown.js'

const fixturesDir = path.join(import.meta.dirname, '..', 'test', 'fixtures', 'sample-output', 'reports')

function readFixture(name: string): string {
  return readFileSync(path.join(fixturesDir, name), 'utf-8')
}

describe('extractTitle', () => {
  it('pulls the first level-1 heading from a real report', () => {
    expect(extractTitle(readFixture('atlas.md'), 'fallback')).toBe('Site Atlas')
    expect(extractTitle(readFixture('axe-report.md'), 'fallback')).toBe('Accessibility Report (axe-core)')
  })

  it('falls back when no heading is present', () => {
    expect(extractTitle('no heading here', 'fallback.md')).toBe('fallback.md')
  })
})

describe('renderMarkdownFragment', () => {
  it('renders a real selector-report table as an HTML table', () => {
    const html = renderMarkdownFragment(readFixture('selector-report.md'))
    expect(html).toContain('<table>')
    expect(html).toContain('<th>Strategy</th>')
    expect(html).toContain('role=link[name=&quot;Learn more&quot;]')
  })

  it('renders a real diff report image reference as an <img> tag', () => {
    const html = renderMarkdownFragment(readFixture('diff-report.md'))
    expect(html).toContain('<img src="visual-diffs/b559c7edd3fb.png"')
  })

  it('renders headings from a real axe report', () => {
    const html = renderMarkdownFragment(readFixture('axe-report.md'))
    expect(html).toContain('<h1>Accessibility Report (axe-core)</h1>')
    expect(html).toContain('<h3>Violations</h3>')
  })
})
