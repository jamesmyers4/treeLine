import { describe, it, expect } from 'vitest'
import type { DomInteractiveElement } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import { generateSelectorReport, renderSelectorReportMarkdown } from './selector-report.js'

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

function makePage(url: string, interactiveElements: DomInteractiveElement[]): CrawledPage {
  return {
    url,
    title: 'Test Page',
    ariaSnapshot: '',
    links: [],
    networkLog: [],
    screenshot: null,
    capturedAt: new Date().toISOString(),
    interactiveElements,
    axeViolations: [],
    status: 'ok',
  }
}

describe('generateSelectorReport', () => {
  it('ranks candidates as role, testid, css, xpath', () => {
    const el = makeElement({ testId: 'submit-btn' })
    const report = generateSelectorReport([makePage('https://example.com', [el])])
    const strategies = report.pages[0]!.entries[0]!.candidates.map((c) => c.strategy)
    expect(strategies).toEqual(['role', 'testid', 'css', 'xpath'])
  })

  it('excludes the role candidate when accessibleName is empty', () => {
    const el = makeElement({ accessibleName: '' })
    const report = generateSelectorReport([makePage('https://example.com', [el])])
    const strategies = report.pages[0]!.entries[0]!.candidates.map((c) => c.strategy)
    expect(strategies).not.toContain('role')
  })

  it('excludes the role candidate when role is generic', () => {
    const el = makeElement({ role: 'generic' })
    const report = generateSelectorReport([makePage('https://example.com', [el])])
    const strategies = report.pages[0]!.entries[0]!.candidates.map((c) => c.strategy)
    expect(strategies).not.toContain('role')
  })

  it('flags an nth-of-type css path as unstable', () => {
    const el = makeElement({ cssPath: 'body > div:nth-of-type(3) > button' })
    const report = generateSelectorReport([makePage('https://example.com', [el])])
    const cssCandidate = report.pages[0]!.entries[0]!.candidates.find((c) => c.strategy === 'css')!
    expect(cssCandidate.stable).toBe(false)
  })

  it('flags a hash-like class as unstable', () => {
    const el = makeElement({ classList: ['css-1a2b3c'] })
    const report = generateSelectorReport([makePage('https://example.com', [el])])
    const cssCandidate = report.pages[0]!.entries[0]!.candidates.find((c) => c.strategy === 'css')!
    expect(cssCandidate.stable).toBe(false)
  })

  it('treats a semantic class as stable', () => {
    const el = makeElement({ classList: ['btn-primary'] })
    const report = generateSelectorReport([makePage('https://example.com', [el])])
    const cssCandidate = report.pages[0]!.entries[0]!.candidates.find((c) => c.strategy === 'css')!
    expect(cssCandidate.stable).toBe(true)
  })

  it('always marks xpath as unstable', () => {
    const el = makeElement({})
    const report = generateSelectorReport([makePage('https://example.com', [el])])
    const xpathCandidate = report.pages[0]!.entries[0]!.candidates.find((c) => c.strategy === 'xpath')!
    expect(xpathCandidate.stable).toBe(false)
  })

  it('marks role candidates as not unique when two elements share role and accessibleName', () => {
    const aboutLinkOne = makeElement({
      role: 'link',
      accessibleName: 'About',
      cssPath: 'header > a.about',
      xpath: '/html/body/header/a[1]',
    })
    const aboutLinkTwo = makeElement({
      role: 'link',
      accessibleName: 'About',
      cssPath: 'footer > a.about',
      xpath: '/html/body/footer/a[1]',
    })
    const oneOffButton = makeElement({
      role: 'button',
      accessibleName: 'Submit',
      cssPath: 'body > button',
      xpath: '/html/body/button',
    })
    const report = generateSelectorReport([
      makePage('https://example.com', [aboutLinkOne, aboutLinkTwo, oneOffButton]),
    ])
    const entries = report.pages[0]!.entries
    const aboutRoleCandidateOne = entries[0]!.candidates.find((c) => c.strategy === 'role')!
    const aboutRoleCandidateTwo = entries[1]!.candidates.find((c) => c.strategy === 'role')!
    const submitRoleCandidate = entries[2]!.candidates.find((c) => c.strategy === 'role')!
    expect(aboutRoleCandidateOne.uniqueOnPage).toBe(false)
    expect(aboutRoleCandidateTwo.uniqueOnPage).toBe(false)
    expect(submitRoleCandidate.uniqueOnPage).toBe(true)
  })
})

describe('renderSelectorReportMarkdown', () => {
  it('contains table headers and one row per candidate', () => {
    const el = makeElement({ testId: 'submit-btn' })
    const report = generateSelectorReport([makePage('https://example.com', [el])])
    const markdown = renderSelectorReportMarkdown(report)
    expect(markdown).toContain('| Element | Strategy | Selector | Stable | Unique |')
    expect(markdown).toContain('https://example.com')
    const candidateCount = report.pages[0]!.entries[0]!.candidates.length
    for (const candidate of report.pages[0]!.entries[0]!.candidates) {
      expect(markdown).toContain(candidate.value)
    }
    const rowLines = markdown.split('\n').filter((line) => line.startsWith("| button 'Submit'"))
    expect(rowLines).toHaveLength(candidateCount)
  })
})
