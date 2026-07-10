import { describe, it, expect } from 'vitest'
import type { DomInteractiveElement, CapturedForm } from '@treeline/acquire'
import type { HardPageEntry } from '@treeline/core'
import type { CrawledPage } from './input.js'
import type { SkippedElement } from './types.js'
import { generateCoverageReport, renderCoverageReportMarkdown } from './coverage-report.js'

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
    ...overrides,
  }
}

function makeForm(overrides: Partial<CapturedForm>): CapturedForm {
  return {
    formIndex: 0,
    action: '/submit',
    method: 'post',
    fields: [
      {
        role: 'textbox',
        accessibleName: 'Email',
        tagName: 'input',
        inputType: 'email',
        required: true,
        pattern: null,
        testId: null,
        cssPath: 'form > input',
      },
    ],
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
    interactiveElements: [],
    axeViolations: [],
    axeIncomplete: [],
    forms: [],
    status: 'ok',
    ...overrides,
  }
}

function makeHardPageEntry(overrides: Partial<HardPageEntry>): HardPageEntry {
  return {
    url: 'https://example.com/broken',
    reasonCode: 'timeout',
    attemptedAt: new Date().toISOString(),
    captureSnapshot: null,
    ...overrides,
  }
}

describe('generateCoverageReport', () => {
  it('flags a page as zero-coverage when every interactive element was skipped', () => {
    const page = makePage({ url: 'https://example.com/a', interactiveElements: [makeElement({}), makeElement({})] })
    const skipped: SkippedElement[] = [
      { url: 'https://example.com/a', elementDescription: 'submitButton', reason: 'no stable selector candidate available' },
      { url: 'https://example.com/a', elementDescription: 'submitButton', reason: 'no stable selector candidate available' },
    ]
    const report = generateCoverageReport([page], skipped, [])
    expect(report.zeroCoveragePages).toHaveLength(1)
    expect(report.zeroCoveragePages[0]!.url).toBe('https://example.com/a')
    expect(report.zeroCoveragePages[0]!.skipPercent).toBe(100)
    expect(report.highSkipPages).toHaveLength(0)
  })

  it('flags a page as high-skip when more than 50% but not all elements were skipped, without double-listing it as zero-coverage', () => {
    const page = makePage({
      url: 'https://example.com/b',
      interactiveElements: [makeElement({}), makeElement({}), makeElement({})],
    })
    const skipped: SkippedElement[] = [
      { url: 'https://example.com/b', elementDescription: 'a', reason: 'x' },
      { url: 'https://example.com/b', elementDescription: 'b', reason: 'x' },
    ]
    const report = generateCoverageReport([page], skipped, [])
    expect(report.highSkipPages).toHaveLength(1)
    expect(report.highSkipPages[0]!.skipPercent).toBeCloseTo(66.7, 1)
    expect(report.zeroCoveragePages).toHaveLength(0)
  })

  it('does not flag a page at or below the 50% skip threshold', () => {
    const page = makePage({
      url: 'https://example.com/c',
      interactiveElements: [makeElement({}), makeElement({})],
    })
    const skipped: SkippedElement[] = [{ url: 'https://example.com/c', elementDescription: 'a', reason: 'x' }]
    const report = generateCoverageReport([page], skipped, [])
    expect(report.highSkipPages).toHaveLength(0)
    expect(report.zeroCoveragePages).toHaveLength(0)
  })

  it('excludes pages with zero interactive elements from zero-coverage and high-skip sections', () => {
    const page = makePage({ url: 'https://example.com/empty', interactiveElements: [] })
    const report = generateCoverageReport([page], [], [])
    expect(report.zeroCoveragePages).toHaveLength(0)
    expect(report.highSkipPages).toHaveLength(0)
  })

  it('excludes pages that never completed capture from coverage metrics, and lists them explicitly instead', () => {
    const capturedPage = makePage({ url: 'https://example.com/ok', interactiveElements: [makeElement({})] })
    const failedPage = makePage({ url: 'https://example.com/broken', title: null, ariaSnapshot: null, capturedAt: null })
    const report = generateCoverageReport([capturedPage, failedPage], [], [])
    expect(report.pagesExcludedFromCoverage).toEqual(['https://example.com/broken'])
    expect(report.zeroCoveragePages.map((e) => e.url)).not.toContain('https://example.com/broken')
    expect(report.highSkipPages.map((e) => e.url)).not.toContain('https://example.com/broken')
  })

  it('lists every form found as a coverage gap, since generated specs never reference form fields', () => {
    const page = makePage({ url: 'https://example.com/signup', forms: [makeForm({}), makeForm({ formIndex: 1, action: '/other' })] })
    const report = generateCoverageReport([page], [], [])
    expect(report.formsWithoutTest).toHaveLength(2)
    expect(report.formsWithoutTest[0]!.url).toBe('https://example.com/signup')
    expect(report.formsWithoutTest[0]!.fieldCount).toBe(1)
  })

  it('passes through hard-page entries unchanged', () => {
    const entry = makeHardPageEntry({ url: 'https://example.com/timeout-page', reasonCode: 'timeout' })
    const report = generateCoverageReport([], [], [entry])
    expect(report.unresolvedHardPages).toEqual([entry])
  })
})

describe('renderCoverageReportMarkdown', () => {
  it('renders headings, summary counts, and the forms-without-test explanation', () => {
    const page = makePage({ url: 'https://example.com/signup', forms: [makeForm({})] })
    const report = generateCoverageReport([page], [], [])
    const markdown = renderCoverageReportMarkdown(report)
    expect(markdown).toContain('# Coverage Gap Report')
    expect(markdown).toContain('## Zero-coverage pages')
    expect(markdown).toContain('## High-skip pages')
    expect(markdown).toContain('## Forms without a corresponding test')
    expect(markdown).toContain('## Unresolved hard-pages entries')
    expect(markdown).toContain('never reference')
    expect(markdown).toContain('| https://example.com/signup | 0 | /submit | POST | 1 |')
  })

  it('states plainly when a section is empty, without an empty table', () => {
    const report = generateCoverageReport([], [], [])
    const markdown = renderCoverageReportMarkdown(report)
    expect(markdown).toContain('None found.')
    expect(markdown).toContain('No forms were found.')
    expect(markdown).toContain('No unresolved hard-pages entries.')
  })

  it('surfaces excluded-from-capture pages explicitly rather than silently omitting them', () => {
    const failedPage = makePage({ url: 'https://example.com/broken', title: null, ariaSnapshot: null, capturedAt: null })
    const report = generateCoverageReport([failedPage], [], [])
    const markdown = renderCoverageReportMarkdown(report)
    expect(markdown).toContain('never completed capture')
    expect(markdown).toContain('https://example.com/broken')
  })

  it('renders the hard-pages table with reason codes', () => {
    const entry = makeHardPageEntry({ url: 'https://example.com/timeout-page', reasonCode: 'timeout' })
    const report = generateCoverageReport([], [], [entry])
    const markdown = renderCoverageReportMarkdown(report)
    expect(markdown).toContain('https://example.com/timeout-page')
    expect(markdown).toContain('timeout')
  })
})
