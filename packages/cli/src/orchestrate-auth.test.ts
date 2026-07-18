import { createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { openCrawlDb } from '@treeline/core'

vi.mock('@treeline/acquire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@treeline/acquire')>()
  return { ...actual, performLogin: vi.fn(actual.performLogin) }
})

vi.mock('@treeline/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@treeline/core')>()
  return { ...actual, crawl: vi.fn(actual.crawl) }
})

import { performLogin } from '@treeline/acquire'
import { crawl } from '@treeline/core'
import { runTreelineCrawl, formatAbortedCrawlMessage } from './orchestrate.js'
import type { TreelineCrawlOptions } from './orchestrate.js'

const FIXTURE_USERNAME = 'cli-auth-user'
const FIXTURE_PASSWORD = 'cli-auth-pass-9f3k2'
const SESSION_COOKIE = 'treeline_cli_auth_session'

function parseCookies(header: string | undefined): Record<string, string> {
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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function startAuthFixture(expireAfterHits: number = Infinity): Promise<{ server: Server; baseUrl: string; resetHits: () => void }> {
  return new Promise((resolve) => {
    const sessions = new Set<string>()
    let hits = 0
    const server = createServer((req, res) => {
      const url = req.url ?? '/'
      if (url === '/login' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<!doctype html><html><body>
<form method="post" action="/login">
  <input type="text" name="username" />
  <input type="password" name="password" />
  <button type="submit">Log in</button>
</form>
</body></html>`)
        return
      }
      if (url === '/login' && req.method === 'POST') {
        readBody(req).then((body) => {
          const params = new URLSearchParams(body)
          if (params.get('username') === FIXTURE_USERNAME && params.get('password') === FIXTURE_PASSWORD) {
            const sessionId = randomUUID()
            sessions.add(sessionId)
            res.writeHead(302, { Location: '/dashboard', 'Set-Cookie': `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly` })
            res.end()
            return
          }
          res.writeHead(302, { Location: '/login' })
          res.end()
        })
        return
      }
      if (url === '/dashboard' || url === '/account') {
        const cookies = parseCookies(req.headers.cookie)
        let authenticated = false
        if (cookies[SESSION_COOKIE] && sessions.has(cookies[SESSION_COOKIE])) {
          hits++
          authenticated = hits <= expireAfterHits
        }
        if (!authenticated) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<!doctype html><html><body>please log in</body></html>')
          return
        }
        const nextLink = url === '/dashboard' ? '<a href="/account">account</a>' : ''
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<!doctype html><html><body><h1>${url}</h1><a id="logout-link" href="#">Logout</a>${nextLink}</body></html>`)
        return
      }
      res.writeHead(404)
      res.end('not found')
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}`, resetHits: () => { hits = 0 } })
    })
  })
}

async function withTmpDir<T>(fn: (outputDir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'treeline-cli-auth-'))
  try {
    return await fn(join(dir, 'output'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function baseOptions(outputDir: string, url: string): TreelineCrawlOptions {
  return {
    url,
    stealth: false,
    maxPages: 5,
    maxDepth: 2,
    throttleMs: 0,
    outputDir,
    skipInterpretation: true,
    captureResponseBodies: false,
    maxResponseBodyBytes: 512000,
    captureRequestBodies: false,
    maxRequestBodyBytes: 65536,
    detectAuthWall: false,
    insecureCerts: false,
  }
}

const loggedOutput: string[] = []
let logSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>

beforeAll(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { loggedOutput.push(args.map(String).join(' ')) })
  warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => { loggedOutput.push(args.map(String).join(' ')) })
  errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { loggedOutput.push(args.map(String).join(' ')) })
})

afterAll(() => {
  logSpy.mockRestore()
  warnSpy.mockRestore()
  errorSpy.mockRestore()
})

describe('runTreelineCrawl — authenticated crawling', () => {
  it('fails fast when --login-url is set but --username is missing, before any network call', async () => {
    vi.mocked(performLogin).mockClear()
    vi.mocked(crawl).mockClear()
    const previousPassword = process.env.TREELINE_LOGIN_PASSWORD
    process.env.TREELINE_LOGIN_PASSWORD = FIXTURE_PASSWORD
    try {
      await withTmpDir(async (outputDir) => {
        const options = {
          ...baseOptions(outputDir, 'http://127.0.0.1:9/dashboard'),
          loginUrl: 'http://127.0.0.1:9/login',
          successIndicator: '#logout-link',
        }
        await expect(runTreelineCrawl(options)).rejects.toThrow(/--username is required/)
      })
    } finally {
      if (previousPassword === undefined) delete process.env.TREELINE_LOGIN_PASSWORD
      else process.env.TREELINE_LOGIN_PASSWORD = previousPassword
    }
    expect(performLogin).not.toHaveBeenCalled()
    expect(crawl).not.toHaveBeenCalled()
  })

  it('fails fast when --login-url is set but TREELINE_LOGIN_PASSWORD is missing, before any network call', async () => {
    vi.mocked(performLogin).mockClear()
    vi.mocked(crawl).mockClear()
    const previousPassword = process.env.TREELINE_LOGIN_PASSWORD
    delete process.env.TREELINE_LOGIN_PASSWORD
    try {
      await withTmpDir(async (outputDir) => {
        const options = {
          ...baseOptions(outputDir, 'http://127.0.0.1:9/dashboard'),
          loginUrl: 'http://127.0.0.1:9/login',
          successIndicator: '#logout-link',
          username: FIXTURE_USERNAME,
        }
        await expect(runTreelineCrawl(options)).rejects.toThrow(/TREELINE_LOGIN_PASSWORD is not set/)
      })
    } finally {
      if (previousPassword === undefined) delete process.env.TREELINE_LOGIN_PASSWORD
      else process.env.TREELINE_LOGIN_PASSWORD = previousPassword
    }
    expect(performLogin).not.toHaveBeenCalled()
    expect(crawl).not.toHaveBeenCalled()
  })

  it('fails fast naming both flags when --login-url is set without --success-indicator', async () => {
    await withTmpDir(async (outputDir) => {
      const options = {
        ...baseOptions(outputDir, 'http://127.0.0.1:9/dashboard'),
        loginUrl: 'http://127.0.0.1:9/login',
      }
      await expect(runTreelineCrawl(options)).rejects.toThrow(/--login-url.*--success-indicator/)
    })
  })

  it('fails fast naming both flags when --success-indicator is set without --login-url', async () => {
    await withTmpDir(async (outputDir) => {
      const options = {
        ...baseOptions(outputDir, 'http://127.0.0.1:9/dashboard'),
        successIndicator: '#logout-link',
      }
      await expect(runTreelineCrawl(options)).rejects.toThrow(/--login-url.*--success-indicator/)
    })
  })

  it('calls performLogin and threads the resulting session into crawl() against a real fixture server', async () => {
    vi.mocked(performLogin).mockClear()
    vi.mocked(crawl).mockClear()
    const { server, baseUrl } = await startAuthFixture()
    const previousPassword = process.env.TREELINE_LOGIN_PASSWORD
    process.env.TREELINE_LOGIN_PASSWORD = FIXTURE_PASSWORD
    try {
      await withTmpDir(async (outputDir) => {
        const options = {
          ...baseOptions(outputDir, `${baseUrl}/dashboard`),
          maxDepth: 0,
          loginUrl: `${baseUrl}/login`,
          successIndicator: '#logout-link',
          username: FIXTURE_USERNAME,
        }
        const summary = await runTreelineCrawl(options)
        expect(summary.abortedAt).toBeUndefined()
        expect(summary.pagesCaptured).toBe(1)
        const db = openCrawlDb(join(outputDir, 'crawl.sqlite'))
        const pages = db.getAllPages()
        db.close()
        expect(pages.map((p) => p.url)).toContain(`${baseUrl}/dashboard`)
      })
    } finally {
      if (previousPassword === undefined) delete process.env.TREELINE_LOGIN_PASSWORD
      else process.env.TREELINE_LOGIN_PASSWORD = previousPassword
      server.close()
    }
    expect(performLogin).toHaveBeenCalledTimes(1)
    expect(crawl).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('fails with a clear message before crawl activity begins when credentials are wrong (LoginFailedError)', async () => {
    vi.mocked(performLogin).mockClear()
    vi.mocked(crawl).mockClear()
    const { server, baseUrl } = await startAuthFixture()
    const previousPassword = process.env.TREELINE_LOGIN_PASSWORD
    process.env.TREELINE_LOGIN_PASSWORD = 'definitely-the-wrong-password'
    try {
      await withTmpDir(async (outputDir) => {
        const options = {
          ...baseOptions(outputDir, `${baseUrl}/dashboard`),
          loginUrl: `${baseUrl}/login`,
          successIndicator: '#logout-link',
          username: FIXTURE_USERNAME,
        }
        await expect(runTreelineCrawl(options)).rejects.toThrow(/Login failed/i)
      })
    } finally {
      if (previousPassword === undefined) delete process.env.TREELINE_LOGIN_PASSWORD
      else process.env.TREELINE_LOGIN_PASSWORD = previousPassword
      server.close()
    }
    expect(performLogin).toHaveBeenCalledTimes(1)
    expect(crawl).not.toHaveBeenCalled()
  }, 30_000)

  it('produces unchanged behavior with no auth flags at all', async () => {
    vi.mocked(performLogin).mockClear()
    const pages: Record<string, string> = { '/': '<html><body>hello</body></html>' }
    const server = createServer((req, res) => {
      const html = pages[req.url ?? '/'] ?? '<html><body>not found</body></html>'
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(html)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as { port: number }
    const baseUrl = `http://127.0.0.1:${addr.port}`
    try {
      await withTmpDir(async (outputDir) => {
        const summary = await runTreelineCrawl(baseOptions(outputDir, `${baseUrl}/`))
        expect(summary.abortedAt).toBeUndefined()
        expect(summary.pagesCaptured).toBe(1)
      })
    } finally {
      server.close()
    }
    expect(performLogin).not.toHaveBeenCalled()
  }, 30_000)

  it('warns and ignores --detect-auth-wall when combined with login flags, rather than silently no-opping or erroring', async () => {
    warnSpy.mockClear()
    const { server, baseUrl } = await startAuthFixture()
    const previousPassword = process.env.TREELINE_LOGIN_PASSWORD
    process.env.TREELINE_LOGIN_PASSWORD = FIXTURE_PASSWORD
    try {
      await withTmpDir(async (outputDir) => {
        const options = {
          ...baseOptions(outputDir, `${baseUrl}/dashboard`),
          maxDepth: 0,
          loginUrl: `${baseUrl}/login`,
          successIndicator: '#logout-link',
          username: FIXTURE_USERNAME,
          detectAuthWall: true,
        }
        const summary = await runTreelineCrawl(options)
        expect(summary.abortedAt).toBeUndefined()
      })
    } finally {
      if (previousPassword === undefined) delete process.env.TREELINE_LOGIN_PASSWORD
      else process.env.TREELINE_LOGIN_PASSWORD = previousPassword
      server.close()
    }
    expect(warnSpy).toHaveBeenCalled()
    const warned = warnSpy.mock.calls.some((call) => String(call[0]).includes('--detect-auth-wall'))
    expect(warned).toBe(true)
  }, 30_000)

  it('reports abortedAt end-to-end when the session expires mid-crawl, with a message naming the URL and page count', async () => {
    // expireAfterHits=3 accounts for three authenticated hits against /dashboard before the
    // crawler ever reaches /account: (1) performLogin's own post-login redirect lands on
    // /dashboard and is auto-followed by the browser, (2) fetchSeedPage's resolveSeedUrl
    // probe against the gated seedUrl, (3) the crawler's real capture of that same page.
    // See the analogous note in packages/core/src/crawler-auth.test.ts, which doesn't need
    // the +1 because it constructs AuthSession directly rather than calling performLogin.
    const { server, baseUrl } = await startAuthFixture(3)
    const previousPassword = process.env.TREELINE_LOGIN_PASSWORD
    process.env.TREELINE_LOGIN_PASSWORD = FIXTURE_PASSWORD
    try {
      await withTmpDir(async (outputDir) => {
        const options = {
          ...baseOptions(outputDir, `${baseUrl}/dashboard`),
          maxDepth: 1,
          loginUrl: `${baseUrl}/login`,
          successIndicator: '#logout-link',
          username: FIXTURE_USERNAME,
        }
        const summary = await runTreelineCrawl(options)
        expect(summary.abortedAt).toEqual({ url: `${baseUrl}/account`, reason: 'auth-expired' })
        const message = formatAbortedCrawlMessage(summary.abortedAt!, summary.pagesCaptured)
        expect(message).toContain(`${baseUrl}/account`)
        expect(message).toContain(String(summary.pagesCaptured))
        expect(message).toContain('aborted')
        expect(message).not.toMatch(/^Output directory:/)
      })
    } finally {
      if (previousPassword === undefined) delete process.env.TREELINE_LOGIN_PASSWORD
      else process.env.TREELINE_LOGIN_PASSWORD = previousPassword
      server.close()
    }
  }, 30_000)

  it('never leaks the configured password into any console.log/warn/error call made across this suite', () => {
    const leaked = loggedOutput.filter(
      (line) => line.includes(FIXTURE_PASSWORD) || line.includes('definitely-the-wrong-password'),
    )
    expect(leaked).toEqual([])
  })
})
