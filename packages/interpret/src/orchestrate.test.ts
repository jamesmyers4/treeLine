import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { openCrawlDb } from '@treeline/core'
import type { PageState } from '@treeline/acquire'
import type { PageInterpretation } from './types.js'

vi.mock('./interpret.js', () => ({
  interpretPage: vi.fn()
}))

import { interpretPage } from './interpret.js'
import { runInterpretation } from './orchestrate.js'

function makePageState(url: string): PageState {
  return {
    url,
    title: 'Test Page',
    ariaSnapshot: 'heading "Welcome"\nlink "Home"',
    links: [],
    networkLog: [],
    screenshot: null,
    capturedAt: '2026-01-01T00:00:00.000Z',
    interactiveElements: []
  }
}

const mockInterpretation: PageInterpretation = {
  url: '',
  tierUsed: 'haiku',
  pageType: 'landing',
  purpose: 'Welcome users',
  keyDataEntities: [],
  confidence: 0.9
}

let tmpDir: string
let dbPath: string
let hardPagesDir: string

beforeEach(() => {
  vi.clearAllMocks()
  tmpDir = mkdtempSync(join(tmpdir(), 'treeline-orchestrate-'))
  dbPath = join(tmpDir, 'crawl.db')
  hardPagesDir = join(tmpDir, 'hard-pages')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('runInterpretation', () => {
  it('interprets a successfully-captured page and skips a failed-capture page', async () => {
    const db = openCrawlDb(dbPath)
    db.recordPageState(makePageState('https://example.com/ok'))
    db.markFailed('https://example.com/broken', 'timeout')
    db.close()
    vi.mocked(interpretPage).mockResolvedValue({ ...mockInterpretation, url: 'https://example.com/ok' })
    await runInterpretation(dbPath, hardPagesDir)
    expect(interpretPage).toHaveBeenCalledTimes(1)
    expect(interpretPage).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/ok' }))
    const verifyDb = openCrawlDb(dbPath)
    const stored = verifyDb.getInterpretation('https://example.com/ok')
    const missing = verifyDb.getInterpretation('https://example.com/broken')
    verifyDb.close()
    expect(stored).not.toBeNull()
    expect(stored?.pageType).toBe('landing')
    expect(missing).toBeNull()
  })

  it('does not re-interpret an already-interpreted page on a second run', async () => {
    const db = openCrawlDb(dbPath)
    db.recordPageState(makePageState('https://example.com/ok'))
    db.close()
    vi.mocked(interpretPage).mockResolvedValue({ ...mockInterpretation, url: 'https://example.com/ok' })
    await runInterpretation(dbPath, hardPagesDir)
    expect(interpretPage).toHaveBeenCalledTimes(1)
    await runInterpretation(dbPath, hardPagesDir)
    expect(interpretPage).toHaveBeenCalledTimes(1)
  })

  it('writes a hard-pages entry and continues past a page that throws', async () => {
    const db = openCrawlDb(dbPath)
    db.recordPageState(makePageState('https://example.com/fails'))
    db.recordPageState(makePageState('https://example.com/ok'))
    db.close()
    vi.mocked(interpretPage).mockImplementation(async (pageState: PageState) => {
      if (pageState.url === 'https://example.com/fails') throw new Error('boom')
      return { ...mockInterpretation, url: pageState.url }
    })
    await runInterpretation(dbPath, hardPagesDir)
    const verifyDb = openCrawlDb(dbPath)
    const failed = verifyDb.getInterpretation('https://example.com/fails')
    const succeeded = verifyDb.getInterpretation('https://example.com/ok')
    verifyDb.close()
    expect(failed).toBeNull()
    expect(succeeded).not.toBeNull()
    expect(existsSync(hardPagesDir)).toBe(true)
    expect(readdirSync(hardPagesDir).length).toBe(1)
  })
})
