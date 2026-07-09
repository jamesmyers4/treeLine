import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { crawl } from './crawler.js'
import { openCrawlDb } from './persistence.js'

const pages: Record<string, string> = {
  '/': '<html><body><a href="/about">about</a><a href="/contact">contact</a><a href="/never">never</a></body></html>',
  '/about': '<html><body><a href="/">home</a></body></html>',
  '/contact': '<html><body><a href="/">home</a></body></html>',
  '/never': '<html><body>never reached</body></html>',
}

let server: Server
let baseUrl: string
let tmpDir: string
let dbPath: string

beforeAll(async () => {
  server = createServer((req, res) => {
    const html = pages[req.url ?? '/'] ?? '<html><body>not found</body></html>'
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${addr.port}`
  tmpDir = mkdtempSync(join(tmpdir(), 'treeline-test-'))
  dbPath = join(tmpDir, 'crawl.db')
})

afterAll(() => {
  server.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('crawl', () => {
  it('captures 3 interlinked pages and skips the 4th beyond maxPages', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await crawl(
      {
        seedUrl: `${baseUrl}/`,
        sameOriginOnly: true,
        maxDepth: 5,
        maxPages: 3,
        stealth: false,
        respectRobotsTxt: false,
        throttleMs: 0,
      },
      dbPath,
      join(tmpDir, 'hard-pages'),
    )
    expect(result.hostnameMismatches).toEqual([])
    expect(warnSpy.mock.calls.some((call) => String(call[0]).includes('hostname mismatch'))).toBe(false)
    warnSpy.mockRestore()
    const db = openCrawlDb(dbPath)
    const allPages = db.getAllPages()
    db.close()
    const urls = allPages.map((p) => p.url)
    expect(urls).toContain(`${baseUrl}/`)
    expect(urls).toContain(`${baseUrl}/about`)
    expect(urls).toContain(`${baseUrl}/contact`)
    expect(urls).not.toContain(`${baseUrl}/never`)
    expect(allPages).toHaveLength(3)
    const rootPage = allPages.find((p) => p.url === `${baseUrl}/`)!
    expect(Array.isArray(rootPage.interactiveElements)).toBe(true)
    expect(rootPage.interactiveElements.length).toBeGreaterThan(0)
    for (const el of rootPage.interactiveElements) {
      expect(typeof el.role).toBe('string')
      expect(typeof el.accessibleName).toBe('string')
      expect(typeof el.tagName).toBe('string')
      expect(el.testId === null || typeof el.testId === 'string').toBe(true)
      expect(el.elementId === null || typeof el.elementId === 'string').toBe(true)
      expect(Array.isArray(el.classList)).toBe(true)
      expect(typeof el.cssPath).toBe('string')
      expect(el.cssPath.length).toBeGreaterThan(0)
      expect(typeof el.xpath).toBe('string')
      expect(el.xpath.startsWith('/html')).toBe(true)
    }
    expect(Array.isArray(rootPage.axeViolations)).toBe(true)
    expect(Array.isArray(rootPage.axeIncomplete)).toBe(true)
  }, 120_000)
})

interface RouteResponse {
  status?: number
  headers?: Record<string, string>
  body?: string
  contentType?: string
}

function startServer(routes: Record<string, RouteResponse>): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const route = routes[req.url ?? '/']
      if (!route) {
        res.writeHead(404, { 'Content-Type': 'text/html' })
        res.end('<html><body>not found</body></html>')
        return
      }
      res.writeHead(route.status ?? 200, {
        'Content-Type': route.contentType ?? 'text/html',
        ...route.headers,
      })
      res.end(route.body ?? '')
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` })
    })
  })
}

async function withTmpDir<T>(fn: (tmpDir: string, dbPath: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'treeline-origin-test-'))
  try {
    return await fn(dir, join(dir, 'crawl.db'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('crawl — origin scope and hostname mismatch detection', () => {
  it('follows a real redirect and discovers pages under the resolved origin', async () => {
    const target = await startServer({
      '/': { body: '<html><body><a href="/next">next</a></body></html>' },
      '/next': { body: '<html><body>next page</body></html>' },
    })
    const source = await startServer({
      '/': { status: 301, headers: { Location: `${target.baseUrl}/` }, body: '' },
    })
    try {
      await withTmpDir(async (dir, dbPath) => {
        const result = await crawl(
          {
            seedUrl: `${source.baseUrl}/`,
            sameOriginOnly: true,
            maxDepth: 3,
            maxPages: 5,
            stealth: false,
            respectRobotsTxt: false,
            throttleMs: 0,
          },
          dbPath,
          join(dir, 'hard-pages'),
        )
        expect(result.hostnameMismatches).toEqual([])
        const db = openCrawlDb(dbPath)
        const urls = db.getAllPages().map((p) => p.url)
        db.close()
        expect(urls).toContain(`${target.baseUrl}/`)
        expect(urls).toContain(`${target.baseUrl}/next`)
        expect(urls).not.toContain(`${source.baseUrl}/`)
      })
    } finally {
      target.server.close()
      source.server.close()
    }
  }, 30_000)

  it('warns and reports a hostname mismatch found via sitemap.xml', async () => {
    const seed = await startServer({
      '/': { body: '<html><body>home</body></html>' },
      '/sitemap.xml': {
        contentType: 'application/xml',
        body: '<urlset><url><loc>https://other-sitemap.example/page</loc></url></urlset>',
      },
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await withTmpDir(async (dir, dbPath) => {
        const result = await crawl(
          {
            seedUrl: `${seed.baseUrl}/`,
            sameOriginOnly: true,
            maxDepth: 1,
            maxPages: 1,
            stealth: false,
            respectRobotsTxt: false,
            throttleMs: 0,
          },
          dbPath,
          join(dir, 'hard-pages'),
        )
        expect(result.hostnameMismatches).toEqual([
          { source: 'sitemap', hostname: 'other-sitemap.example', url: 'https://other-sitemap.example/page' },
        ])
        expect(warnSpy.mock.calls.some((call) => String(call[0]).includes('other-sitemap.example'))).toBe(true)
      })
    } finally {
      warnSpy.mockRestore()
      seed.server.close()
    }
  }, 30_000)

  it('warns and reports a hostname mismatch found via a canonical link tag', async () => {
    const seed = await startServer({
      '/': {
        body: '<html><head><link rel="canonical" href="https://other-canonical.example/" /></head><body>home</body></html>',
      },
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await withTmpDir(async (dir, dbPath) => {
        const result = await crawl(
          {
            seedUrl: `${seed.baseUrl}/`,
            sameOriginOnly: true,
            maxDepth: 1,
            maxPages: 1,
            stealth: false,
            respectRobotsTxt: false,
            throttleMs: 0,
          },
          dbPath,
          join(dir, 'hard-pages'),
        )
        expect(result.hostnameMismatches).toEqual([
          { source: 'canonical', hostname: 'other-canonical.example', url: 'https://other-canonical.example/' },
        ])
        expect(warnSpy.mock.calls.some((call) => String(call[0]).includes('other-canonical.example'))).toBe(true)
      })
    } finally {
      warnSpy.mockRestore()
      seed.server.close()
    }
  }, 30_000)

  it('reports a single mismatch when sitemap and canonical agree on the same alternate hostname', async () => {
    const seed = await startServer({
      '/': {
        body: '<html><head><link rel="canonical" href="https://dup.example/" /></head><body>home</body></html>',
      },
      '/sitemap.xml': {
        contentType: 'application/xml',
        body: '<urlset><url><loc>https://dup.example/page</loc></url></urlset>',
      },
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      await withTmpDir(async (dir, dbPath) => {
        const result = await crawl(
          {
            seedUrl: `${seed.baseUrl}/`,
            sameOriginOnly: true,
            maxDepth: 1,
            maxPages: 1,
            stealth: false,
            respectRobotsTxt: false,
            throttleMs: 0,
          },
          dbPath,
          join(dir, 'hard-pages'),
        )
        expect(result.hostnameMismatches).toHaveLength(1)
        expect(result.hostnameMismatches[0].hostname).toBe('dup.example')
      })
    } finally {
      warnSpy.mockRestore()
      seed.server.close()
    }
  }, 30_000)
})
