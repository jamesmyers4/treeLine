import { describe, it, expect } from 'vitest'
import type { AssertableAttribute } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import { generateAssertableDataReport, renderAssertableDataReportMarkdown } from './assertable-data-report.js'

function makeAttribute(overrides: Partial<AssertableAttribute> = {}): AssertableAttribute {
  return {
    attributeName: 'title',
    value: '2014-08-05T20:05:57',
    role: '',
    accessibleName: '1994 days ago',
    tagName: 'span',
    testId: null,
    cssPath: '.age',
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

describe('generateAssertableDataReport', () => {
  it('excludes pages with no captured assertable attributes', () => {
    const page = makePage({ url: 'https://example.com/plain', assertableAttributes: [] })
    const report = generateAssertableDataReport([page])
    expect(report.pages).toHaveLength(0)
  })

  it('excludes pages that failed capture (null title/ariaSnapshot/capturedAt)', () => {
    const page = makePage({ url: 'https://example.com/failed', title: null, ariaSnapshot: null, capturedAt: null, assertableAttributes: [makeAttribute()] })
    const report = generateAssertableDataReport([page])
    expect(report.pages).toHaveLength(0)
  })

  it('includes a page with captured assertable attributes, one row per attribute', () => {
    const page = makePage({
      url: 'https://example.com/newest',
      assertableAttributes: [makeAttribute(), makeAttribute({ attributeName: 'data-price', value: '19.99', accessibleName: '', tagName: 'span', testId: 'price-tag', cssPath: '.price' })],
    })
    const report = generateAssertableDataReport([page])
    expect(report.pages).toHaveLength(1)
    expect(report.pages[0]!.rows).toHaveLength(2)
  })

  it('uses accessibleName as the element description when non-empty, else falls back to <tagName>', () => {
    const page = makePage({
      url: 'https://example.com/a',
      assertableAttributes: [makeAttribute({ accessibleName: '' })],
    })
    const report = generateAssertableDataReport([page])
    expect(report.pages[0]!.rows[0]!.elementDescription).toBe('<span>')
  })

  it('builds a getByRole locator when both role and accessibleName are present', () => {
    const page = makePage({
      url: 'https://example.com/a',
      assertableAttributes: [makeAttribute({ role: 'link', accessibleName: 'Read more' })],
    })
    const report = generateAssertableDataReport([page])
    expect(report.pages[0]!.rows[0]!.suggestedLocator).toBe('page.getByRole("link", { name: "Read more" })')
  })

  it('falls back to getByTestId when there is no role/accessibleName pair but a testId exists', () => {
    const page = makePage({
      url: 'https://example.com/a',
      assertableAttributes: [makeAttribute({ role: '', accessibleName: '', testId: 'price-tag' })],
    })
    const report = generateAssertableDataReport([page])
    expect(report.pages[0]!.rows[0]!.suggestedLocator).toBe('page.getByTestId("price-tag")')
  })

  it('falls back to a plain locator on cssPath when neither role/name nor testId are available', () => {
    const page = makePage({
      url: 'https://example.com/a',
      assertableAttributes: [makeAttribute({ role: '', accessibleName: '', testId: null, cssPath: 'span.age' })],
    })
    const report = generateAssertableDataReport([page])
    expect(report.pages[0]!.rows[0]!.suggestedLocator).toBe('page.locator("span.age")')
  })
})

describe('renderAssertableDataReportMarkdown', () => {
  it('renders the heading, summary line, and per-page section', () => {
    const page = makePage({ url: 'https://example.com/a', assertableAttributes: [makeAttribute()] })
    const report = generateAssertableDataReport([page])
    const markdown = renderAssertableDataReportMarkdown(report)
    expect(markdown).toContain('# Assertable Data Report')
    expect(markdown).toContain('1 pages with at least one assertable attribute.')
    expect(markdown).toContain('## https://example.com/a')
    expect(markdown).toContain('| Element | Attribute | Value | Suggested Locator |')
  })

  it('states plainly when no page had any captured assertable attributes', () => {
    const report = generateAssertableDataReport([])
    const markdown = renderAssertableDataReportMarkdown(report)
    expect(markdown).toContain('No page had any captured assertable attributes.')
  })

  it('renders a real attribute/value/locator row in the per-page table', () => {
    const page = makePage({
      url: 'https://example.com/newest',
      assertableAttributes: [makeAttribute({ attributeName: 'title', value: '2014-08-05T20:05:57', accessibleName: '1994 days ago', role: '' })],
    })
    const report = generateAssertableDataReport([page])
    const markdown = renderAssertableDataReportMarkdown(report)
    expect(markdown).toContain('| 1994 days ago | title | 2014-08-05T20:05:57 | `page.locator(".age")` |')
  })

  it('sanitizes an untrusted page URL, value, and element description in generated markdown', () => {
    const page = makePage({
      url: 'https://example.com/a|b\nfake heading',
      assertableAttributes: [makeAttribute({ value: 'weird|value\nwith newline', accessibleName: 'weird|name\nwith newline' })],
    })
    const report = generateAssertableDataReport([page])
    const markdown = renderAssertableDataReportMarkdown(report)
    expect(markdown).not.toContain('\nfake heading')
    expect(markdown).not.toContain('\nwith newline')
  })
})
