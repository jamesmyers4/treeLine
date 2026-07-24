import { describe, it, expect } from 'vitest'
import type { AxeIncompleteResult, AxeViolation } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import { generateAxeReport, renderAxeReportMarkdown } from './axe-report.js'

function makeViolation(overrides: Partial<AxeViolation>): AxeViolation {
  return {
    id: 'color-contrast',
    impact: 'serious',
    description: 'Elements must meet contrast ratio thresholds',
    help: 'Elements must have sufficient color contrast',
    helpUrl: 'https://example.com/rules/color-contrast',
    nodes: [{ target: ['.low-contrast'], html: '<p class="low-contrast">Text</p>', failureSummary: null }],
    ...overrides,
  }
}

function makeIncomplete(overrides: Partial<AxeIncompleteResult>): AxeIncompleteResult {
  return {
    id: 'link-name',
    impact: 'moderate',
    description: 'Links must have discernible text',
    help: 'Links must have discernible text',
    helpUrl: 'https://example.com/rules/link-name',
    nodes: [{ target: ['a.icon-link'], html: '<a class="icon-link"></a>', failureSummary: null }],
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

const populatedPage = makePage({
  url: 'https://example.com/signup',
  axeViolations: [makeViolation({})],
  axeIncomplete: [makeIncomplete({})],
})

const cleanPage = makePage({
  url: 'https://example.com/about',
  axeViolations: [],
  axeIncomplete: [],
})

const failedCapturePage = makePage({
  url: 'https://example.com/broken',
  title: null,
  ariaSnapshot: null,
  capturedAt: null,
})

describe('generateAxeReport', () => {
  it('excludes pages that failed capture entirely', () => {
    const report = generateAxeReport([populatedPage, cleanPage, failedCapturePage])
    const urls = report.pages.map((page) => page.url)
    expect(urls).toContain('https://example.com/signup')
    expect(urls).toContain('https://example.com/about')
    expect(urls).not.toContain('https://example.com/broken')
  })

  it('sums totalViolations and totalNeedsReview across pages', () => {
    const report = generateAxeReport([populatedPage, cleanPage, failedCapturePage])
    expect(report.totalViolations).toBe(1)
    expect(report.totalNeedsReview).toBe(1)
  })

  it('computes affectedElementCount and exampleSelector from a finding with nodes', () => {
    const report = generateAxeReport([populatedPage])
    const page = report.pages.find((p) => p.url === 'https://example.com/signup')!
    expect(page.violations[0]!.affectedElementCount).toBe(1)
    expect(page.violations[0]!.exampleSelector).toBe('.low-contrast')
  })

  it('produces an empty exampleSelector without throwing when nodes is empty', () => {
    const emptyNodesPage = makePage({
      url: 'https://example.com/empty-nodes',
      axeViolations: [makeViolation({ nodes: [] })],
    })
    expect(() => generateAxeReport([emptyNodesPage])).not.toThrow()
    const report = generateAxeReport([emptyNodesPage])
    const finding = report.pages[0]!.violations[0]!
    expect(finding.affectedElementCount).toBe(0)
    expect(finding.exampleSelector).toBe('')
  })
})

describe('renderAxeReportMarkdown', () => {
  it('renders the overview table, page headings, findings, and empty states', () => {
    const report = generateAxeReport([populatedPage, cleanPage, failedCapturePage])
    const markdown = renderAxeReportMarkdown(report)
    expect(markdown).toContain('| URL | Violations | Needs Review |')
    expect(markdown).toContain('## https://example.com/signup')
    expect(markdown).toContain('## https://example.com/about')
    expect(markdown).toContain('color-contrast')
    expect(markdown).toContain('.low-contrast')
    expect(markdown).toContain('link-name')
    expect(markdown).toContain('a.icon-link')
    expect(markdown).toContain('No violations found.')
    expect(markdown).toContain('Nothing flagged for manual review.')
  })
})
