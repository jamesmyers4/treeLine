import { describe, it, expect } from 'vitest'
import type { DomInteractiveElement } from '@treeline/acquire'
import type { StoredInterpretation } from '@treeline/core'
import type { CrawledPage } from './input.js'
import { generateAtlas, renderAtlasMarkdown } from './atlas.js'

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

function makeInterpretation(overrides: Partial<StoredInterpretation>): StoredInterpretation {
  return {
    url: 'https://example.com',
    tierUsed: 'haiku',
    pageType: 'form',
    purpose: 'Collect user signup details',
    keyDataEntities: ['user', 'email'],
    confidence: 0.95,
    interpretedAt: new Date().toISOString(),
    proposedAssertion: null,
    ...overrides,
  }
}

const interpretedPage = makePage({
  url: 'https://example.com/signup',
  title: 'Signup',
  interactiveElements: [
    makeElement({ testId: 'a' }),
    makeElement({ testId: null }),
  ],
})

const uninterpretedPage = makePage({
  url: 'https://example.com/about',
  title: 'About',
  interactiveElements: [makeElement({ testId: null })],
})

const failedCapturePage = makePage({
  url: 'https://example.com/broken',
  title: null,
  ariaSnapshot: null,
  capturedAt: null,
})

const interpretation = makeInterpretation({ url: 'https://example.com/signup', pageType: 'form', confidence: 0.97 })

describe('generateAtlas', () => {
  it('excludes pages that failed capture entirely', () => {
    const atlas = generateAtlas([interpretedPage, uninterpretedPage, failedCapturePage], [interpretation], false)
    const urls = atlas.pages.map((entry) => entry.url)
    expect(urls).toContain('https://example.com/signup')
    expect(urls).toContain('https://example.com/about')
    expect(urls).not.toContain('https://example.com/broken')
  })

  it('computes totalPagesCaptured and totalPagesInterpreted', () => {
    const atlas = generateAtlas([interpretedPage, uninterpretedPage, failedCapturePage], [interpretation], false)
    expect(atlas.totalPagesCaptured).toBe(2)
    expect(atlas.totalPagesInterpreted).toBe(1)
  })

  it('populates fields from a matching interpretation', () => {
    const atlas = generateAtlas([interpretedPage], [interpretation], false)
    const entry = atlas.pages.find((e) => e.url === 'https://example.com/signup')!
    expect(entry.interpreted).toBe(true)
    expect(entry.interpretationStatus).toBe('interpreted')
    expect(entry.pageType).toBe('form')
    expect(entry.purpose).toBe('Collect user signup details')
    expect(entry.keyDataEntities).toEqual(['user', 'email'])
    expect(entry.confidence).toBe(0.97)
    expect(entry.interactiveElementCount).toBe(2)
    expect(entry.testIdCount).toBe(1)
  })

  it('leaves an uninterpreted page with null/empty fields and does not throw', () => {
    expect(() => generateAtlas([uninterpretedPage], [], false)).not.toThrow()
    const atlas = generateAtlas([uninterpretedPage], [], false)
    const entry = atlas.pages[0]!
    expect(entry.interpreted).toBe(false)
    expect(entry.pageType).toBeNull()
    expect(entry.purpose).toBeNull()
    expect(entry.keyDataEntities).toEqual([])
    expect(entry.confidence).toBeNull()
  })

  it('marks an uninterpreted page "failed" when interpretation was not skipped for the crawl', () => {
    const atlas = generateAtlas([uninterpretedPage], [], false)
    expect(atlas.pages[0]!.interpretationStatus).toBe('failed')
  })

  it('marks an uninterpreted page "skipped" when --skip-interpretation was set for the crawl', () => {
    const atlas = generateAtlas([uninterpretedPage], [], true)
    const entry = atlas.pages[0]!
    expect(entry.interpreted).toBe(false)
    expect(entry.interpretationStatus).toBe('skipped')
  })

  it('still marks a page "interpreted" even when skipInterpretation is true, if a stored interpretation exists (e.g. a resumed crawl)', () => {
    const atlas = generateAtlas([interpretedPage], [interpretation], true)
    expect(atlas.pages[0]!.interpretationStatus).toBe('interpreted')
  })
})

describe('renderAtlasMarkdown', () => {
  it('renders the overview table and page headings', () => {
    const atlas = generateAtlas([interpretedPage, uninterpretedPage, failedCapturePage], [interpretation], false)
    const markdown = renderAtlasMarkdown(atlas)
    expect(markdown).toContain('| URL | Page Type | Confidence | Interpretation | Interactive Elements | Test IDs |')
    expect(markdown).toContain('## Signup')
    expect(markdown).toContain('## About')
  })

  it('renders a distinct "failed" note when interpretation was attempted but failed, not the skipped wording', () => {
    const atlas = generateAtlas([uninterpretedPage], [], false)
    const markdown = renderAtlasMarkdown(atlas)
    expect(markdown).toContain('This page failed interpretation. Check hard-pages/ for details.')
    expect(markdown).not.toContain('--skip-interpretation')
    expect(markdown).toContain('| Failed |')
  })

  it('renders a distinct "skipped" note when --skip-interpretation was set, not the failed wording', () => {
    const atlas = generateAtlas([uninterpretedPage], [], true)
    const markdown = renderAtlasMarkdown(atlas)
    expect(markdown).toContain('This page was not interpreted — `--skip-interpretation` was set for this crawl.')
    expect(markdown).not.toContain('failed interpretation')
    expect(markdown).toContain('| Skipped |')
  })

  it('renders "Interpreted" in the overview table for a genuinely interpreted page', () => {
    const atlas = generateAtlas([interpretedPage], [interpretation], false)
    const markdown = renderAtlasMarkdown(atlas)
    expect(markdown).toContain('| Interpreted |')
  })
})
