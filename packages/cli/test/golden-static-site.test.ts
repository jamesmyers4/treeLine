import type { Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { runTreelineCrawl } from '../src/orchestrate.js'
import { createStaticSiteServer, staticSitePagePaths } from './fixtures/static-site/server.js'
import { compareOrUpdateGoldenFile, compareOrUpdateGoldenDir } from './normalize-golden.js'

const GOLDEN_DIR = join(__dirname, 'golden', 'static-site')

let server: Server
let baseUrl: string
let tmpDir: string
let outputDir: string

beforeAll(async () => {
  server = createStaticSiteServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${addr.port}`
  tmpDir = mkdtempSync(join(tmpdir(), 'treeline-golden-static-site-'))
  outputDir = join(tmpDir, 'output')
})

afterAll(() => {
  server.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('golden master: static-site', () => {
  it('produces the crawl output already reviewed and locked in as golden', async () => {
    const summary = await runTreelineCrawl({
      url: `${baseUrl}/`,
      stealth: false,
      maxPages: 10,
      maxDepth: 5,
      throttleMs: 0,
      outputDir,
      skipInterpretation: true,
      captureResponseBodies: false,
      maxResponseBodyBytes: 512000,
      captureRequestBodies: false,
      maxRequestBodyBytes: 65536,
      detectAuthWall: false,
      insecureCerts: false,
    })
    expect(summary.pagesCaptured).toBe(staticSitePagePaths.length)

    for (const reportName of ['atlas.md', 'selector-report.md', 'testid-audit.md', 'coverage-report.md']) {
      const actual = readFileSync(join(outputDir, 'reports', reportName), 'utf-8')
      compareOrUpdateGoldenFile(actual, join(GOLDEN_DIR, 'reports', reportName), reportName)
    }

    compareOrUpdateGoldenDir(join(outputDir, 'poms'), join(GOLDEN_DIR, 'poms'), 'static-site poms')
    compareOrUpdateGoldenDir(join(outputDir, 'specs'), join(GOLDEN_DIR, 'specs'), 'static-site specs')
  }, 120_000)
})
