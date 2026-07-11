import type { CrawledPage } from './input.js'
import type { LateAppearingElementEntry, SlowNetworkRequestEntry, SlowPageEntry, TimingReport } from './types.js'
import { sanitizeMarkdownTableCell } from './markdown-safety.js'

// Real crawls across three site profiles for this session — a minimal static
// page (example.com, pageLoadMs 725), a real content-heavy site
// (playwright.dev, pageLoadMs 909-1071 across 6 pages) and a deliberately
// slow local fixture (3599-4027ms) — showed genuine page loads topping out
// at ~1071ms and deliberately slow loads starting at 3599ms. 2500ms sits
// well above the observed normal ceiling and well below the observed slow
// floor.
const SLOW_PAGE_THRESHOLD_MS = 2500

// The same three-profile crawl set showed normal network requests
// (including real image downloads on playwright.dev) topping out at 399ms,
// while a deliberately-delayed local request came back at 712ms. 500ms sits
// above the observed normal ceiling and below the observed slow floor.
const SLOW_REQUEST_THRESHOLD_MS = 500

// The crawler doesn't click or scroll (no Phase 2 interaction-reachable
// discovery yet), so appearedAtMs is only ever non-null for elements a page
// inserts on its own after initial load — both real sites crawled for this
// session had zero such elements, leaving only one real sample (713ms, a
// deliberately-delayed local fixture element), which isn't enough to derive
// a normal-vs-slow split empirically. This threshold is anchored instead to
// Playwright's documented default `expect()` timeout (5000ms) — the real
// budget this signal threatens — at half that value. Revisit once real SPA
// crawls accumulate enough naturally-occurring appearedAtMs samples to check
// this empirically.
const LATE_APPEARANCE_THRESHOLD_MS = 2500

const TOP_N = 5

export function generateTimingReport(pages: CrawledPage[]): TimingReport {
  const capturedPages = pages.filter((p) => p.title !== null && p.ariaSnapshot !== null && p.capturedAt !== null)

  const pageEntries: SlowPageEntry[] = capturedPages
    .filter((p) => p.pageLoadMs !== null)
    .map((p) => ({ url: p.url, pageLoadMs: p.pageLoadMs as number, overThreshold: (p.pageLoadMs as number) > SLOW_PAGE_THRESHOLD_MS }))
    .sort((a, b) => b.pageLoadMs - a.pageLoadMs)

  const requestEntries: SlowNetworkRequestEntry[] = capturedPages
    .flatMap((p) =>
      p.networkLog.map((entry) => ({
        pageUrl: p.url,
        requestUrl: entry.url,
        method: entry.method,
        durationMs: entry.durationMs,
        overThreshold: entry.durationMs > SLOW_REQUEST_THRESHOLD_MS,
      })),
    )
    .sort((a, b) => b.durationMs - a.durationMs)

  const elementEntries: LateAppearingElementEntry[] = capturedPages
    .flatMap((p) =>
      p.interactiveElements
        .filter((el) => el.appearedAtMs !== null)
        .map((el) => ({
          pageUrl: p.url,
          role: el.role,
          accessibleName: el.accessibleName,
          appearedAtMs: el.appearedAtMs as number,
          overThreshold: (el.appearedAtMs as number) > LATE_APPEARANCE_THRESHOLD_MS,
        })),
    )
    .sort((a, b) => b.appearedAtMs - a.appearedAtMs)

  return {
    generatedAt: new Date().toISOString(),
    pagesAnalyzed: capturedPages.length,
    pageLoadThresholdMs: SLOW_PAGE_THRESHOLD_MS,
    networkRequestThresholdMs: SLOW_REQUEST_THRESHOLD_MS,
    appearanceThresholdMs: LATE_APPEARANCE_THRESHOLD_MS,
    flaggedPageCount: pageEntries.filter((e) => e.overThreshold).length,
    flaggedNetworkRequestCount: requestEntries.filter((e) => e.overThreshold).length,
    flaggedElementCount: elementEntries.filter((e) => e.overThreshold).length,
    slowestPages: pageEntries.slice(0, TOP_N),
    slowestNetworkRequests: requestEntries.slice(0, TOP_N),
    slowestAppearingElements: elementEntries.slice(0, TOP_N),
  }
}

function renderSlowPagesSection(report: TimingReport): string[] {
  const lines: string[] = [
    '## Slow-loading pages',
    '',
    `Pages whose load time exceeded ${report.pageLoadThresholdMs}ms, or the ${TOP_N} slowest observed if none did.`,
    '',
  ]
  if (report.slowestPages.length === 0) {
    lines.push('No pages were captured with load-time data.', '')
    return lines
  }
  if (report.flaggedPageCount === 0) {
    lines.push(`No page exceeded the ${report.pageLoadThresholdMs}ms threshold; showing the slowest observed for reference.`, '')
  }
  lines.push('| URL | Page Load (ms) | Over threshold |', '| --- | --- | --- |')
  for (const entry of report.slowestPages) {
    lines.push(`| ${sanitizeMarkdownTableCell(entry.url)} | ${entry.pageLoadMs} | ${entry.overThreshold ? 'Yes' : 'No'} |`)
  }
  lines.push('')
  return lines
}

function renderSlowNetworkRequestsSection(report: TimingReport): string[] {
  const lines: string[] = [
    '## Slow network requests',
    '',
    `Requests whose duration exceeded ${report.networkRequestThresholdMs}ms, or the ${TOP_N} slowest observed if none did.`,
    '',
  ]
  if (report.slowestNetworkRequests.length === 0) {
    lines.push('No network requests were captured.', '')
    return lines
  }
  if (report.flaggedNetworkRequestCount === 0) {
    lines.push(`No request exceeded the ${report.networkRequestThresholdMs}ms threshold; showing the slowest observed for reference.`, '')
  }
  lines.push('| Page | Method | Request URL | Duration (ms) | Over threshold |', '| --- | --- | --- | --- | --- |')
  for (const entry of report.slowestNetworkRequests) {
    lines.push(`| ${sanitizeMarkdownTableCell(entry.pageUrl)} | ${sanitizeMarkdownTableCell(entry.method)} | ${sanitizeMarkdownTableCell(entry.requestUrl)} | ${entry.durationMs} | ${entry.overThreshold ? 'Yes' : 'No'} |`)
  }
  lines.push('')
  return lines
}

function renderHighLatencyElementsSection(report: TimingReport): string[] {
  const lines: string[] = [
    '## High-latency elements',
    '',
    `Interactive elements that appeared dynamically after initial page load (elements present at load are excluded), ` +
      `whose appearance latency exceeded ${report.appearanceThresholdMs}ms, or the ${TOP_N} slowest observed if none did. ` +
      'A test waiting on one of these may need a longer-than-default timeout.',
    '',
  ]
  if (report.slowestAppearingElements.length === 0) {
    lines.push('No dynamically-appearing elements were observed.', '')
    return lines
  }
  if (report.flaggedElementCount === 0) {
    lines.push(`No element exceeded the ${report.appearanceThresholdMs}ms threshold; showing the slowest observed for reference.`, '')
  }
  lines.push('| Page | Role | Accessible Name | Appeared At (ms) | Over threshold |', '| --- | --- | --- | --- | --- |')
  for (const entry of report.slowestAppearingElements) {
    lines.push(`| ${sanitizeMarkdownTableCell(entry.pageUrl)} | ${sanitizeMarkdownTableCell(entry.role)} | ${sanitizeMarkdownTableCell(entry.accessibleName)} | ${entry.appearedAtMs} | ${entry.overThreshold ? 'Yes' : 'No'} |`)
  }
  lines.push('')
  return lines
}

export function renderTimingReportMarkdown(report: TimingReport): string {
  const lines: string[] = [
    '# Timing Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `${report.pagesAnalyzed} pages analyzed, ${report.flaggedPageCount} slow-loading pages (>${report.pageLoadThresholdMs}ms), ` +
      `${report.flaggedNetworkRequestCount} slow network requests (>${report.networkRequestThresholdMs}ms), ` +
      `${report.flaggedElementCount} high-latency elements (>${report.appearanceThresholdMs}ms)`,
    '',
  ]
  lines.push(...renderSlowPagesSection(report))
  lines.push(...renderSlowNetworkRequestsSection(report))
  lines.push(...renderHighLatencyElementsSection(report))
  return lines.join('\n')
}
