import type { StoredInterpretation } from '@treeline/core'
import type { CrawledPage } from './input.js'
import type { PageAtlasEntry, SiteAtlas } from './types.js'
import { sanitizeMarkdownTableCell, sanitizeMarkdownText } from './markdown-safety.js'

function buildEntry(page: CrawledPage, interpretation: StoredInterpretation | undefined): PageAtlasEntry {
  const testIdCount = page.interactiveElements.filter((el) => el.testId !== null).length
  if (interpretation) {
    return {
      url: page.url,
      title: page.title!,
      pageType: interpretation.pageType,
      purpose: interpretation.purpose,
      keyDataEntities: interpretation.keyDataEntities,
      confidence: interpretation.confidence,
      interactiveElementCount: page.interactiveElements.length,
      testIdCount,
      interpreted: true,
    }
  }
  return {
    url: page.url,
    title: page.title!,
    pageType: null,
    purpose: null,
    keyDataEntities: [],
    confidence: null,
    interactiveElementCount: page.interactiveElements.length,
    testIdCount,
    interpreted: false,
  }
}

export function generateAtlas(pages: CrawledPage[], interpretations: StoredInterpretation[]): SiteAtlas {
  const capturedPages = pages.filter((p) => p.title !== null && p.ariaSnapshot !== null && p.capturedAt !== null)
  const interpretationsByUrl = new Map(interpretations.map((interpretation) => [interpretation.url, interpretation]))
  const entries = capturedPages.map((page) => buildEntry(page, interpretationsByUrl.get(page.url)))
  const totalPagesCaptured = entries.length
  const totalPagesInterpreted = entries.filter((entry) => entry.interpreted).length
  return { generatedAt: new Date().toISOString(), pages: entries, totalPagesCaptured, totalPagesInterpreted }
}

function formatConfidence(confidence: number | null): string {
  if (confidence === null) return '—'
  return `${Math.round(confidence * 100)}%`
}

function renderPageSection(entry: PageAtlasEntry): string[] {
  const heading = entry.title !== '' ? entry.title : entry.url
  const lines: string[] = [`## ${sanitizeMarkdownText(heading)}`, '', sanitizeMarkdownText(entry.url), '']
  if (!entry.interpreted) {
    lines.push('This page has not yet been interpreted. Check hard-pages/ for details.', '')
    return lines
  }
  lines.push(
    `Page type: ${sanitizeMarkdownText(entry.pageType!)}`,
    '',
    '### Purpose',
    '',
    sanitizeMarkdownText(entry.purpose!),
    '',
    '### Key data entities',
    '',
  )
  for (const entity of entry.keyDataEntities) {
    lines.push(`- ${sanitizeMarkdownText(entity)}`)
  }
  lines.push('')
  return lines
}

export function renderAtlasMarkdown(atlas: SiteAtlas): string {
  const lines: string[] = [
    '# Site Atlas',
    '',
    `Generated: ${atlas.generatedAt}`,
    '',
    `${atlas.totalPagesCaptured} pages captured, ${atlas.totalPagesInterpreted} interpreted`,
    '',
    '| URL | Page Type | Confidence | Interpreted | Interactive Elements | Test IDs |',
    '| --- | --- | --- | --- | --- | --- |',
  ]
  for (const entry of atlas.pages) {
    const pageType = entry.pageType !== null ? sanitizeMarkdownTableCell(entry.pageType) : '—'
    lines.push(
      `| ${sanitizeMarkdownTableCell(entry.url)} | ${pageType} | ${formatConfidence(entry.confidence)} | ${entry.interpreted ? 'Yes' : 'No'} | ${entry.interactiveElementCount} | ${entry.testIdCount} |`,
    )
  }
  lines.push('')
  for (const entry of atlas.pages) {
    lines.push(...renderPageSection(entry))
  }
  return lines.join('\n')
}
