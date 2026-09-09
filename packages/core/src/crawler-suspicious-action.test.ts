import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { crawl } from './crawler.js'
import { openCrawlDb } from './persistence.js'
import { detectSuspiciousActionVerb } from './url-utils.js'

async function withTmpDir<T>(fn: (tmpDir: string, dbPath: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'treeline-suspicious-action-test-'))
  try {
    return await fn(dir, join(dir, 'crawl.db'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('detectSuspiciousActionVerb', () => {
  it('matches a verb appearing in a query param value (real OpenEMR shape: method=disable)', () => {
    expect(detectSuspiciousActionVerb('https://x.example/forms_admin.php?id=18&method=disable')).toBe('disable')
  })

  it('matches a verb appearing in a query param key', () => {
    expect(detectSuspiciousActionVerb('https://x.example/a?delete=1')).toBe('delete')
  })

  it('checks every configured verb, not just the first', () => {
    expect(detectSuspiciousActionVerb('https://x.example/a?action=deactivate')).toBe('deactivate')
    expect(detectSuspiciousActionVerb('https://x.example/a?action=remove')).toBe('remove')
  })

  it('is case-insensitive', () => {
    expect(detectSuspiciousActionVerb('https://x.example/a?method=DISABLE')).toBe('disable')
  })

  it('returns null for a URL with no suspicious query params', () => {
    expect(detectSuspiciousActionVerb('https://x.example/a?method=view&id=1')).toBeNull()
  })

  it('returns null for a URL with no query string at all', () => {
    expect(detectSuspiciousActionVerb('https://x.example/a')).toBeNull()
  })

  it('does not match a verb appearing only in the path, not the query string', () => {
    expect(detectSuspiciousActionVerb('https://x.example/delete-instructions.html?id=1')).toBeNull()
  })

  it('returns null for an unparseable URL rather than throwing', () => {
    expect(detectSuspiciousActionVerb('not a url')).toBeNull()
  })
})

describe('crawl — suspicious action URL heuristic (warning only, never blocks)', () => {
  it('flags a discovered link whose query string looks state-changing, but still captures it normally', async () => {
    const { server, baseUrl } = await startServer({
      '/': '<html><body><a href="/safe">safe</a><a href="/forms_admin.php?id=18&method=disable&csrf_token_form=abc">disable</a></body></html>',
      '/safe': '<html><body>safe page</body></html>',
      '/forms_admin.php': '<html><body>disable page</body></html>',
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
          },
          dbPath,
          join(dir, 'hard-pages'),
        )
        expect(result.suspiciousActionUrls).toHaveLength(1)
        expect(result.suspiciousActionUrls[0]!.matchedVerb).toBe('disable')
        expect(result.suspiciousActionUrls[0]!.url).toContain('method=disable')
        const db = openCrawlDb(dbPath)
        const urls = db.getAllPages().map((p) => p.url)
        db.close()
        expect(urls.some((u) => u.includes('method=disable'))).toBe(true)
      })
    } finally {
      server.close()
    }
  }, 30_000)

  it('also flags a suspicious URL reached via sitemap.xml', async () => {
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
      res.end('<html><body>page</body></html>')
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
          },
          dbPath,
          join(dir, 'hard-pages'),
        )
        expect(result.suspiciousActionUrls).toHaveLength(1)
        expect(result.suspiciousActionUrls[0]!.matchedVerb).toBe('delete')
      })
    } finally {
      server.close()
    }
  }, 30_000)

  it('never flags anything when a URL matching the same shape is also configured as denied — deny wins, since a denied URL is never captured or even considered', async () => {
    const { server, baseUrl } = await startServer({
      '/': '<html><body><a href="/forms_admin.php?id=18&method=disable">disable</a></body></html>',
      '/forms_admin.php': '<html><body>disable page</body></html>',
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
            denyUrlPatterns: ['method=disable'],
          },
          dbPath,
          join(dir, 'hard-pages'),
        )
        expect(result.deniedUrlCount).toBe(1)
        expect(result.suspiciousActionUrls).toHaveLength(0)
      })
    } finally {
      server.close()
    }
  }, 30_000)

  it('produces byte-identical behavior to a crawl with no suspicious URLs present', async () => {
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
        expect(result.suspiciousActionUrls).toEqual([])
      })
    } finally {
      server.close()
    }
  }, 30_000)
})

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
