import type { HardPageEntry } from '@treeline/core'
import type { CrawledPage } from './input.js'
import type { CoverageReport, FormTestGap, PageCoverageEntry, SkippedElement } from './types.js'
import { sanitizeMarkdownTableCell, sanitizeMarkdownText } from './markdown-safety.js'

const HIGH_SKIP_THRESHOLD_PERCENT = 50

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function buildPageCoverageEntries(capturedPages: CrawledPage[], skipped: SkippedElement[]): PageCoverageEntry[] {
  const skippedCountByUrl = new Map<string, number>()
  for (const entry of skipped) {
    skippedCountByUrl.set(entry.url, (skippedCountByUrl.get(entry.url) ?? 0) + 1)
  }
  return capturedPages
    .filter((page) => page.interactiveElements.length > 0)
    .map((page) => {
      const totalInteractive = page.interactiveElements.length
      const skippedCount = skippedCountByUrl.get(page.url) ?? 0
      return { url: page.url, totalInteractive, skippedCount, skipPercent: round1((skippedCount / totalInteractive) * 100) }
    })
}

function buildFormsWithoutTest(capturedPages: CrawledPage[]): FormTestGap[] {
  const gaps: FormTestGap[] = []
  for (const page of capturedPages) {
    for (const form of page.forms) {
      gaps.push({ url: page.url, formIndex: form.formIndex, action: form.action, method: form.method, fieldCount: form.fields.length })
    }
  }
  return gaps
}

export function generateCoverageReport(pages: CrawledPage[], skipped: SkippedElement[], hardPageEntries: HardPageEntry[]): CoverageReport {
  const capturedPages = pages.filter((p) => p.title !== null && p.ariaSnapshot !== null && p.capturedAt !== null)
  const pagesExcludedFromCoverage = pages.filter((p) => !capturedPages.includes(p)).map((p) => p.url)
  const pageCoverageEntries = buildPageCoverageEntries(capturedPages, skipped)
  const zeroCoveragePages = pageCoverageEntries.filter((entry) => entry.skippedCount === entry.totalInteractive)
  const highSkipPages = pageCoverageEntries.filter(
    (entry) => entry.skippedCount !== entry.totalInteractive && entry.skipPercent > HIGH_SKIP_THRESHOLD_PERCENT,
  )
  const formsWithoutTest = buildFormsWithoutTest(capturedPages)
  return {
    generatedAt: new Date().toISOString(),
    zeroCoveragePages,
    highSkipPages,
    formsWithoutTest,
    unresolvedHardPages: hardPageEntries,
    pagesExcludedFromCoverage,
  }
}

function renderPageCoverageTable(entries: PageCoverageEntry[]): string[] {
  if (entries.length === 0) return ['None found.', '']
  const lines: string[] = ['| URL | Interactive Elements | Skipped | Skip % |', '| --- | --- | --- | --- |']
  for (const entry of entries) {
    lines.push(`| ${sanitizeMarkdownTableCell(entry.url)} | ${entry.totalInteractive} | ${entry.skippedCount} | ${entry.skipPercent}% |`)
  }
  lines.push('')
  return lines
}

function renderFormsWithoutTestSection(gaps: FormTestGap[]): string[] {
  const lines: string[] = [
    '## Forms without a corresponding test',
    '',
    "Generated specs are page-level skeletons — a single `toHaveURL` assertion after `goto()` — and never reference " +
      'individual form fields (see `pom-generation.ts`\'s `generateSpec`). Every form found during the crawl therefore ' +
      'has no field-level test coverage today; this is a known gap, not a per-form defect. See V2.md item 5 ' +
      '("AI-proposed test assertions") for planned work to close it.',
    '',
  ]
  if (gaps.length === 0) {
    lines.push('No forms were found.', '')
    return lines
  }
  lines.push('| URL | Form # | Action | Method | Fields |', '| --- | --- | --- | --- | --- |')
  for (const gap of gaps) {
    const action = gap.action ? sanitizeMarkdownTableCell(gap.action) : '(none)'
    lines.push(`| ${sanitizeMarkdownTableCell(gap.url)} | ${gap.formIndex} | ${action} | ${sanitizeMarkdownTableCell(gap.method.toUpperCase())} | ${gap.fieldCount} |`)
  }
  lines.push('')
  return lines
}

function renderHardPagesSection(entries: HardPageEntry[]): string[] {
  const lines: string[] = ['## Unresolved hard-pages entries', '']
  if (entries.length === 0) {
    lines.push('No unresolved hard-pages entries.', '')
    return lines
  }
  lines.push('| URL | Reason | Attempted At |', '| --- | --- | --- |')
  for (const entry of entries) {
    lines.push(`| ${sanitizeMarkdownTableCell(entry.url)} | ${entry.reasonCode} | ${entry.attemptedAt} |`)
  }
  lines.push('')
  return lines
}

export function renderCoverageReportMarkdown(report: CoverageReport): string {
  const lines: string[] = [
    '# Coverage Gap Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `${report.zeroCoveragePages.length} pages with zero POM coverage, ${report.highSkipPages.length} pages with high skip rates, ` +
      `${report.formsWithoutTest.length} forms without field-level test coverage, ${report.unresolvedHardPages.length} unresolved hard-pages entries`,
    '',
  ]
  if (report.pagesExcludedFromCoverage.length > 0) {
    lines.push(
      `Note: ${report.pagesExcludedFromCoverage.length} page(s) never completed capture and are excluded from the ` +
        'coverage metrics below (their interactive-element counts are unknown, not zero) — see the hard-pages section:',
      '',
    )
    for (const url of report.pagesExcludedFromCoverage) lines.push(`- ${sanitizeMarkdownText(url)}`)
    lines.push('')
  }
  lines.push('## Zero-coverage pages', '', 'Every interactive element on these pages was skipped — no POM locators were generated at all.', '')
  lines.push(...renderPageCoverageTable(report.zeroCoveragePages))
  lines.push('## High-skip pages', '', `More than ${HIGH_SKIP_THRESHOLD_PERCENT}% of interactive elements were skipped (excludes zero-coverage pages, listed above).`, '')
  lines.push(...renderPageCoverageTable(report.highSkipPages))
  lines.push(...renderFormsWithoutTestSection(report.formsWithoutTest))
  lines.push(...renderHardPagesSection(report.unresolvedHardPages))
  return lines.join('\n')
}
