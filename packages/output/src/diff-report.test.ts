import { describe, it, expect } from 'vitest'
import type { CrawlDiff, SelectorCandidateChange, VisualChange } from '@treeline/core'
import { urlHash } from '@treeline/core'
import { classifyChange, renderDiffReportMarkdown } from './diff-report.js'

function makeDiff(overrides: Partial<CrawlDiff>): CrawlDiff {
  return {
    baselineDbPath: 'baseline.db',
    currentDbPath: 'current.db',
    pagesAdded: [],
    pagesRemoved: [],
    titleChanges: [],
    selectorCandidateChanges: [],
    visualChanges: [],
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

function makeVisualChange(overrides: Partial<VisualChange>): VisualChange {
  return {
    url: 'https://example.com',
    method: 'pixel-diff',
    status: 'changed',
    diffPixelCount: 42,
    diffPixelPercent: 4.2,
    diffImageBuffer: null,
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
    expect(markdown).toContain(
      '0 pages added, 0 pages removed, 0 title changes, 0 selector regressions, 0 selector improvements, 0 other selector changes, 0 visual changes',
    )
    expect(markdown).toContain('No visual changes found.')
    expect(markdown).not.toContain('### Changed')
    expect(markdown).not.toContain('### Could Not Compare')
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

  it('states plainly that nothing changed when every visual change is unchanged', () => {
    const markdown = renderDiffReportMarkdown(
      makeDiff({ visualChanges: [makeVisualChange({ status: 'unchanged', diffPixelCount: 0, diffPixelPercent: 0 })] }),
    )
    expect(markdown).toContain('No visual changes found.')
    expect(markdown).not.toContain('### Changed')
    expect(markdown).not.toContain('### Could Not Compare')
  })

  it('renders a changed page with URL, diff percent, and the exact expected image path', () => {
    const change = makeVisualChange({ url: 'https://example.com/pricing', diffPixelPercent: 12.345 })
    const markdown = renderDiffReportMarkdown(makeDiff({ visualChanges: [change] }))
    const expectedPath = `visual-diffs/${urlHash('https://example.com/pricing')}.png`
    expect(markdown).toContain('https://example.com/pricing')
    expect(markdown).toContain('12.3%')
    expect(markdown).toContain(`![Visual diff](${expectedPath})`)
  })

  it('renders multiple changed pages with a matching summary count', () => {
    const changeOne = makeVisualChange({ url: 'https://example.com/a' })
    const changeTwo = makeVisualChange({ url: 'https://example.com/b' })
    const markdown = renderDiffReportMarkdown(makeDiff({ visualChanges: [changeOne, changeTwo] }))
    expect(markdown).toContain('2 visual changes')
    expect(markdown).toContain('https://example.com/a')
    expect(markdown).toContain('https://example.com/b')
  })

  it('lists a page that could not be compared separately, with no image reference', () => {
    const uncomparable = makeVisualChange({
      url: 'https://example.com/broken',
      status: 'dimensions-changed',
      diffPixelCount: null,
      diffPixelPercent: null,
    })
    const markdown = renderDiffReportMarkdown(makeDiff({ visualChanges: [uncomparable] }))
    const [, couldNotCompareSection] = markdown.split('### Could Not Compare')
    expect(couldNotCompareSection).toContain('https://example.com/broken (dimensions-changed)')
    expect(markdown).not.toContain('visual-diffs/')
    expect(markdown).toContain('0 visual changes')
  })

  it('only lists changed pages in the main table, excluding unchanged ones', () => {
    const changed = makeVisualChange({ url: 'https://example.com/changed' })
    const unchanged = makeVisualChange({ url: 'https://example.com/unchanged', status: 'unchanged', diffPixelCount: 0, diffPixelPercent: 0 })
    const markdown = renderDiffReportMarkdown(makeDiff({ visualChanges: [changed, unchanged] }))
    const changedSection = markdown.split('### Could Not Compare')[0]!
    expect(changedSection).toContain('https://example.com/changed')
    expect(markdown).not.toContain('https://example.com/unchanged')
  })

  it('separately reports a mix of baseline-missing and current-missing pages', () => {
    const baselineMissing = makeVisualChange({ url: 'https://example.com/new-page', status: 'baseline-missing', diffPixelCount: null, diffPixelPercent: null })
    const currentMissing = makeVisualChange({ url: 'https://example.com/removed-page', status: 'current-missing', diffPixelCount: null, diffPixelPercent: null })
    const markdown = renderDiffReportMarkdown(makeDiff({ visualChanges: [baselineMissing, currentMissing] }))
    const [, couldNotCompareSection] = markdown.split('### Could Not Compare')
    expect(couldNotCompareSection).toContain('https://example.com/new-page (baseline-missing)')
    expect(couldNotCompareSection).toContain('https://example.com/removed-page (current-missing)')
  })
})
