import { describe, it, expect } from 'vitest'
import type { ColorSwatch } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import { generateColorReport, renderColorReportMarkdown } from './color-report.js'

function makeSwatch(overrides: Partial<ColorSwatch> = {}): ColorSwatch {
  return {
    hex: '#1a2744',
    property: 'background-color',
    usageCount: 3,
    exampleSelector: 'body',
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

describe('generateColorReport', () => {
  it('excludes pages with no captured colors from the per-page section', () => {
    const page = makePage({ url: 'https://example.com/plain', colorPalette: [] })
    const report = generateColorReport([page])
    expect(report.pages).toHaveLength(0)
  })

  it('includes a page with captured colors, capped at the per-page top N', () => {
    const swatches = Array.from({ length: 12 }, (_, i) => makeSwatch({ hex: `#${(i + 1).toString(16).padStart(6, '0')}`, usageCount: 12 - i }))
    const page = makePage({ url: 'https://example.com/styled', colorPalette: swatches })
    const report = generateColorReport([page])
    expect(report.pages).toHaveLength(1)
    expect(report.pages[0]!.swatches).toHaveLength(10)
    expect(report.pages[0]!.swatches[0]!.usageCount).toBe(12)
  })

  it('excludes pages that failed capture (null title/ariaSnapshot/capturedAt)', () => {
    const page = makePage({ url: 'https://example.com/failed', title: null, ariaSnapshot: null, capturedAt: null, colorPalette: [makeSwatch()] })
    const report = generateColorReport([page])
    expect(report.pages).toHaveLength(0)
  })

  it('aggregates the same hex/property pair across multiple pages by summed usage and distinct page count', () => {
    const pages = [
      makePage({ url: 'https://example.com/a', colorPalette: [makeSwatch({ hex: '#111111', usageCount: 4 })] }),
      makePage({ url: 'https://example.com/b', colorPalette: [makeSwatch({ hex: '#111111', usageCount: 6 })] }),
    ]
    const report = generateColorReport(pages)
    const entry = report.siteWideScheme.find((e) => e.hex === '#111111')
    expect(entry).toBeDefined()
    expect(entry!.totalUsageCount).toBe(10)
    expect(entry!.pageCount).toBe(2)
  })

  it('keeps color and background-color aggregated separately for the same hex', () => {
    const page = makePage({
      url: 'https://example.com/a',
      colorPalette: [makeSwatch({ hex: '#222222', property: 'color', usageCount: 2 }), makeSwatch({ hex: '#222222', property: 'background-color', usageCount: 5 })],
    })
    const report = generateColorReport([page])
    const colorEntry = report.siteWideScheme.find((e) => e.hex === '#222222' && e.property === 'color')
    const backgroundEntry = report.siteWideScheme.find((e) => e.hex === '#222222' && e.property === 'background-color')
    expect(colorEntry!.totalUsageCount).toBe(2)
    expect(backgroundEntry!.totalUsageCount).toBe(5)
  })

  it('sorts the site-wide scheme by total usage descending and caps at the top N', () => {
    const swatches = Array.from({ length: 20 }, (_, i) => makeSwatch({ hex: `#${(i + 1).toString(16).padStart(6, '0')}`, usageCount: i + 1 }))
    const page = makePage({ url: 'https://example.com/a', colorPalette: swatches })
    const report = generateColorReport([page])
    expect(report.siteWideScheme).toHaveLength(15)
    expect(report.siteWideScheme[0]!.totalUsageCount).toBe(20)
    expect(report.siteWideScheme[14]!.totalUsageCount).toBe(6)
  })
})

describe('renderColorReportMarkdown', () => {
  it('renders headings and the summary line', () => {
    const page = makePage({ url: 'https://example.com/a', colorPalette: [makeSwatch()] })
    const report = generateColorReport([page])
    const markdown = renderColorReportMarkdown(report)
    expect(markdown).toContain('# Color Report')
    expect(markdown).toContain('## Site-wide color scheme')
    expect(markdown).toContain('## Per-page colors')
    expect(markdown).toContain('1 pages with captured colors')
  })

  it('states plainly when no colors were captured at all', () => {
    const report = generateColorReport([])
    const markdown = renderColorReportMarkdown(report)
    expect(markdown).toContain('No colors were captured across any page.')
    expect(markdown).toContain('No page had any captured colors.')
  })

  it('renders a real hex code and example selector in the per-page table', () => {
    const page = makePage({ url: 'https://example.com/a', colorPalette: [makeSwatch({ hex: '#abcdef', exampleSelector: 'button.btn' })] })
    const report = generateColorReport([page])
    const markdown = renderColorReportMarkdown(report)
    expect(markdown).toContain('| #abcdef | background-color | 3 | button.btn |')
  })

  it('sanitizes an untrusted page URL and example selector in generated markdown', () => {
    const page = makePage({
      url: 'https://example.com/a|b\nfake heading',
      colorPalette: [makeSwatch({ exampleSelector: 'div|weird\nselector' })],
    })
    const report = generateColorReport([page])
    const markdown = renderColorReportMarkdown(report)
    expect(markdown).not.toContain('\nfake heading')
    expect(markdown).not.toContain('\nselector')
  })
})
