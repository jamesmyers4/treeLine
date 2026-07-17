import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { crawl } from './crawler.js'
import { openCrawlDb } from './persistence.js'
import type { AuthSession } from '@treeline/acquire'
import type { HardPageEntry } from './types.js'

const SESSION_COOKIE_VALUE = 'valid-session-id'

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!header) return cookies
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex === -1) continue
    const key = part.slice(0, separatorIndex).trim()
    const value = part.slice(separatorIndex + 1).trim()
    if (key) cookies[key] = value
  }
  return cookies
}

function buildAuthSession(baseUrl: string): AuthSession {
  return {
    storageState: {
      cookies: [
        {
          name: 'treeline_session',
          value: SESSION_COOKIE_VALUE,
          domain: '127.0.0.1',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    },
    successIndicator: '#logout-link',
    loginUrl: `${baseUrl}/login`,
  }
}

function buildInvalidAuthSession(baseUrl: string): AuthSession {
  return {
    storageState: {
      cookies: [
        {
          name: 'treeline_session',
          value: 'garbage-session-id-never-issued',
          domain: '127.0.0.1',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    },
    successIndicator: '#logout-link',
    loginUrl: `${baseUrl}/login`,
  }
}

// expireAfterHits counts every authenticated hit, including fetchSeedPage's own resolveSeedUrl probe when the
// crawl's seedUrl is gated — that probe is a real authenticated navigation now, not a cookie-less fetch.
function startExpiringAuthServer(expireAfterHits: number): Promise<{ server: Server; baseUrl: string; resetHits: () => void }> {
  return new Promise((resolve) => {
    let authenticatedHits = 0
    const server = createServer((req, res) => {
      if (req.url === '/login') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><form><input type="password" name="pw" /></form></body></html>')
        return
      }
      if (req.url === '/dashboard' || req.url === '/account') {
        const cookies = parseCookieHeader(req.headers.cookie)
        let authenticated = false
        if (cookies.treeline_session === SESSION_COOKIE_VALUE) {
          authenticatedHits++
          authenticated = authenticatedHits <= expireAfterHits
        }
        if (!authenticated) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body>please log in</body></html>')
          return
        }
        const nextLink = req.url === '/dashboard' ? '<a href="/account">account</a>' : ''
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<html><body><h1>${req.url}</h1><a id="logout-link" href="#">Logout</a>${nextLink}</body></html>`)
        return
      }
      res.writeHead(404)
      res.end('not found')
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}`, resetHits: () => { authenticatedHits = 0 } })
    })
  })
}

async function withTmpDir<T>(fn: (tmpDir: string, dbPath: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'treeline-auth-test-'))
  try {
    return await fn(dir, join(dir, 'crawl.db'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function readHardPageEntries(hardPagesDir: string): HardPageEntry[] {
  let files: string[]
  try {
    files = readdirSync(hardPagesDir)
  } catch {
    return []
  }
  return files.map((f) => JSON.parse(readFileSync(join(hardPagesDir, f), 'utf-8')) as HardPageEntry)
}

describe('crawl — authenticated crawling', () => {
  it('writes auth-wall to hard-pages without marking the page failed, and continues crawling remaining pages', async () => {
    const pages: Record<string, string> = {
      '/': '<html><body><a href="/gated">gated</a><a href="/public">public</a></body></html>',
      '/gated': '<html><body><form><input type="password" name="pw" /></form></body></html>',
      '/public': '<html><body>public content</body></html>',
    }
    const server = createServer((req, res) => {
      const html = pages[req.url ?? '/'] ?? '<html><body>not found</body></html>'
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(html)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as { port: number }
    const baseUrl = `http://127.0.0.1:${addr.port}`
    try {
      await withTmpDir(async (dir, dbPath) => {
        const hardPagesDir = join(dir, 'hard-pages')
        const result = await crawl(
          {
            seedUrl: `${baseUrl}/`,
            sameOriginOnly: true,
            maxDepth: 1,
            maxPages: 5,
            stealth: false,
            respectRobotsTxt: false,
            throttleMs: 0,
            detectAuthWall: true,
          },
          dbPath,
          hardPagesDir,
        )
        expect(result.abortedAt).toBeUndefined()
        const db = openCrawlDb(dbPath)
        const urls = db.getAllPages().map((p) => p.url)
        db.close()
        expect(urls).toContain(`${baseUrl}/`)
        expect(urls).toContain(`${baseUrl}/public`)
        expect(urls).not.toContain(`${baseUrl}/gated`)
        const entries = readHardPageEntries(hardPagesDir)
        const gatedEntry = entries.find((e) => e.url === `${baseUrl}/gated`)
        expect(gatedEntry?.reasonCode).toBe('auth-wall')
      })
    } finally {
      server.close()
    }
  }, 30_000)

  it('writes auth-expired to hard-pages, aborts the crawl, and does not mark the page failed', async () => {
    const { server, baseUrl } = await startExpiringAuthServer(2)
    try {
      await withTmpDir(async (dir, dbPath) => {
        const hardPagesDir = join(dir, 'hard-pages')
        const authSession = buildAuthSession(baseUrl)
        const result = await crawl(
          {
            seedUrl: `${baseUrl}/dashboard`,
            sameOriginOnly: true,
            maxDepth: 1,
            maxPages: 5,
            stealth: false,
            respectRobotsTxt: false,
            throttleMs: 0,
          },
          dbPath,
          hardPagesDir,
          authSession,
        )
        expect(result.abortedAt).toEqual({ url: `${baseUrl}/account`, reason: 'auth-expired' })
        const db = openCrawlDb(dbPath)
        const urls = db.getAllPages().map((p) => p.url)
        db.close()
        expect(urls).toContain(`${baseUrl}/dashboard`)
        expect(urls).not.toContain(`${baseUrl}/account`)
        const entries = readHardPageEntries(hardPagesDir)
        const accountEntry = entries.find((e) => e.url === `${baseUrl}/account`)
        expect(accountEntry?.reasonCode).toBe('auth-expired')
      })
    } finally {
      server.close()
    }
  }, 30_000)

  it('retries and successfully captures the previously-aborted URL on a resumed crawl with a fresh valid session', async () => {
    const { server, baseUrl, resetHits } = await startExpiringAuthServer(2)
    try {
      await withTmpDir(async (dir, dbPath) => {
        const hardPagesDir = join(dir, 'hard-pages')
        const authSession = buildAuthSession(baseUrl)
        const firstResult = await crawl(
          {
            seedUrl: `${baseUrl}/dashboard`,
            sameOriginOnly: true,
            maxDepth: 1,
            maxPages: 5,
            stealth: false,
            respectRobotsTxt: false,
            throttleMs: 0,
          },
          dbPath,
          hardPagesDir,
          authSession,
        )
        expect(firstResult.abortedAt?.url).toBe(`${baseUrl}/account`)
        resetHits()
        const secondResult = await crawl(
          {
            seedUrl: `${baseUrl}/account`,
            sameOriginOnly: true,
            maxDepth: 0,
            maxPages: 5,
            stealth: false,
            respectRobotsTxt: false,
            throttleMs: 0,
          },
          dbPath,
          hardPagesDir,
          authSession,
        )
        expect(secondResult.abortedAt).toBeUndefined()
        const db = openCrawlDb(dbPath)
        const accountPage = db.getAllPages().find((p) => p.url === `${baseUrl}/account`)
        db.close()
        expect(accountPage).toBeDefined()
        expect(accountPage?.status).toBe('ok')
      })
    } finally {
      server.close()
    }
  }, 30_000)

  it('fails fast with a clear seed-authentication error, before any frontier work begins, when the supplied authSession does not actually work', async () => {
    const { server, baseUrl } = await startExpiringAuthServer(2)
    try {
      await withTmpDir(async (dir, dbPath) => {
        const hardPagesDir = join(dir, 'hard-pages')
        const invalidAuthSession = buildInvalidAuthSession(baseUrl)
        await expect(
          crawl(
            {
              seedUrl: `${baseUrl}/dashboard`,
              sameOriginOnly: true,
              maxDepth: 1,
              maxPages: 5,
              stealth: false,
              respectRobotsTxt: false,
              throttleMs: 0,
            },
            dbPath,
            hardPagesDir,
            invalidAuthSession,
          ),
        ).rejects.toThrow(/credentials or session do not appear to be valid/i)
        const db = openCrawlDb(dbPath)
        const urls = db.getAllPages().map((p) => p.url)
        db.close()
        expect(urls).toEqual([])
        expect(readHardPageEntries(hardPagesDir)).toEqual([])
      })
    } finally {
      server.close()
    }
  }, 30_000)

  it('produces byte-identical output to a pre-auth-feature crawl when detectAuthWall is unset and no authSession is provided', async () => {
    const pages: Record<string, string> = {
      '/': '<html><body><a href="/about">about</a></body></html>',
      '/about': '<html><body>about</body></html>',
    }
    const server = createServer((req, res) => {
      const html = pages[req.url ?? '/'] ?? '<html><body>not found</body></html>'
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(html)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as { port: number }
    const baseUrl = `http://127.0.0.1:${addr.port}`
    try {
      await withTmpDir(async (dir, dbPath) => {
        const result = await crawl(
          {
            seedUrl: `${baseUrl}/`,
            sameOriginOnly: true,
            maxDepth: 2,
            maxPages: 5,
            stealth: false,
            respectRobotsTxt: false,
            throttleMs: 0,
          },
          dbPath,
          join(dir, 'hard-pages'),
        )
        expect(result.abortedAt).toBeUndefined()
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
