import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { crawl } from './crawler.js'
import { openCrawlDb } from './persistence.js'
import { isUrlDenied } from './url-utils.js'

async function withTmpDir<T>(fn: (tmpDir: string, dbPath: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'treeline-deny-test-'))
  try {
    return await fn(dir, join(dir, 'crawl.db'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function startServer(pages: Record<string, string>): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const html = pages[req.url ?? '/'] ?? '<html><body>not found</body></html>'
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(html)
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` })
    })
  })
}

describe('isUrlDenied', () => {
  it('matches a URL containing any configured substring pattern', () => {
    expect(isUrlDenied('https://x.example/forms_admin.php?id=18&method=disable', ['method=disable'])).toBe(true)
    expect(isUrlDenied('https://x.example/forms_admin.php?id=18&method=view', ['method=disable'])).toBe(false)
  })

  it('checks every configured pattern, not just the first', () => {
    const patterns = ['method=disable', 'method=delete']
    expect(isUrlDenied('https://x.example/a?method=delete', patterns)).toBe(true)
  })

  it('returns false when no patterns are configured', () => {
    expect(isUrlDenied('https://x.example/anything', undefined)).toBe(false)
    expect(isUrlDenied('https://x.example/anything', [])).toBe(false)
  })
})

describe('crawl — denyUrlPatterns', () => {
  it('never captures a discovered link matching a configured deny pattern, and counts it', async () => {
    const { server, baseUrl } = await startServer({
      '/': '<html><body><a href="/safe">safe</a><a href="/forms_admin.php?id=18&method=disable&csrf_token_form=abc">disable</a></body></html>',
      '/safe': '<html><body>safe page</body></html>',
    })
    try {
      await withTmpDir(async (dir, dbPath) => {
        const result = await crawl(
          {
            seedUrl: `${baseUrl}/`,
            sameOriginOnly: true,
            maxDepth: 2,
            maxPages: 10,
            stealth: false,
            respectRobotsTxt: false,
            throttleMs: 0,
            denyUrlPatterns: ['method=disable'],
          },
          dbPath,
          join(dir, 'hard-pages'),
        )
        expect(result.deniedUrlCount).toBe(1)
        const db = openCrawlDb(dbPath)
        const urls = db.getAllPages().map((p) => p.url)
        db.close()
        expect(urls).toContain(`${baseUrl}/`)
        expect(urls).toContain(`${baseUrl}/safe`)
        expect(urls.some((u) => u.includes('method=disable'))).toBe(false)
      })
    } finally {
      server.close()
    }
  }, 30_000)

  it('also blocks a denied URL reached via sitemap.xml, before it is ever captured', async () => {
    let baseUrl = ''
    const server = createServer((req, res) => {
      if (req.url === '/sitemap.xml') {
        res.writeHead(200, { 'Content-Type': 'application/xml' })
        res.end(
          `<urlset><url><loc>${baseUrl}/</loc></url><url><loc>${baseUrl}/account.php?action=delete&id=1</loc></url></urlset>`,
        )
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body>home</body></html>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as { port: number }
    baseUrl = `http://127.0.0.1:${addr.port}`
    try {
      await withTmpDir(async (dir, dbPath) => {
        const result = await crawl(
          {
            seedUrl: `${baseUrl}/`,
            sameOriginOnly: true,
            maxDepth: 1,
            maxPages: 10,
            stealth: false,
            respectRobotsTxt: false,
            throttleMs: 0,
            denyUrlPatterns: ['action=delete'],
          },
          dbPath,
          join(dir, 'hard-pages'),
        )
        expect(result.deniedUrlCount).toBe(1)
        const db = openCrawlDb(dbPath)
        const urls = db.getAllPages().map((p) => p.url)
        db.close()
        expect(urls.some((u) => u.includes('action=delete'))).toBe(false)
      })
    } finally {
      server.close()
    }
  }, 30_000)

  it('produces byte-identical behavior to a crawl with no denyUrlPatterns configured, when the field is omitted', async () => {
    const { server, baseUrl } = await startServer({
      '/': '<html><body><a href="/about">about</a></body></html>',
      '/about': '<html><body>about page</body></html>',
    })
    try {
      await withTmpDir(async (dir, dbPath) => {
        const result = await crawl(
          {
            seedUrl: `${baseUrl}/`,
            sameOriginOnly: true,
            maxDepth: 1,
            maxPages: 10,
            stealth: false,
            respectRobotsTxt: false,
            throttleMs: 0,
          },
          dbPath,
          join(dir, 'hard-pages'),
        )
        expect(result.deniedUrlCount).toBe(0)
        const db = openCrawlDb(dbPath)
        const urls = db.getAllPages().map((p) => p.url)
        db.close()
        expect(urls).toContain(`${baseUrl}/`)
        expect(urls).toContain(`${baseUrl}/about`)
      })
    } finally {
      server.close()
    }
  }, 30_000)
})
