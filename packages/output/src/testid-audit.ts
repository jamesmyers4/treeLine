import type { CrawledPage } from './input.js'
import type { PageTestIdCoverage, TestIdAuditReport, TestIdGapEntry } from './types.js'
import { sanitizeMarkdownTableCell, sanitizeMarkdownText } from './markdown-safety.js'

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function buildPageCoverage(page: CrawledPage): PageTestIdCoverage {
  const totalInteractive = page.interactiveElements.length
  const withTestId = page.interactiveElements.filter((el) => el.testId !== null).length
  const coveragePercent = totalInteractive === 0 ? 0 : round1((withTestId / totalInteractive) * 100)
  const gaps: TestIdGapEntry[] = page.interactiveElements
    .filter((el) => el.testId === null)
    .map((el) => ({ url: page.url, role: el.role, accessibleName: el.accessibleName }))
  return { url: page.url, totalInteractive, withTestId, coveragePercent, gaps }
}

export function generateTestIdAudit(pages: CrawledPage[]): TestIdAuditReport {
  const pageCoverages = pages.map(buildPageCoverage)
  const totalInteractive = pageCoverages.reduce((sum, page) => sum + page.totalInteractive, 0)
  const totalWithTestId = pageCoverages.reduce((sum, page) => sum + page.withTestId, 0)
  const overallCoveragePercent = totalInteractive === 0 ? 0 : round1((totalWithTestId / totalInteractive) * 100)
  return { generatedAt: new Date().toISOString(), pages: pageCoverages, overallCoveragePercent }
}

export function renderTestIdAuditMarkdown(report: TestIdAuditReport): string {
  const lines: string[] = [
    '# data-testid Coverage Audit',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Overall coverage: ${report.overallCoveragePercent}%`,
    '',
    '| URL | Coverage % | Missing Count |',
    '| --- | --- | --- |',
  ]
  for (const page of report.pages) {
    lines.push(`| ${sanitizeMarkdownTableCell(page.url)} | ${page.coveragePercent}% | ${page.gaps.length} |`)
  }
  lines.push('')
  for (const page of report.pages) {
    if (page.gaps.length === 0) continue
    lines.push(`## Gaps: ${sanitizeMarkdownText(page.url)}`, '')
    for (const gap of page.gaps) {
      lines.push(`- ${sanitizeMarkdownText(gap.role)} '${sanitizeMarkdownText(gap.accessibleName)}'`)
    }
    lines.push('')
  }
  return lines.join('\n')
}
