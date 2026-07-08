import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { PageState } from '@treeline/acquire'
import { openCrawlDb } from './persistence.js'
import { diffCrawls } from './diff.js'

function makePage(url: string, title: string): PageState {
  return {
    url,
    title,
    ariaSnapshot: '',
    links: [],
    networkLog: [],
    screenshot: null,
    capturedAt: new Date().toISOString(),
    interactiveElements: [],
    axeViolations: [],
    axeIncomplete: [],
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
