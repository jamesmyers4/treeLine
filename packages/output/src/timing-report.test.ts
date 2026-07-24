import { describe, it, expect } from 'vitest'
import type { DomInteractiveElement, NetworkEntry } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import { generateTimingReport, renderTimingReportMarkdown } from './timing-report.js'

function makeElement(overrides: Partial<DomInteractiveElement>): DomInteractiveElement {
  return {
    role: 'button',
    accessibleName: 'Submit',
    testId: null,
    tagName: 'button',
    elementId: null,
    classList: [],
    cssPath: 'body > button',
    xpath: '/html/body/button',
    appearedAtMs: null,
    ...overrides,
  }
}

function makeNetworkEntry(overrides: Partial<NetworkEntry>): NetworkEntry {
  return {
    url: 'https://example.com/api',
    method: 'GET',
    status: 200,
    resourceType: 'fetch',
    durationMs: 50,
    responseBodySample: null,
    responseBodySchema: null,
    requestBody: null,
    requestBodyContentTypeCategory: null,
    requestBodyExceededSizeCap: false,
    requestHeaderNames: [],
    queryParams: {},
    requiresAuth: false,
    ...overrides,
  }
}

function makePage(overrides: Partial<CrawledPage>): CrawledPage {
  return {
    url: 'https://example.com',
    title: 'Test Page',
    ariaSnapshot: '',
    links: [],
    networkLog: [],
    screenshotPath: null,
    capturedAt: new Date().toISOString(),
    pageLoadMs: null,
    interactiveElements: [],
    axeViolations: [],
    axeIncomplete: [],
    forms: [],
    colorPalette: [],
    assertableAttributes: [],
    status: 'ok',
    ...overrides,
  }
}

describe('generateTimingReport', () => {
  it('flags a page whose pageLoadMs exceeds the threshold', () => {
    const page = makePage({ url: 'https://example.com/slow', pageLoadMs: 3000 })
    const report = generateTimingReport([page])
    expect(report.flaggedPageCount).toBe(1)
    expect(report.slowestPages[0]).toEqual({ url: 'https://example.com/slow', pageLoadMs: 3000, overThreshold: true })
  })

  it('does not flag a page whose pageLoadMs is below the threshold', () => {
    const page = makePage({ url: 'https://example.com/fast', pageLoadMs: 800 })
    const report = generateTimingReport([page])
    expect(report.flaggedPageCount).toBe(0)
    expect(report.slowestPages[0]!.overThreshold).toBe(false)
  })

  it('still surfaces the slowest pages when none exceed the threshold', () => {
    const pages = [
      makePage({ url: 'https://example.com/a', pageLoadMs: 600 }),
      makePage({ url: 'https://example.com/b', pageLoadMs: 900 }),
    ]
    const report = generateTimingReport(pages)
    expect(report.flaggedPageCount).toBe(0)
    expect(report.slowestPages).toHaveLength(2)
    expect(report.slowestPages[0]!.url).toBe('https://example.com/b')
  })

  it('caps the slowest-pages list at the top N and sorts descending', () => {
    const pages = Array.from({ length: 8 }, (_, i) => makePage({ url: `https://example.com/${i}`, pageLoadMs: i * 100 }))
    const report = generateTimingReport(pages)
    expect(report.slowestPages).toHaveLength(5)
    expect(report.slowestPages[0]!.pageLoadMs).toBe(700)
    expect(report.slowestPages[4]!.pageLoadMs).toBe(300)
  })

  it('excludes pages with a null pageLoadMs', () => {
    const page = makePage({ url: 'https://example.com/broken', title: null, ariaSnapshot: null, capturedAt: null, pageLoadMs: null })
    const report = generateTimingReport([page])
    expect(report.pagesAnalyzed).toBe(0)
    expect(report.slowestPages).toHaveLength(0)
  })

  it('flags a network request whose durationMs exceeds the threshold', () => {
    const page = makePage({
      url: 'https://example.com/x',
      networkLog: [makeNetworkEntry({ url: 'https://example.com/slow-api', durationMs: 600 })],
    })
    const report = generateTimingReport([page])
    expect(report.flaggedNetworkRequestCount).toBe(1)
    expect(report.slowestNetworkRequests[0]).toEqual({
      pageUrl: 'https://example.com/x',
      requestUrl: 'https://example.com/slow-api',
      method: 'GET',
      durationMs: 600,
      overThreshold: true,
    })
  })

  it('does not flag a network request whose durationMs is below the threshold', () => {
    const page = makePage({ url: 'https://example.com/x', networkLog: [makeNetworkEntry({ durationMs: 200 })] })
    const report = generateTimingReport([page])
    expect(report.flaggedNetworkRequestCount).toBe(0)
  })

  it('flags a dynamically-appearing element whose appearedAtMs exceeds the threshold', () => {
    const page = makePage({
      url: 'https://example.com/x',
      interactiveElements: [makeElement({ accessibleName: 'Delayed', appearedAtMs: 3000 })],
    })
    const report = generateTimingReport([page])
    expect(report.flaggedElementCount).toBe(1)
    expect(report.slowestAppearingElements[0]!.accessibleName).toBe('Delayed')
    expect(report.slowestAppearingElements[0]!.overThreshold).toBe(true)
  })

  it('excludes elements present at initial load (null appearedAtMs)', () => {
    const page = makePage({
      url: 'https://example.com/x',
      interactiveElements: [makeElement({ accessibleName: 'Immediate', appearedAtMs: null })],
    })
    const report = generateTimingReport([page])
    expect(report.slowestAppearingElements).toHaveLength(0)
    expect(report.flaggedElementCount).toBe(0)
  })
})

describe('renderTimingReportMarkdown', () => {
  it('renders headings and the summary line', () => {
    const page = makePage({ url: 'https://example.com/a', pageLoadMs: 800 })
    const report = generateTimingReport([page])
    const markdown = renderTimingReportMarkdown(report)
    expect(markdown).toContain('# Timing Report')
    expect(markdown).toContain('## Slow-loading pages')
    expect(markdown).toContain('## Slow network requests')
    expect(markdown).toContain('## High-latency elements')
    expect(markdown).toContain('1 pages analyzed')
  })

  it('states plainly when a section has no data at all', () => {
    const report = generateTimingReport([])
    const markdown = renderTimingReportMarkdown(report)
    expect(markdown).toContain('No pages were captured with load-time data.')
    expect(markdown).toContain('No network requests were captured.')
    expect(markdown).toContain('No dynamically-appearing elements were observed.')
  })

  it('notes when a section has data but nothing crossed the threshold', () => {
    const page = makePage({ url: 'https://example.com/a', pageLoadMs: 800 })
    const report = generateTimingReport([page])
    const markdown = renderTimingReportMarkdown(report)
    expect(markdown).toContain('No page exceeded the 2500ms threshold; showing the slowest observed for reference.')
  })

  it('renders a flagged page row with Yes in the Over threshold column', () => {
    const page = makePage({ url: 'https://example.com/slow', pageLoadMs: 3000 })
    const report = generateTimingReport([page])
    const markdown = renderTimingReportMarkdown(report)
    expect(markdown).toContain('| https://example.com/slow | 3000 | Yes |')
  })
})
