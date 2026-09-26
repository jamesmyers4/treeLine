import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import type { AcquireOptions, AuthSession, Browser } from '@treeline/acquire'

vi.mock('@treeline/acquire', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@treeline/acquire')>()
  return {
    ...actual,
    launchHardened: vi.fn(actual.launchHardened),
    capturePageWithBrowser: vi.fn(actual.capturePageWithBrowser),
    resolveSeedUrl: vi.fn(actual.resolveSeedUrl),
    resolveSeedUrlWithBrowser: vi.fn(actual.resolveSeedUrlWithBrowser),
  }
})

const acquire = await import('@treeline/acquire')
const actualAcquire = await vi.importActual<typeof import('@treeline/acquire')>('@treeline/acquire')
const { crawl } = await import('./crawler.js')
const { fetchSeedPage } = await import('./origin-scope.js')
const { openCrawlDb } = await import('./persistence.js')

const LOGOUT = '<a id="logout-link" href="/logout">log out</a>'

const pages: Record<string, string> = {
  '/': `<html><body>${LOGOUT}<a href="/a">a</a><a href="/b">b</a><a href="/boom">boom</a></body></html>`,
  '/a': `<html><body>${LOGOUT}<p>page a</p></body></html>`,
  '/b': `<html><body>${LOGOUT}<p>page b</p></body></html>`,
}

let server: Server
let baseUrl: string
let tmpDir: string

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/boom') {
      req.socket.destroy()
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(pages[req.url ?? '/'] ?? '<html><body>not found</body></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterAll(() => {
  server.close()
})

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'treeline-shared-browser-test-'))
  vi.mocked(acquire.launchHardened).mockClear()
  vi.mocked(acquire.capturePageWithBrowser).mockReset()
  vi.mocked(acquire.capturePageWithBrowser).mockImplementation(actualAcquire.capturePageWithBrowser)
  vi.mocked(acquire.resolveSeedUrl).mockClear()
  vi.mocked(acquire.resolveSeedUrlWithBrowser).mockClear()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.mocked(console.warn).mockRestore()
  rmSync(tmpDir, { recursive: true, force: true })
})

async function launchedBrowsers(): Promise<Browser[]> {
  return Promise.all(vi.mocked(acquire.launchHardened).mock.results.map((r) => r.value as Promise<Browser>))
}

async function runCrawl(authSession?: AuthSession) {
  const dbPath = join(tmpDir, 'crawl.sqlite')
  const hardPagesDir = join(tmpDir, 'hard-pages')
  const result = await crawl(
    { seedUrl: `${baseUrl}/`, sameOriginOnly: true, maxDepth: 2, maxPages: 10, stealth: false, headless: true, respectRobotsTxt: false, throttleMs: 0 },
    dbPath,
    hardPagesDir,
    authSession,
  )
  const db = openCrawlDb(dbPath)
  const stored = db.getAllPages()
  db.close()
  const hardPages = (() => {
    try {
      return readdirSync(hardPagesDir)
    } catch {
      return []
    }
  })()
  return { result, stored, hardPages }
}

describe('crawl — one shared browser per crawl', () => {
  it('launches exactly one browser for a multi-page crawl, survives a thrown per-page error, and closes the browser afterwards', async () => {
    const { stored, hardPages } = await runCrawl()
    expect(acquire.launchHardened).toHaveBeenCalledTimes(1)
    expect(acquire.launchHardened).toHaveBeenCalledWith({ stealth: false, headless: true })
    const byUrl = new Map(stored.map((p) => [p.url, p.status]))
    expect(byUrl.get(`${baseUrl}/boom`)).toBe('parse-error')
    for (const path of ['/', '/a', '/b']) {
      expect(byUrl.has(`${baseUrl}${path}`)).toBe(true)
      expect(byUrl.get(`${baseUrl}${path}`)).not.toBe('parse-error')
    }
    expect(hardPages).toHaveLength(1)
    const browsers = await launchedBrowsers()
    expect(browsers.every((b) => !b.isConnected())).toBe(true)
  }, 60000)

  it('closes the shared browser after an auth-expired abort', async () => {
    vi.mocked(acquire.capturePageWithBrowser).mockImplementation(async (url: string, browser: Browser, options?: AcquireOptions) => {
      if (url.endsWith('/a')) throw new acquire.AuthExpiredError(url)
      return actualAcquire.capturePageWithBrowser(url, browser, options)
    })
    const { result } = await runCrawl()
    expect(result.abortedAt).toEqual({ url: `${baseUrl}/a`, reason: 'auth-expired' })
    expect(acquire.launchHardened).toHaveBeenCalledTimes(1)
    const browsers = await launchedBrowsers()
    expect(browsers.every((b) => !b.isConnected())).toBe(true)
  }, 60000)

  it('relaunches and retries the page once when the shared browser dies mid-capture, instead of marking it failed', async () => {
    let crashed = false
    vi.mocked(acquire.capturePageWithBrowser).mockImplementation(async (url: string, browser: Browser, options?: AcquireOptions) => {
      if (url.endsWith('/a') && !crashed) {
        crashed = true
        await browser.close()
      }
      return actualAcquire.capturePageWithBrowser(url, browser, options)
    })
    const { stored, hardPages } = await runCrawl()
    expect(acquire.launchHardened).toHaveBeenCalledTimes(2)
    const pageA = stored.find((p) => p.url === `${baseUrl}/a`)
    expect(pageA).toBeDefined()
    expect(pageA!.status).not.toBe('parse-error')
    expect(pageA!.title).not.toBeNull()
    expect(hardPages).toHaveLength(1)
    const browsers = await launchedBrowsers()
    expect(browsers.every((b) => !b.isConnected())).toBe(true)
  }, 60000)

  it('marks the page failed if it kills the relaunched browser too, and keeps crawling the rest of the frontier', async () => {
    vi.mocked(acquire.capturePageWithBrowser).mockImplementation(async (url: string, browser: Browser, options?: AcquireOptions) => {
      if (url.endsWith('/a')) await browser.close()
      return actualAcquire.capturePageWithBrowser(url, browser, options)
    })
    const { stored } = await runCrawl()
    const byUrl = new Map(stored.map((p) => [p.url, p.status]))
    expect(byUrl.get(`${baseUrl}/a`)).toBe('parse-error')
    expect(byUrl.has(`${baseUrl}/b`)).toBe(true)
    expect(byUrl.get(`${baseUrl}/b`)).not.toBe('parse-error')
    expect(acquire.launchHardened).toHaveBeenCalledTimes(3)
    const browsers = await launchedBrowsers()
    expect(browsers.every((b) => !b.isConnected())).toBe(true)
  }, 60000)

  it('resolves an authenticated seed on the same shared browser the pages are captured with', async () => {
    const authSession: AuthSession = {
      storageState: { cookies: [], origins: [] },
      successIndicator: '#logout-link',
      loginUrl: `${baseUrl}/login`,
    }
    await runCrawl(authSession)
    expect(acquire.resolveSeedUrl).not.toHaveBeenCalled()
    expect(acquire.resolveSeedUrlWithBrowser).toHaveBeenCalledTimes(1)
    expect(acquire.launchHardened).toHaveBeenCalledTimes(1)
    const [browser] = await launchedBrowsers()
    expect(vi.mocked(acquire.resolveSeedUrlWithBrowser).mock.calls[0]![1]).toBe(browser)
    for (const call of vi.mocked(acquire.capturePageWithBrowser).mock.calls) {
      expect(call[1]).toBe(browser)
    }
    expect(browser!.isConnected()).toBe(false)
  }, 60000)
})

describe('fetchSeedPage — stealth threading', () => {
  it('passes stealth through to its own seed-resolution launch', async () => {
    vi.mocked(acquire.resolveSeedUrl).mockResolvedValueOnce({ resolvedUrl: `${baseUrl}/`, html: null })
    const authSession: AuthSession = {
      storageState: { cookies: [], origins: [] },
      successIndicator: '#logout-link',
      loginUrl: `${baseUrl}/login`,
    }
    await fetchSeedPage(`${baseUrl}/`, authSession, { stealth: true, headless: true })
    expect(vi.mocked(acquire.resolveSeedUrl).mock.calls[0]![1]).toMatchObject({ stealth: true, headless: true })
  })
})
