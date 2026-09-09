import type { AxeIncompleteResult, AxeViolation } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import type { AxeFindingSummary, AxeReport, PageAxeReport } from './types.js'
import { sanitizeMarkdownTableCell, sanitizeMarkdownText } from './markdown-safety.js'

const MAX_EXAMPLE_SELECTORS_PER_FINDING = 5

function toSummary(finding: AxeViolation | AxeIncompleteResult): AxeFindingSummary {
  return {
    id: finding.id,
    impact: finding.impact,
    help: finding.help,
    helpUrl: finding.helpUrl,
    affectedElementCount: finding.nodes.length,
    exampleSelectors: finding.nodes.slice(0, MAX_EXAMPLE_SELECTORS_PER_FINDING).map((node) => node.target.join(' ')),
  }
}

function buildPageReport(page: CrawledPage): PageAxeReport {
  return {
    url: page.url,
    violations: page.axeViolations.map(toSummary),
    needsReview: page.axeIncomplete.map(toSummary),
  }
}

export function generateAxeReport(pages: CrawledPage[]): AxeReport {
  const capturedPages = pages.filter((p) => p.title !== null && p.ariaSnapshot !== null && p.capturedAt !== null)
  const pageReports = capturedPages.map(buildPageReport)
  const totalViolations = pageReports.reduce((sum, page) => sum + page.violations.length, 0)
  const totalNeedsReview = pageReports.reduce((sum, page) => sum + page.needsReview.length, 0)
  return { generatedAt: new Date().toISOString(), pages: pageReports, totalViolations, totalNeedsReview }
}

function renderExampleSelectors(finding: AxeFindingSummary): string {
  const joined = finding.exampleSelectors.join('; ')
  const remaining = finding.affectedElementCount - finding.exampleSelectors.length
  return remaining > 0 ? `${joined} (+${remaining} more)` : joined
}

function renderFindingsTable(findings: AxeFindingSummary[], emptyMessage: string): string[] {
  if (findings.length === 0) return [emptyMessage, '']
  const lines: string[] = ['| Rule | Impact | Affected Elements | Example Selectors | Help |', '| --- | --- | --- | --- | --- |']
  for (const finding of findings) {
    lines.push(`| ${finding.id} | ${finding.impact ?? '—'} | ${finding.affectedElementCount} | ${sanitizeMarkdownTableCell(renderExampleSelectors(finding))} | ${finding.help} |`)
  }
  lines.push('')
  return lines
}

function renderPageSection(page: PageAxeReport): string[] {
  const lines: string[] = [`## ${sanitizeMarkdownText(page.url)}`, '', '### Violations', '']
  lines.push(...renderFindingsTable(page.violations, 'No violations found.'))
  lines.push('### Needs Manual Review', '')
  lines.push(...renderFindingsTable(page.needsReview, 'Nothing flagged for manual review.'))
  return lines
}

export function renderAxeReportMarkdown(report: AxeReport): string {
  const lines: string[] = [
    '# Accessibility Report (axe-core)',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `${report.totalViolations} violations, ${report.totalNeedsReview} items need manual review across ${report.pages.length} pages`,
    '',
    '| URL | Violations | Needs Review |',
    '| --- | --- | --- |',
  ]
  for (const page of report.pages) {
    lines.push(`| ${sanitizeMarkdownTableCell(page.url)} | ${page.violations.length} | ${page.needsReview.length} |`)
  }
  lines.push('')
  for (const page of report.pages) {
    lines.push(...renderPageSection(page))
  }
  return lines.join('\n')
}
