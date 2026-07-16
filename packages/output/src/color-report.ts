import type { CrawledPage } from './input.js'
import type { AggregatedColorEntry, ColorReport, PageColorEntry } from './types.js'
import { sanitizeMarkdownTableCell } from './markdown-safety.js'

const PER_PAGE_TOP_N = 10
const SITE_WIDE_TOP_N = 15

export function generateColorReport(pages: CrawledPage[]): ColorReport {
  const capturedPages = pages.filter((p) => p.title !== null && p.ariaSnapshot !== null && p.capturedAt !== null)

  const pageEntries: PageColorEntry[] = capturedPages
    .filter((p) => p.colorPalette.length > 0)
    .map((p) => ({ url: p.url, swatches: p.colorPalette.slice(0, PER_PAGE_TOP_N) }))

  const aggregated = new Map<string, { hex: string; property: 'color' | 'background-color'; totalUsageCount: number; pages: Set<string> }>()
  for (const page of capturedPages) {
    for (const swatch of page.colorPalette) {
      const key = `${swatch.property}:${swatch.hex}`
      const existing = aggregated.get(key)
      if (existing) {
        existing.totalUsageCount += swatch.usageCount
        existing.pages.add(page.url)
      } else {
        aggregated.set(key, { hex: swatch.hex, property: swatch.property, totalUsageCount: swatch.usageCount, pages: new Set([page.url]) })
      }
    }
  }
  const siteWideScheme: AggregatedColorEntry[] = Array.from(aggregated.values())
    .map((entry) => ({ hex: entry.hex, property: entry.property, totalUsageCount: entry.totalUsageCount, pageCount: entry.pages.size }))
    .sort((a, b) => b.totalUsageCount - a.totalUsageCount)
    .slice(0, SITE_WIDE_TOP_N)

  return {
    generatedAt: new Date().toISOString(),
    pages: pageEntries,
    siteWideScheme,
  }
}

function renderSiteWideSection(report: ColorReport): string[] {
  const lines: string[] = [
    '## Site-wide color scheme',
    '',
    `The ${SITE_WIDE_TOP_N} most-used colors across all captured pages, ranked by total usage count.`,
    '',
  ]
  if (report.siteWideScheme.length === 0) {
    lines.push('No colors were captured across any page.', '')
    return lines
  }
  lines.push('| Hex | Property | Total Usage | Pages Seen On |', '| --- | --- | --- | --- |')
  for (const entry of report.siteWideScheme) {
    lines.push(`| ${entry.hex} | ${entry.property} | ${entry.totalUsageCount} | ${entry.pageCount} |`)
  }
  lines.push('')
  return lines
}

function renderPerPageSection(report: ColorReport): string[] {
  const lines: string[] = ['## Per-page colors', '', `Top ${PER_PAGE_TOP_N} colors on each page, ranked by usage count on that page.`, '']
  if (report.pages.length === 0) {
    lines.push('No page had any captured colors.', '')
    return lines
  }
  for (const page of report.pages) {
    lines.push(`### ${sanitizeMarkdownTableCell(page.url)}`, '', '| Hex | Property | Usage Count | Example Selector |', '| --- | --- | --- | --- |')
    for (const swatch of page.swatches) {
      lines.push(`| ${swatch.hex} | ${swatch.property} | ${swatch.usageCount} | ${sanitizeMarkdownTableCell(swatch.exampleSelector)} |`)
    }
    lines.push('')
  }
  return lines
}

export function renderColorReportMarkdown(report: ColorReport): string {
  const lines: string[] = [
    '# Color Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `${report.pages.length} pages with captured colors, ${report.siteWideScheme.length} distinct colors in the site-wide scheme.`,
    '',
  ]
  lines.push(...renderSiteWideSection(report))
  lines.push(...renderPerPageSection(report))
  return lines.join('\n')
}
