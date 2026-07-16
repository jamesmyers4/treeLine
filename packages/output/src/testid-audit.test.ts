import { describe, it, expect } from 'vitest'
import type { DomInteractiveElement } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import { generateTestIdAudit, renderTestIdAuditMarkdown } from './testid-audit.js'

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

function makePage(url: string, interactiveElements: DomInteractiveElement[]): CrawledPage {
  return {
    url,
    title: 'Test Page',
    ariaSnapshot: '',
    links: [],
    networkLog: [],
    screenshotPath: null,
    capturedAt: new Date().toISOString(),
    pageLoadMs: null,
    interactiveElements,
    axeViolations: [],
    axeIncomplete: [],
    forms: [],
    colorPalette: [],
    status: 'ok',
  }
}

describe('generateTestIdAudit', () => {
  it('computes coverage percent on a known ratio', () => {
    const page = makePage('https://example.com', [
      makeElement({ testId: 'a' }),
      makeElement({ testId: null }),
      makeElement({ testId: null }),
      makeElement({ testId: null }),
    ])
    const audit = generateTestIdAudit([page])
    expect(audit.pages[0]!.totalInteractive).toBe(4)
    expect(audit.pages[0]!.withTestId).toBe(1)
    expect(audit.pages[0]!.coveragePercent).toBe(25)
  })

  it('lists only elements missing a testId in gaps', () => {
    const page = makePage('https://example.com', [
      makeElement({ testId: 'a', role: 'button', accessibleName: 'Has Id' }),
      makeElement({ testId: null, role: 'link', accessibleName: 'No Id' }),
    ])
    const audit = generateTestIdAudit([page])
    expect(audit.pages[0]!.gaps).toHaveLength(1)
    expect(audit.pages[0]!.gaps[0]).toEqual({
      url: 'https://example.com',
      role: 'link',
      accessibleName: 'No Id',
    })
  })

  it('aggregates overallCoveragePercent across multiple pages', () => {
    const pageA = makePage('https://example.com/a', [
      makeElement({ testId: 'a' }),
      makeElement({ testId: null }),
    ])
    const pageB = makePage('https://example.com/b', [
      makeElement({ testId: 'b' }),
      makeElement({ testId: 'c' }),
    ])
    const audit = generateTestIdAudit([pageA, pageB])
    expect(audit.overallCoveragePercent).toBe(75)
  })

  it('rounds coverage percent to 1 decimal', () => {
    const page = makePage('https://example.com', [
      makeElement({ testId: 'a' }),
      makeElement({ testId: null }),
      makeElement({ testId: null }),
    ])
    const audit = generateTestIdAudit([page])
    expect(audit.pages[0]!.coveragePercent).toBe(33.3)
  })
})

describe('renderTestIdAuditMarkdown', () => {
  it('produces a summary table and a gaps list', () => {
    const page = makePage('https://example.com', [
      makeElement({ testId: 'a', role: 'button', accessibleName: 'Has Id' }),
      makeElement({ testId: null, role: 'link', accessibleName: 'No Id' }),
    ])
    const audit = generateTestIdAudit([page])
    const markdown = renderTestIdAuditMarkdown(audit)
    expect(markdown).toContain('| URL | Coverage % | Missing Count |')
    expect(markdown).toContain('https://example.com')
    expect(markdown).toContain("- link 'No Id'")
  })
})
