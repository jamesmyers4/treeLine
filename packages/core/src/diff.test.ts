import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DomInteractiveElement, PageState } from '@treeline/acquire'
import { openCrawlDb } from './persistence.js'
import { diffCrawls, diffSelectorCandidates } from './diff.js'

function makePage(url: string, title: string, interactiveElements: DomInteractiveElement[] = []): PageState {
  return {
    url,
    title,
    ariaSnapshot: '',
    links: [],
    networkLog: [],
    screenshot: null,
    capturedAt: new Date().toISOString(),
    pageLoadMs: 500,
    interactiveElements,
    axeViolations: [],
    axeIncomplete: [],
    forms: [],
  }
}

function makeElement(overrides: Partial<DomInteractiveElement>): DomInteractiveElement {
  return {
    role: 'generic',
    accessibleName: '',
    testId: null,
    tagName: 'div',
    elementId: null,
    classList: [],
    cssPath: 'body > div',
    xpath: '/html/body/div',
    ...overrides,
  }
}

function seedDb(dbPath: string, pages: PageState[]): void {
  const db = openCrawlDb(dbPath)
  for (const page of pages) {
    db.recordPageState(page)
  }
  db.close()
}

let tmpDir: string
let baselinePath: string
let currentPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'treeline-diff-test-'))
  baselinePath = join(tmpDir, 'baseline.db')
  currentPath = join(tmpDir, 'current.db')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('diffCrawls', () => {
  it('reports no changes for two identical dbs', () => {
    const pages = [makePage('https://example.com/', 'Home'), makePage('https://example.com/about', 'About')]
    seedDb(baselinePath, pages)
    seedDb(currentPath, pages)

    const result = diffCrawls(baselinePath, currentPath)

    expect(result.pagesAdded).toEqual([])
    expect(result.pagesRemoved).toEqual([])
    expect(result.titleChanges).toEqual([])
  })

  it('reports a page present only in current as added', () => {
    seedDb(baselinePath, [makePage('https://example.com/', 'Home')])
    seedDb(currentPath, [makePage('https://example.com/', 'Home'), makePage('https://example.com/new', 'New Page')])

    const result = diffCrawls(baselinePath, currentPath)

    expect(result.pagesAdded).toEqual(['https://example.com/new'])
    expect(result.pagesRemoved).toEqual([])
  })

  it('reports a page present only in baseline as removed', () => {
    seedDb(baselinePath, [makePage('https://example.com/', 'Home'), makePage('https://example.com/old', 'Old Page')])
    seedDb(currentPath, [makePage('https://example.com/', 'Home')])

    const result = diffCrawls(baselinePath, currentPath)

    expect(result.pagesRemoved).toEqual(['https://example.com/old'])
    expect(result.pagesAdded).toEqual([])
  })

  it('reports a title change for the same normalized URL', () => {
    seedDb(baselinePath, [makePage('https://example.com/', 'Old Title')])
    seedDb(currentPath, [makePage('https://example.com/', 'New Title')])

    const result = diffCrawls(baselinePath, currentPath)

    expect(result.titleChanges).toEqual([
      { url: 'https://example.com/', baselineTitle: 'Old Title', currentTitle: 'New Title' },
    ])
  })

  it('does not report a title change when titles match', () => {
    seedDb(baselinePath, [makePage('https://example.com/', 'Same Title')])
    seedDb(currentPath, [makePage('https://example.com/', 'Same Title')])

    const result = diffCrawls(baselinePath, currentPath)

    expect(result.titleChanges).toEqual([])
  })

  it('treats URLs differing only by fragment or query-param order as the same page', () => {
    seedDb(baselinePath, [
      makePage('https://example.com/about#team', 'About'),
      makePage('https://example.com/shop?b=2&a=1', 'Shop'),
    ])
    seedDb(currentPath, [
      makePage('https://example.com/about', 'About'),
      makePage('https://example.com/shop?a=1&b=2', 'Shop'),
    ])

    const result = diffCrawls(baselinePath, currentPath)

    expect(result.pagesAdded).toEqual([])
    expect(result.pagesRemoved).toEqual([])
    expect(result.titleChanges).toEqual([])
  })

  it('treats every page as added when baseline is empty', () => {
    seedDb(baselinePath, [])
    seedDb(currentPath, [makePage('https://example.com/', 'Home'), makePage('https://example.com/about', 'About')])

    const result = diffCrawls(baselinePath, currentPath)

    expect(result.pagesAdded.sort()).toEqual(['https://example.com/', 'https://example.com/about'])
    expect(result.pagesRemoved).toEqual([])
    expect(result.titleChanges).toEqual([])
  })

  it('treats every page as removed when current is empty', () => {
    seedDb(baselinePath, [makePage('https://example.com/', 'Home'), makePage('https://example.com/about', 'About')])
    seedDb(currentPath, [])

    const result = diffCrawls(baselinePath, currentPath)

    expect(result.pagesRemoved.sort()).toEqual(['https://example.com/', 'https://example.com/about'])
    expect(result.pagesAdded).toEqual([])
    expect(result.titleChanges).toEqual([])
  })
})

describe('selectorCandidateChanges', () => {
  it('reports no changes for two identical runs', () => {
    const el = makeElement({ role: 'link', accessibleName: 'About', cssPath: 'header > a.about', xpath: '/html/body/header/a' })
    seedDb(baselinePath, [makePage('https://example.com/', 'Home', [el])])
    seedDb(currentPath, [makePage('https://example.com/', 'Home', [el])])

    const result = diffCrawls(baselinePath, currentPath)

    expect(result.selectorCandidateChanges).toEqual([])
  })

  it('reports a stable flip true to false with correct baseline/current values', () => {
    const baselineEl = makeElement({ cssPath: 'body > div.card', xpath: '/html/body/div[1]' })
    const currentEl = makeElement({ cssPath: 'body > div:nth-of-type(2)', xpath: '/html/body/div[1]' })
    seedDb(baselinePath, [makePage('https://example.com/', 'Home', [baselineEl])])
    seedDb(currentPath, [makePage('https://example.com/', 'Home', [currentEl])])

    const result = diffCrawls(baselinePath, currentPath)

    expect(result.selectorCandidateChanges).toEqual([
      {
        url: 'https://example.com/',
        role: 'generic',
        accessibleName: '',
        occurrenceIndex: 0,
        baselineStable: true,
        baselineUniqueOnPage: true,
        currentStable: false,
        currentUniqueOnPage: true,
      },
    ])
  })

  it('reports a uniqueOnPage flip with correct baseline/current values', () => {
    const baselineElements = [
      makeElement({ testId: 'about-a', cssPath: 'header > a.about', xpath: '/html/body/header/a' }),
    ]
    const currentElements = [
      makeElement({ testId: 'about-a', cssPath: 'header > a.about', xpath: '/html/body/header/a' }),
      makeElement({
        role: 'button',
        accessibleName: 'Duplicate',
        testId: 'about-a',
        cssPath: 'footer > button.dup',
        xpath: '/html/body/footer/button',
      }),
    ]
    seedDb(baselinePath, [makePage('https://example.com/', 'Home', baselineElements)])
    seedDb(currentPath, [makePage('https://example.com/', 'Home', currentElements)])

    const result = diffCrawls(baselinePath, currentPath)

    expect(result.selectorCandidateChanges).toEqual([
      {
        url: 'https://example.com/',
        role: 'generic',
        accessibleName: '',
        occurrenceIndex: 0,
        baselineStable: true,
        baselineUniqueOnPage: true,
        currentStable: true,
        currentUniqueOnPage: false,
      },
    ])
  })

  it('excludes an element whose cssPath/xpath differs but stable/uniqueOnPage are unchanged', () => {
    const baselineEl = makeElement({ cssPath: 'body > div.card', xpath: '/html/body/div[1]' })
    const currentEl = makeElement({ cssPath: 'body > div.card-v2', xpath: '/html/body/div[2]' })
    seedDb(baselinePath, [makePage('https://example.com/', 'Home', [baselineEl])])
    seedDb(currentPath, [makePage('https://example.com/', 'Home', [currentEl])])

    const result = diffCrawls(baselinePath, currentPath)

    expect(result.selectorCandidateChanges).toEqual([])
  })

  it('does not report elements from a page removed in current', () => {
    const el = makeElement({ cssPath: 'body > div:nth-of-type(2)', xpath: '/html/body/div[1]' })
    seedDb(baselinePath, [
      makePage('https://example.com/', 'Home', []),
      makePage('https://example.com/old', 'Old Page', [el]),
    ])
    seedDb(currentPath, [makePage('https://example.com/', 'Home', [])])

    const result = diffCrawls(baselinePath, currentPath)

    expect(result.pagesRemoved).toEqual(['https://example.com/old'])
    expect(result.selectorCandidateChanges).toEqual([])
  })

  it('matches duplicate role+accessibleName elements by occurrenceIndex without cross-matching', () => {
    const baselineElements = [
      makeElement({ cssPath: 'header > a.item', xpath: '/html/body/header/a' }),
      makeElement({ cssPath: 'footer > a.item', xpath: '/html/body/footer/a' }),
    ]
    const currentElements = [
      makeElement({ cssPath: 'header > a:nth-of-type(3)', xpath: '/html/body/header/a' }),
      makeElement({ cssPath: 'footer > a.item', xpath: '/html/body/footer/a' }),
    ]
    seedDb(baselinePath, [makePage('https://example.com/', 'Home', baselineElements)])
    seedDb(currentPath, [makePage('https://example.com/', 'Home', currentElements)])

    const result = diffCrawls(baselinePath, currentPath)

    expect(result.selectorCandidateChanges).toEqual([
      {
        url: 'https://example.com/',
        role: 'generic',
        accessibleName: '',
        occurrenceIndex: 0,
        baselineStable: true,
        baselineUniqueOnPage: true,
        currentStable: false,
        currentUniqueOnPage: true,
      },
    ])
  })

  it('excludes an element newly added in current with no counterpart at that occurrenceIndex in baseline', () => {
    const baselineElements = [makeElement({ cssPath: 'header > a.item', xpath: '/html/body/header/a' })]
    const currentElements = [
      makeElement({ cssPath: 'header > a.item', xpath: '/html/body/header/a' }),
      makeElement({ cssPath: 'header > a.item-2', xpath: '/html/body/header/a[2]' }),
    ]
    seedDb(baselinePath, [makePage('https://example.com/', 'Home', baselineElements)])
    seedDb(currentPath, [makePage('https://example.com/', 'Home', currentElements)])

    const result = diffCrawls(baselinePath, currentPath)

    expect(result.selectorCandidateChanges.filter((c) => c.occurrenceIndex === 1)).toEqual([])
    expect(result.selectorCandidateChanges).toEqual([])
  })
})

describe('diffSelectorCandidates', () => {
  it('is independently callable and returns the same result as diffCrawls.selectorCandidateChanges', () => {
    const baselineEl = makeElement({ cssPath: 'body > div.card', xpath: '/html/body/div[1]' })
    const currentEl = makeElement({ cssPath: 'body > div:nth-of-type(2)', xpath: '/html/body/div[1]' })
    seedDb(baselinePath, [makePage('https://example.com/', 'Home', [baselineEl])])
    seedDb(currentPath, [makePage('https://example.com/', 'Home', [currentEl])])

    const direct = diffSelectorCandidates(baselinePath, currentPath)
    const viaDiffCrawls = diffCrawls(baselinePath, currentPath).selectorCandidateChanges

    expect(direct).toEqual(viaDiffCrawls)
    expect(direct).toHaveLength(1)
  })
})
