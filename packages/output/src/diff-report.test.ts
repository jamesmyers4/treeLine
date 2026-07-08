import { describe, it, expect } from 'vitest'
import type { CrawlDiff, SelectorCandidateChange } from '@treeline/core'
import { classifyChange, renderDiffReportMarkdown } from './diff-report.js'

function makeDiff(overrides: Partial<CrawlDiff>): CrawlDiff {
  return {
    baselineDbPath: 'baseline.db',
    currentDbPath: 'current.db',
    pagesAdded: [],
    pagesRemoved: [],
    titleChanges: [],
    selectorCandidateChanges: [],
    ...overrides,
  }
}

function makeChange(overrides: Partial<SelectorCandidateChange>): SelectorCandidateChange {
  return {
    url: 'https://example.com',
    role: 'button',
    accessibleName: 'Submit',
    occurrenceIndex: 0,
    baselineStable: true,
    baselineUniqueOnPage: true,
    currentStable: true,
    currentUniqueOnPage: true,
    ...overrides,
  }
}

describe('classifyChange', () => {
  it('classifies safe -> unsafe as a regression', () => {
    const change = makeChange({ baselineStable: true, baselineUniqueOnPage: true, currentStable: false, currentUniqueOnPage: true })
    expect(classifyChange(change)).toBe('regression')
  })

  it('classifies unsafe -> safe as an improvement', () => {
    const change = makeChange({ baselineStable: false, baselineUniqueOnPage: true, currentStable: true, currentUniqueOnPage: true })
    expect(classifyChange(change)).toBe('improvement')
  })

  it('classifies unsafe -> unsafe (still crossing no line) as other', () => {
    const change = makeChange({ baselineStable: false, baselineUniqueOnPage: false, currentStable: true, currentUniqueOnPage: false })
    expect(classifyChange(change)).toBe('other')
  })

  it('classifies safe -> safe as other', () => {
    const change = makeChange({ baselineStable: true, baselineUniqueOnPage: true, currentStable: true, currentUniqueOnPage: true })
    expect(classifyChange(change)).toBe('other')
  })
})

describe('renderDiffReportMarkdown', () => {
  it('states nothing changed in every section for a fully empty diff', () => {
    const markdown = renderDiffReportMarkdown(makeDiff({}))
    expect(markdown).toContain('No pages added.')
    expect(markdown).toContain('No pages removed.')
    expect(markdown).toContain('No title changes found.')
    expect(markdown).toContain('No selector candidate changes found.')
    expect(markdown).not.toContain('| URL | Element | Before | After |')
    expect(markdown).toContain('0 pages added, 0 pages removed, 0 title changes, 0 selector regressions, 0 selector improvements, 0 other selector changes')
  })

  it('populates page-level sections and states no selector changes when there are none', () => {
    const diff = makeDiff({
      pagesAdded: ['https://example.com/new'],
      pagesRemoved: ['https://example.com/old'],
      titleChanges: [{ url: 'https://example.com/page', baselineTitle: 'Old Title', currentTitle: 'New Title' }],
    })
    const markdown = renderDiffReportMarkdown(diff)
    expect(markdown).toContain('https://example.com/new')
    expect(markdown).toContain('https://example.com/old')
    expect(markdown).toContain('| https://example.com/page | Old Title | New Title |')
    expect(markdown).toContain('No selector candidate changes found.')
  })

  it('renders a true regression under Regressions only', () => {
    const change = makeChange({ baselineStable: true, baselineUniqueOnPage: true, currentStable: false, currentUniqueOnPage: true })
    const markdown = renderDiffReportMarkdown(makeDiff({ selectorCandidateChanges: [change] }))
    const regressionsSection = markdown.split('### Improvements')[0]!
    const restOfReport = markdown.split('### Improvements')[1]!
    expect(regressionsSection).toContain("button 'Submit'")
    expect(restOfReport).not.toContain("button 'Submit'")
  })

  it('renders a true improvement under Improvements only', () => {
    const change = makeChange({ baselineStable: false, baselineUniqueOnPage: true, currentStable: true, currentUniqueOnPage: true })
    const markdown = renderDiffReportMarkdown(makeDiff({ selectorCandidateChanges: [change] }))
    const [beforeImprovements, afterImprovements] = markdown.split('### Improvements')
    const [improvementsSection, otherSection] = afterImprovements!.split('### Other')
    expect(beforeImprovements).not.toContain("button 'Submit'")
    expect(improvementsSection).toContain("button 'Submit'")
    expect(otherSection).not.toContain("button 'Submit'")
  })

  it('renders a change that flips without crossing the safe/unsafe line under Other only', () => {
    const change = makeChange({ baselineStable: false, baselineUniqueOnPage: false, currentStable: true, currentUniqueOnPage: false })
    const markdown = renderDiffReportMarkdown(makeDiff({ selectorCandidateChanges: [change] }))
    const [beforeOther, otherSection] = markdown.split('### Other')
    expect(beforeOther).not.toContain("button 'Submit'")
    expect(otherSection).toContain("button 'Submit'")
  })

  it('renders multiple regressions across different URLs with a matching summary count', () => {
    const changeOne = makeChange({
      url: 'https://example.com/a',
      baselineStable: true,
      baselineUniqueOnPage: true,
      currentStable: false,
      currentUniqueOnPage: true,
    })
    const changeTwo = makeChange({
      url: 'https://example.com/b',
      accessibleName: 'Cancel',
      baselineStable: true,
      baselineUniqueOnPage: true,
      currentStable: true,
      currentUniqueOnPage: false,
    })
    const markdown = renderDiffReportMarkdown(makeDiff({ selectorCandidateChanges: [changeOne, changeTwo] }))
    expect(markdown).toContain('2 selector regressions')
    const regressionsSection = markdown.split('### Improvements')[0]!
    expect(regressionsSection).toContain('https://example.com/a')
    expect(regressionsSection).toContain('https://example.com/b')
  })

  it('appends the occurrence index only when greater than 0', () => {
    const changeWithoutIndex = makeChange({ occurrenceIndex: 0, baselineStable: true, baselineUniqueOnPage: true, currentStable: false, currentUniqueOnPage: true })
    const changeWithIndex = makeChange({
      url: 'https://example.com/other',
      occurrenceIndex: 2,
      baselineStable: true,
      baselineUniqueOnPage: true,
      currentStable: false,
      currentUniqueOnPage: true,
    })
    const markdown = renderDiffReportMarkdown(makeDiff({ selectorCandidateChanges: [changeWithoutIndex, changeWithIndex] }))
    expect(markdown).toContain("button 'Submit' |")
    expect(markdown).toContain("button 'Submit' [2] |")
  })
})
