import type { Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { runTreelineCrawl } from '../src/orchestrate.js'
import { createFormAndApiServer, formAndApiPagePaths } from './fixtures/form-and-api/server.js'
import { compareOrUpdateGoldenFile, compareOrUpdateGoldenDir } from './normalize-golden.js'

const GOLDEN_DIR = join(__dirname, 'golden', 'form-and-api')

let server: Server
let baseUrl: string
let tmpDir: string
let outputDir: string

beforeAll(async () => {
  server = createFormAndApiServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${addr.port}`
  tmpDir = mkdtempSync(join(tmpdir(), 'treeline-golden-form-and-api-'))
  outputDir = join(tmpDir, 'output')
})

afterAll(() => {
  server.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('golden master: form-and-api', () => {
  it('produces a flow-map with a real forms table and API surface table, matching the reviewed golden', async () => {
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
    expect(summary.pagesCaptured).toBe(formAndApiPagePaths.length)

    const flowMap = readFileSync(join(outputDir, 'reports', 'flow-map.md'), 'utf-8')
    expect(flowMap).toContain('Email')
    expect(flowMap).toContain('/api/status')
    compareOrUpdateGoldenFile(flowMap, join(GOLDEN_DIR, 'reports', 'flow-map.md'), 'flow-map.md')

    compareOrUpdateGoldenDir(join(outputDir, 'poms'), join(GOLDEN_DIR, 'poms'), 'form-and-api poms')
    compareOrUpdateGoldenDir(join(outputDir, 'specs'), join(GOLDEN_DIR, 'specs'), 'form-and-api specs')
  }, 120_000)
})
