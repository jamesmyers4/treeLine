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
    assertableAttributes: [],
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
    expect(markdown).toContain('| Element | Instances | Strategy | Selector | Stable | Unique |')
    expect(markdown).toContain('https://example.com')
    const candidateCount = report.pages[0]!.entries[0]!.candidates.length
    for (const candidate of report.pages[0]!.entries[0]!.candidates) {
      expect(markdown).toContain(candidate.value)
    }
    const rowLines = markdown.split('\n').filter((line) => line.startsWith("| button 'Submit'"))
    expect(rowLines).toHaveLength(candidateCount)
  })

  it('marks a non-repeating entry with an Instances value of 1', () => {
    const el = makeElement({ testId: 'submit-btn' })
    const report = generateSelectorReport([makePage('https://example.com', [el])])
    const markdown = renderSelectorReportMarkdown(report)
    expect(markdown).toContain("| button 'Submit' | 1 | role |")
  })
})

function makeHnRowFixture(rowCount: number): DomInteractiveElement[] {
  const elements: DomInteractiveElement[] = []
  for (let i = 1; i <= rowCount; i++) {
    elements.push(
      makeElement({
        role: 'link',
        accessibleName: `Story number ${i}`,
        tagName: 'a',
        cssPath: `table > tbody > tr.athing:nth-of-type(${i}) > td.title > span.titleline > a`,
        xpath: `/html/body/table/tbody/tr[${i}]/td[2]/span/a`,
      }),
    )
  }
  return elements
}

describe('generateSelectorReport — repeating region dedup (feedback #7)', () => {
  it('collapses a 30-instance repeating pattern into one representative entry carrying instanceCount 30', () => {
    const report = generateSelectorReport([makePage('https://example.com', makeHnRowFixture(30))])
    const entries = report.pages[0]!.entries
    expect(entries).toHaveLength(1)
    expect(entries[0]!.instanceCount).toBe(30)
    expect(entries[0]!.elementDescription).toBe("link 'Story number 1'")
  })

  it('renders the deduped entry with an instance count note instead of 30 separate table row groups', () => {
    const report = generateSelectorReport([makePage('https://example.com', makeHnRowFixture(30))])
    const markdown = renderSelectorReportMarkdown(report)
    expect(markdown).toContain('| 30 (1 shown) |')
    expect(markdown).not.toContain('Story number 2')
  })

  it('does not dedup a duplicate-destinations-shaped page (2 same-text links, below MIN_REPEATING_INSTANCE_COUNT)', () => {
    const first = makeElement({ role: 'link', accessibleName: 'Read more', cssPath: 'main > article:nth-of-type(1) > a.cta', xpath: '/html/body/main/article[1]/a' })
    const second = makeElement({ role: 'link', accessibleName: 'Read more', cssPath: 'main > article:nth-of-type(2) > a.cta', xpath: '/html/body/main/article[2]/a' })
    const report = generateSelectorReport([makePage('https://example.com', [first, second])])
    const entries = report.pages[0]!.entries
    expect(entries).toHaveLength(2)
    expect(entries[0]!.instanceCount).toBe(1)
    expect(entries[1]!.instanceCount).toBe(1)
  })

  it('leaves non-repeating elements on the same page fully listed alongside a deduped pattern', () => {
    const oneOffButton = makeElement({ role: 'button', accessibleName: 'Submit', cssPath: 'body > button', xpath: '/html/body/button' })
    const report = generateSelectorReport([makePage('https://example.com', [...makeHnRowFixture(30), oneOffButton])])
    const entries = report.pages[0]!.entries
    expect(entries).toHaveLength(2)
    expect(entries.find((e) => e.elementDescription.includes('Submit'))!.instanceCount).toBe(1)
  })
})
