import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { crawl } from './crawler.js'
import { openCrawlDb } from './persistence.js'
import { writeHardPageEntry } from './hard-pages.js'
import type { CrawlConfig } from './types.js'

let server: Server
let otherOriginServer: Server
let baseUrl: string
let otherOrigin: string
let tmpDir: string

function html(body: string): string {
  return `<html><head><title>t</title></head><body>${body}</body></html>`
}

beforeAll(async () => {
  otherOriginServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html('<a href="/elsewhere">elsewhere</a>'))
  })
  await new Promise<void>((resolve) => otherOriginServer.listen(0, '127.0.0.1', resolve))
  otherOrigin = `http://127.0.0.1:${(otherOriginServer.address() as { port: number }).port}`
  server = createServer((req, res) => {
    const path = req.url ?? '/'
    if (path === '/old') {
      res.writeHead(301, { Location: '/new/' })
      res.end()
      return
    }
    if (path === '/out') {
      res.writeHead(302, { Location: `${otherOrigin}/landing` })
      res.end()
      return
    }
    const bodies: Record<string, string> = {
      '/': html('<a href="/a">a</a><a href="/b">b</a>'),
      '/a': html('<a href="/c">c</a>'),
      '/b': html('b'),
      '/c': html('c'),
      '/new/': html('new'),
      '/redirects': html('<a href="/old">old</a><a href="/new">new</a><a href="/out">out</a><a href="/missing">missing</a>'),
    }
    const body = bodies[path]
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'text/html' })
    res.end(body ?? html('not found'))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  tmpDir = mkdtempSync(join(tmpdir(), 'treeline-resume-redirect-test-'))
})

afterAll(() => {
  server.close()
  otherOriginServer.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

function config(seedPath: string, maxPages: number): CrawlConfig {
  return {
    seedUrl: `${baseUrl}${seedPath}`,
    sameOriginOnly: true,
    maxDepth: 5,
    maxPages,
    stealth: false,
    headless: true,
    respectRobotsTxt: false,
    throttleMs: 0,
  }
}

function storedUrls(dbPath: string): string[] {
  const db = openCrawlDb(dbPath)
  try {
    return db.getAllPages().map((p) => p.url).sort()
  } finally {
    db.close()
  }
}

describe('crawl — resuming a truncated crawl', () => {
  it('re-queues the stored links of already-captured pages, so a resumed run continues past where the last one stopped', async () => {
    const outDir = join(tmpDir, 'resume')
    const dbPath = join(outDir, 'crawl.sqlite')
    const hardPagesDir = join(outDir, 'hard-pages')
    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(outDir, { recursive: true })
    await crawl(config('/', 1), dbPath, hardPagesDir)
    expect(storedUrls(dbPath)).toEqual([`${baseUrl}/`])
    await crawl(config('/', 10), dbPath, hardPagesDir)
    expect(storedUrls(dbPath)).toEqual([`${baseUrl}/`, `${baseUrl}/a`, `${baseUrl}/b`, `${baseUrl}/c`])
  }, 60000)

  it('still respects maxDepth for links re-queued from a stored page', async () => {
    const outDir = join(tmpDir, 'resume-depth')
    const dbPath = join(outDir, 'crawl.sqlite')
    const hardPagesDir = join(outDir, 'hard-pages')
    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(outDir, { recursive: true })
    await crawl(config('/', 1), dbPath, hardPagesDir)
    await crawl({ ...config('/', 10), maxDepth: 1 }, dbPath, hardPagesDir)
    expect(storedUrls(dbPath)).toEqual([`${baseUrl}/`, `${baseUrl}/a`, `${baseUrl}/b`])
  }, 60000)
})

describe('crawl — redirects and HTTP status', () => {
  const outDir = () => join(tmpDir, 'redirects')
  let result: Awaited<ReturnType<typeof crawl>>
  let warnings: string[]

  beforeAll(async () => {
    rmSync(outDir(), { recursive: true, force: true })
    mkdirSync(outDir(), { recursive: true })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    result = await crawl(config('/redirects', 20), join(outDir(), 'crawl.sqlite'), join(outDir(), 'hard-pages'))
    warnings = warnSpy.mock.calls.map((call) => String(call[0]))
    warnSpy.mockRestore()
  }, 120000)

  it('records a same-origin redirect under its final URL once, not under the requested URL as well', () => {
    const urls = storedUrls(join(outDir(), 'crawl.sqlite'))
    expect(urls).toContain(`${baseUrl}/new`)
    expect(urls).not.toContain(`${baseUrl}/old`)
    expect(urls.filter((u) => u === `${baseUrl}/new`)).toHaveLength(1)
  })

  it('keeps the real, unnormalized final URL (trailing slash included) alongside the normalized key', () => {
    const db = openCrawlDb(join(outDir(), 'crawl.sqlite'))
    try {
      const page = db.getAllPages().find((p) => p.url === `${baseUrl}/new`)!
      expect(page.finalUrl).toBe(`${baseUrl}/new/`)
      expect(page.httpStatus).toBe(200)
    } finally {
      db.close()
    }
  })

  it('does not record a page that redirected off-origin, and reports it with a warning instead', () => {
    const urls = storedUrls(join(outDir(), 'crawl.sqlite'))
    expect(urls).not.toContain(`${baseUrl}/out`)
    expect(urls.some((u) => u.startsWith(otherOrigin))).toBe(false)
    expect(result.offOriginRedirects).toEqual([{ url: `${baseUrl}/out`, finalUrl: `${otherOrigin}/landing` }])
    expect(warnings.some((message) => message.includes('redirected off-origin'))).toBe(true)
  })

  it('records the real HTTP status of a page that returned 404', () => {
    const db = openCrawlDb(join(outDir(), 'crawl.sqlite'))
    try {
      const page = db.getAllPages().find((p) => p.url === `${baseUrl}/missing`)!
      expect(page.httpStatus).toBe(404)
    } finally {
      db.close()
    }
  })
})

describe('crawl — hard-pages entries are cleared once the page succeeds', () => {
  it('removes a stale hard-pages entry for a URL that captures successfully on a later run', async () => {
    const outDir = join(tmpDir, 'hard-pages-clear')
    const hardPagesDir = join(outDir, 'hard-pages')
    rmSync(outDir, { recursive: true, force: true })
    mkdirSync(outDir, { recursive: true })
    writeHardPageEntry(hardPagesDir, { url: `${baseUrl}/b`, reasonCode: 'auth-expired', attemptedAt: new Date().toISOString(), captureSnapshot: null })
    writeHardPageEntry(hardPagesDir, { url: `${baseUrl}/never-crawled`, reasonCode: 'timeout', attemptedAt: new Date().toISOString(), captureSnapshot: null })
    expect(readdirSync(hardPagesDir)).toHaveLength(2)
    await crawl(config('/', 10), join(outDir, 'crawl.sqlite'), hardPagesDir)
    const remaining = readdirSync(hardPagesDir)
    expect(remaining).toHaveLength(1)
    expect(existsSync(join(hardPagesDir, remaining[0]!))).toBe(true)
  }, 60000)
})
