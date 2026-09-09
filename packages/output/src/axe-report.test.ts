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

  it('computes affectedElementCount and exampleSelectors from a finding with nodes', () => {
    const report = generateAxeReport([populatedPage])
    const page = report.pages.find((p) => p.url === 'https://example.com/signup')!
    expect(page.violations[0]!.affectedElementCount).toBe(1)
    expect(page.violations[0]!.exampleSelectors).toEqual(['.low-contrast'])
  })

  it('produces empty exampleSelectors without throwing when nodes is empty', () => {
    const emptyNodesPage = makePage({
      url: 'https://example.com/empty-nodes',
      axeViolations: [makeViolation({ nodes: [] })],
    })
    expect(() => generateAxeReport([emptyNodesPage])).not.toThrow()
    const report = generateAxeReport([emptyNodesPage])
    const finding = report.pages[0]!.violations[0]!
    expect(finding.affectedElementCount).toBe(0)
    expect(finding.exampleSelectors).toEqual([])
  })

  it('captures every affected element as a separate example selector, up to the cap, when a finding has multiple nodes', () => {
    const multiNodePage = makePage({
      url: 'https://example.com/multi-node',
      axeViolations: [
        makeViolation({
          nodes: [
            { target: ['.low-contrast-1'], html: '<p class="low-contrast-1">A</p>', failureSummary: null },
            { target: ['.low-contrast-2'], html: '<p class="low-contrast-2">B</p>', failureSummary: null },
            { target: ['.low-contrast-3'], html: '<p class="low-contrast-3">C</p>', failureSummary: null },
          ],
        }),
      ],
    })
    const report = generateAxeReport([multiNodePage])
    const finding = report.pages[0]!.violations[0]!
    expect(finding.affectedElementCount).toBe(3)
    expect(finding.exampleSelectors).toEqual(['.low-contrast-1', '.low-contrast-2', '.low-contrast-3'])
  })

  it('caps exampleSelectors at 5 even when a finding has many more affected elements, without dropping the real count', () => {
    const nodes = Array.from({ length: 12 }, (_, i) => ({
      target: [`.item-${i}`],
      html: `<p class="item-${i}"></p>`,
      failureSummary: null,
    }))
    const manyNodesPage = makePage({
      url: 'https://example.com/many-nodes',
      axeViolations: [makeViolation({ nodes })],
    })
    const report = generateAxeReport([manyNodesPage])
    const finding = report.pages[0]!.violations[0]!
    expect(finding.affectedElementCount).toBe(12)
    expect(finding.exampleSelectors).toHaveLength(5)
    expect(finding.exampleSelectors).toEqual(['.item-0', '.item-1', '.item-2', '.item-3', '.item-4'])
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

  it('renders every captured example selector for a multi-node finding, joined in one cell', () => {
    const multiNodePage = makePage({
      url: 'https://example.com/multi-node',
      axeViolations: [
        makeViolation({
          nodes: [
            { target: ['.low-contrast-1'], html: '<p></p>', failureSummary: null },
            { target: ['.low-contrast-2'], html: '<p></p>', failureSummary: null },
          ],
        }),
      ],
    })
    const report = generateAxeReport([multiNodePage])
    const markdown = renderAxeReportMarkdown(report)
    expect(markdown).toContain('.low-contrast-1; .low-contrast-2')
    expect(markdown).not.toContain('more)')
  })

  it('appends a "(+N more)" note when a finding has more affected elements than the example-selector cap', () => {
    const nodes = Array.from({ length: 7 }, (_, i) => ({
      target: [`.item-${i}`],
      html: `<p class="item-${i}"></p>`,
      failureSummary: null,
    }))
    const manyNodesPage = makePage({
      url: 'https://example.com/many-nodes',
      axeViolations: [makeViolation({ nodes })],
    })
    const report = generateAxeReport([manyNodesPage])
    const markdown = renderAxeReportMarkdown(report)
    expect(markdown).toContain('.item-0; .item-1; .item-2; .item-3; .item-4 (+2 more)')
  })

  it('renders the plural "Example Selectors" column header', () => {
    const report = generateAxeReport([populatedPage])
    const markdown = renderAxeReportMarkdown(report)
    expect(markdown).toContain('| Rule | Impact | Affected Elements | Example Selectors | Help |')
  })
})
