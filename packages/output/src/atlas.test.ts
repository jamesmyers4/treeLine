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
    screenshot: null,
    capturedAt: new Date().toISOString(),
    interactiveElements: [],
    axeViolations: [],
    axeIncomplete: [],
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
    const atlas = generateAtlas([interpretedPage, uninterpretedPage, failedCapturePage], [interpretation])
    const urls = atlas.pages.map((entry) => entry.url)
    expect(urls).toContain('https://example.com/signup')
    expect(urls).toContain('https://example.com/about')
    expect(urls).not.toContain('https://example.com/broken')
  })

  it('computes totalPagesCaptured and totalPagesInterpreted', () => {
    const atlas = generateAtlas([interpretedPage, uninterpretedPage, failedCapturePage], [interpretation])
    expect(atlas.totalPagesCaptured).toBe(2)
    expect(atlas.totalPagesInterpreted).toBe(1)
  })

  it('populates fields from a matching interpretation', () => {
    const atlas = generateAtlas([interpretedPage], [interpretation])
    const entry = atlas.pages.find((e) => e.url === 'https://example.com/signup')!
    expect(entry.interpreted).toBe(true)
    expect(entry.pageType).toBe('form')
    expect(entry.purpose).toBe('Collect user signup details')
    expect(entry.keyDataEntities).toEqual(['user', 'email'])
    expect(entry.confidence).toBe(0.97)
    expect(entry.interactiveElementCount).toBe(2)
    expect(entry.testIdCount).toBe(1)
  })

  it('leaves an uninterpreted page with null/empty fields and does not throw', () => {
    expect(() => generateAtlas([uninterpretedPage], [])).not.toThrow()
    const atlas = generateAtlas([uninterpretedPage], [])
    const entry = atlas.pages[0]!
    expect(entry.interpreted).toBe(false)
    expect(entry.pageType).toBeNull()
    expect(entry.purpose).toBeNull()
    expect(entry.keyDataEntities).toEqual([])
    expect(entry.confidence).toBeNull()
  })
})

describe('renderAtlasMarkdown', () => {
  it('renders the overview table, page headings, and an uninterpreted note', () => {
    const atlas = generateAtlas([interpretedPage, uninterpretedPage, failedCapturePage], [interpretation])
    const markdown = renderAtlasMarkdown(atlas)
    expect(markdown).toContain('| URL | Page Type | Confidence | Interpreted | Interactive Elements | Test IDs |')
    expect(markdown).toContain('## Signup')
    expect(markdown).toContain('## About')
    expect(markdown).toContain('This page has not yet been interpreted. Check hard-pages/ for details.')
  })
})
