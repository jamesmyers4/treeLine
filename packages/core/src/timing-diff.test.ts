import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { PageState } from '@treeline/acquire'
import { openCrawlDb } from './persistence.js'
import { diffPageLoadTiming, diffPageLoadTimingFromPages, type PageTimingRecord } from './timing-diff.js'

function makePage(url: string, pageLoadMs: number): PageState {
  return {
    url,
    title: 'Title',
    ariaSnapshot: '',
    links: [],
    networkLog: [],
    screenshot: null,
    capturedAt: new Date().toISOString(),
    pageLoadMs,
    interactiveElements: [],
    axeViolations: [],
    axeIncomplete: [],
    forms: [],
    colorPalette: [],
    assertableAttributes: [],
  }
}

function record(url: string, pageLoadMs: number | null): PageTimingRecord {
  return { url, pageLoadMs }
}

describe('diffPageLoadTimingFromPages', () => {
  it('reports a regression-shaped entry for a real percent increase past the noise threshold', () => {
    const baseline = new Map([['https://example.com/', record('https://example.com/', 800)]])
    const current = new Map([['https://example.com/', record('https://example.com/', 1600)]])

    const result = diffPageLoadTimingFromPages(baseline, current)

    expect(result).toEqual([
      { url: 'https://example.com/', baselinePageLoadMs: 800, currentPageLoadMs: 1600, percentChange: 100 },
    ])
  })

  it('reports an entry with negative percentChange for a real percent decrease past the noise threshold', () => {
    const baseline = new Map([['https://example.com/', record('https://example.com/', 2000)]])
    const current = new Map([['https://example.com/', record('https://example.com/', 800)]])

    const result = diffPageLoadTimingFromPages(baseline, current)

    expect(result).toEqual([
      { url: 'https://example.com/', baselinePageLoadMs: 2000, currentPageLoadMs: 800, percentChange: -60 },
    ])
  })

  it('produces no entry when the change is within the noise threshold', () => {
    const baseline = new Map([['https://example.com/', record('https://example.com/', 800)]])
    const current = new Map([['https://example.com/', record('https://example.com/', 900)]])

    const result = diffPageLoadTimingFromPages(baseline, current)

    expect(result).toEqual([])
  })

  it('excludes a page present in current only, without crashing', () => {
    const baseline = new Map<string, PageTimingRecord>()
    const current = new Map([['https://example.com/new', record('https://example.com/new', 5000)]])

    const result = diffPageLoadTimingFromPages(baseline, current)

    expect(result).toEqual([])
  })

  it('excludes a page present in baseline only, without crashing', () => {
    const baseline = new Map([['https://example.com/old', record('https://example.com/old', 800)]])
    const current = new Map<string, PageTimingRecord>()

    const result = diffPageLoadTimingFromPages(baseline, current)

    expect(result).toEqual([])
  })

  it('excludes a matched page when the baseline pageLoadMs is null, without crashing', () => {
    const baseline = new Map([['https://example.com/', record('https://example.com/', null)]])
    const current = new Map([['https://example.com/', record('https://example.com/', 5000)]])

    const result = diffPageLoadTimingFromPages(baseline, current)

    expect(result).toEqual([])
  })

  it('excludes a matched page when the current pageLoadMs is null, without crashing', () => {
    const baseline = new Map([['https://example.com/', record('https://example.com/', 800)]])
    const current = new Map([['https://example.com/', record('https://example.com/', null)]])

    const result = diffPageLoadTimingFromPages(baseline, current)

    expect(result).toEqual([])
  })
})

describe('diffPageLoadTiming', () => {
  let tmpDir: string
  let baselinePath: string
  let currentPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'treeline-timing-diff-test-'))
    baselinePath = join(tmpDir, 'baseline.db')
    currentPath = join(tmpDir, 'current.db')
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads pageLoadMs from real dbs and matches on normalized URL', () => {
    const baselineDb = openCrawlDb(baselinePath)
    baselineDb.recordPageState(makePage('https://example.com/about#team', 800))
    baselineDb.close()

    const currentDb = openCrawlDb(currentPath)
    currentDb.recordPageState(makePage('https://example.com/about', 1600))
    currentDb.close()

    const result = diffPageLoadTiming(baselinePath, currentPath)

    expect(result).toEqual([
      { url: 'https://example.com/about', baselinePageLoadMs: 800, currentPageLoadMs: 1600, percentChange: 100 },
    ])
  })
})
