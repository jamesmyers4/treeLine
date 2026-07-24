import { describe, expect, it, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openCrawlDb } from '@treeline/core'
import type { CrawlConfig } from '@treeline/core'
import { buildRunMeta } from './meta.js'

const tmpDirs: string[] = []

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'treeline-pages-meta-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir) await fs.rm(dir, { recursive: true, force: true })
  }
})

describe('buildRunMeta', () => {
  it('returns null targetUrl and pageCount when there is no crawl.sqlite in the output dir', () => {
    const meta = buildRunMeta('/some/dir/without/a/db', 'crawl')
    expect(meta.targetUrl).toBeNull()
    expect(meta.pageCount).toBeNull()
    expect(meta.mode).toBe('crawl')
    expect(typeof meta.renderedAt).toBe('string')
  })

  it('reads seedUrl and page count from a real crawl.sqlite', async () => {
    const outputDir = await makeTmpDir()
    const dbPath = path.join(outputDir, 'crawl.sqlite')
    const config: CrawlConfig = {
      seedUrl: 'https://example.com/',
      sameOriginOnly: true,
      maxDepth: 2,
      maxPages: 20,
      stealth: false,
      respectRobotsTxt: true,
      throttleMs: 500,
    }
    const db = openCrawlDb(dbPath)
    db.insertMeta('https://example.com/', config)
    db.recordPageState({
      url: 'https://example.com/',
      title: 'Example',
      ariaSnapshot: '',
      links: [],
      networkLog: [],
      screenshot: null,
      capturedAt: new Date().toISOString(),
      pageLoadMs: 500,
      interactiveElements: [],
      axeViolations: [],
      axeIncomplete: [],
      forms: [],
      colorPalette: [],
      assertableAttributes: [],
    })
    db.close()

    const meta = buildRunMeta(outputDir, 'crawl')
    expect(meta.targetUrl).toBe('https://example.com/')
    expect(meta.pageCount).toBe(1)
    expect(meta.mode).toBe('crawl')
  })

  it('reports the mode passed in, independent of what is in the db', async () => {
    const outputDir = await makeTmpDir()
    const dbPath = path.join(outputDir, 'crawl.sqlite')
    const db = openCrawlDb(dbPath)
    db.close()

    const meta = buildRunMeta(outputDir, 'diff')
    expect(meta.mode).toBe('diff')
    expect(meta.targetUrl).toBeNull()
    expect(meta.pageCount).toBe(0)
  })
})
