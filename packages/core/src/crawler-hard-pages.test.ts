import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { HardPageEntry } from './types.js'

const capturePageMock = vi.fn()

vi.mock('@treeline/acquire', () => ({
  capturePageWithBrowser: (...args: unknown[]) => capturePageMock(...args),
  launchHardened: async () => ({ isConnected: () => true, close: async () => undefined }),
  AuthExpiredError: class AuthExpiredError extends Error {},
  AuthWallError: class AuthWallError extends Error {},
}))

const { crawl } = await import('./crawler.js')

const SEED = 'http://127.0.0.1:1/'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'treeline-hard-pages-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

async function crawlFailing(thrown: unknown): Promise<HardPageEntry> {
  capturePageMock.mockReset()
  capturePageMock.mockRejectedValue(thrown)
  const hardPagesDir = join(tmpDir, 'hard-pages')
  await crawl(
    { seedUrl: SEED, sameOriginOnly: true, maxDepth: 1, maxPages: 5, stealth: false, respectRobotsTxt: false, throttleMs: 0 },
    join(tmpDir, 'crawl.sqlite'),
    hardPagesDir,
  )
  const files = readdirSync(hardPagesDir)
  expect(files).toHaveLength(1)
  return JSON.parse(readFileSync(join(hardPagesDir, files[0]!), 'utf-8')) as HardPageEntry
}

describe('crawl — hard-pages captureSnapshot for capture failures', () => {
  it('records the real error message for a timeout, not null', async () => {
    const entry = await crawlFailing(new Error('page.goto: Timeout 30000ms exceeded.'))
    expect(entry.reasonCode).toBe('timeout')
    expect(entry.captureSnapshot).toBe('page.goto: Timeout 30000ms exceeded.')
  })

  it('records the real error message for any other capture failure', async () => {
    const entry = await crawlFailing(new Error('page.goto: net::ERR_CONNECTION_RESET at http://127.0.0.1:1/'))
    expect(entry.reasonCode).toBe('parse-error')
    expect(entry.captureSnapshot).toBe('page.goto: net::ERR_CONNECTION_RESET at http://127.0.0.1:1/')
  })

  it('stringifies a non-Error thrown value rather than dropping it', async () => {
    const entry = await crawlFailing('something odd was thrown')
    expect(entry.captureSnapshot).toBe('something odd was thrown')
  })

  it("strips the ANSI color codes Playwright puts in its call log, keeping the text", async () => {
    const entry = await crawlFailing(new Error('page.goto: net::ERR_UNSAFE_PORT\nCall log:\n\u001b[2m  - navigating to "http://127.0.0.1:9/"\u001b[22m\n'))
    expect(entry.captureSnapshot).toBe('page.goto: net::ERR_UNSAFE_PORT\nCall log:\n  - navigating to "http://127.0.0.1:9/"\n')
  })

  it('truncates a very long message to the same 500-character cap the auth reason codes use', async () => {
    const entry = await crawlFailing(new Error('x'.repeat(2000)))
    expect(entry.captureSnapshot).toHaveLength(500)
  })
})
