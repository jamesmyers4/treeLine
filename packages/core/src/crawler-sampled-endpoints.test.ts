import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

const capturePageMock = vi.fn()

vi.mock('@treeline/acquire', () => ({
  capturePage: (...args: unknown[]) => capturePageMock(...args),
}))

const { crawl } = await import('./crawler.js')

const linksByPath: Record<string, string[]> = {
  '/': ['/a', '/b'],
  '/a': [],
  '/b': [],
}

let server: Server
let baseUrl: string
let tmpDir: string
let dbPath: string

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html><body>mocked</body></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${addr.port}`
  tmpDir = mkdtempSync(join(tmpdir(), 'treeline-sampled-endpoints-test-'))
  dbPath = join(tmpDir, 'crawl.db')
})

afterAll(() => {
  server.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('crawl — sampledEndpoints threading', () => {
  it('passes the same sampledEndpoints Set instance into every capturePage call across a multi-page crawl', async () => {
    capturePageMock.mockReset()
    capturePageMock.mockImplementation(async (url: string) => {
      const path = new URL(url).pathname
      return {
        url,
        title: 'mock',
        ariaSnapshot: '',
        links: (linksByPath[path] ?? []).map((p) => `${baseUrl}${p}`),
        networkLog: [],
        screenshot: null,
        capturedAt: new Date().toISOString(),
        pageLoadMs: 1,
        interactiveElements: [],
        axeViolations: [],
        axeIncomplete: [],
        forms: [],
      }
    })
    await crawl(
      {
        seedUrl: `${baseUrl}/`,
        sameOriginOnly: true,
        maxDepth: 5,
        maxPages: 3,
        stealth: false,
        respectRobotsTxt: false,
        throttleMs: 0,
        captureResponseBodies: true,
      },
      dbPath,
      join(tmpDir, 'hard-pages'),
    )
    expect(capturePageMock).toHaveBeenCalledTimes(3)
    const sampledEndpointsSets = capturePageMock.mock.calls.map((call) => (call[1] as { sampledEndpoints: Set<string> }).sampledEndpoints)
    expect(sampledEndpointsSets.every((set) => set === sampledEndpointsSets[0])).toBe(true)
    expect(sampledEndpointsSets[0]).toBeInstanceOf(Set)
    for (const call of capturePageMock.mock.calls) {
      expect((call[1] as { captureResponseBodies: boolean }).captureResponseBodies).toBe(true)
    }
  }, 30_000)
})
