import type { AssertableAttribute } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import type { AssertableDataReport, AssertableDataRow, PageAssertableDataEntry } from './types.js'
import { sanitizeMarkdownTableCell } from './markdown-safety.js'

function buildSuggestedLocator(attr: AssertableAttribute): string {
  if (attr.role.trim() !== '' && attr.accessibleName.trim() !== '') {
    return `page.getByRole(${JSON.stringify(attr.role)}, { name: ${JSON.stringify(attr.accessibleName)} })`
  }
  if (attr.testId) return `page.getByTestId(${JSON.stringify(attr.testId)})`
  return `page.locator(${JSON.stringify(attr.cssPath)})`
}

export function generateAssertableDataReport(pages: CrawledPage[]): AssertableDataReport {
  const capturedPages = pages.filter((p) => p.title !== null && p.ariaSnapshot !== null && p.capturedAt !== null)
  const pageEntries: PageAssertableDataEntry[] = capturedPages
    .filter((p) => p.assertableAttributes.length > 0)
    .map((p) => {
      const rows: AssertableDataRow[] = p.assertableAttributes.map((attr) => ({
        attributeName: attr.attributeName,
        value: attr.value,
        elementDescription: attr.accessibleName.trim() !== '' ? attr.accessibleName : `<${attr.tagName}>`,
        suggestedLocator: buildSuggestedLocator(attr),
      }))
      return { url: p.url, rows }
    })
  return {
    generatedAt: new Date().toISOString(),
    pages: pageEntries,
  }
}

export function renderAssertableDataReportMarkdown(report: AssertableDataReport): string {
  const lines: string[] = [
    '# Assertable Data Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'Elements carrying machine-readable values (`title`, `datetime`, `data-*` attributes) that a test can assert on directly — e.g. an exact ISO timestamp in a `title` attribute, rather than a relative "3 minutes ago" string.',
    '',
    `${report.pages.length} pages with at least one assertable attribute.`,
    '',
  ]
  if (report.pages.length === 0) {
    lines.push('No page had any captured assertable attributes.', '')
    return lines.join('\n')
  }
  for (const page of report.pages) {
    lines.push(
      `## ${sanitizeMarkdownTableCell(page.url)}`,
      '',
      '| Element | Attribute | Value | Suggested Locator |',
      '| --- | --- | --- | --- |',
    )
    for (const row of page.rows) {
      lines.push(
        `| ${sanitizeMarkdownTableCell(row.elementDescription)} | ${sanitizeMarkdownTableCell(row.attributeName)} | ${sanitizeMarkdownTableCell(row.value)} | \`${sanitizeMarkdownTableCell(row.suggestedLocator)}\` |`,
      )
    }
    lines.push('')
  }
  return lines.join('\n')
}
