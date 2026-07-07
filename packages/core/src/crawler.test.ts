import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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
    await crawl(
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
    const db = openCrawlDb(dbPath)
    const allPages = db.getAllPages()
    db.close()
    const urls = (allPages as Array<{ url: string }>).map((p) => p.url)
    expect(urls).toContain(`${baseUrl}/`)
    expect(urls).toContain(`${baseUrl}/about`)
    expect(urls).toContain(`${baseUrl}/contact`)
    expect(urls).not.toContain(`${baseUrl}/never`)
    expect(allPages).toHaveLength(3)
  }, 120_000)
})
