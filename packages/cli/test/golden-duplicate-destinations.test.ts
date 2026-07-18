import type { Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { runTreelineCrawl } from '../src/orchestrate.js'
import { createDuplicateDestinationsServer, duplicateDestinationsPagePaths } from './fixtures/duplicate-destinations/server.js'
import { compareOrUpdateGoldenFile, compareOrUpdateGoldenDir } from './normalize-golden.js'

const GOLDEN_DIR = join(__dirname, 'golden', 'duplicate-destinations')

let server: Server
let baseUrl: string
let tmpDir: string
let outputDir: string

beforeAll(async () => {
  server = createDuplicateDestinationsServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${addr.port}`
  tmpDir = mkdtempSync(join(tmpdir(), 'treeline-golden-duplicate-destinations-'))
  outputDir = join(tmpDir, 'output')
})

afterAll(() => {
  server.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('golden master: duplicate-destinations', () => {
  it(
    'two same-text "Read more" links pointing at genuinely different URLs produce POM properties disambiguated only by ' +
      'occurrence order (readMoreLink1/readMoreLink2), not by destination — this is the documented, accepted ' +
      "current limitation (CONTEXT.md's 'Open items': POM property naming doesn't disambiguate same-text/" +
      'different-destination links), locked in here deliberately. If a future session adds href capture and fixes ' +
      'this, these golden files are expected to change as a deliberate, reviewed update, not treated as a regression.',
    async () => {
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
      expect(summary.pagesCaptured).toBe(duplicateDestinationsPagePaths.length)

      const selectorReport = readFileSync(join(outputDir, 'reports', 'selector-report.md'), 'utf-8')
      compareOrUpdateGoldenFile(selectorReport, join(GOLDEN_DIR, 'reports', 'selector-report.md'), 'selector-report.md')

      const homePom = readFileSync(join(outputDir, 'poms', 'home.page.ts'), 'utf-8')
      expect(homePom).toContain('readMoreLink1')
      expect(homePom).toContain('readMoreLink2')

      compareOrUpdateGoldenDir(join(outputDir, 'poms'), join(GOLDEN_DIR, 'poms'), 'duplicate-destinations poms')
      compareOrUpdateGoldenDir(join(outputDir, 'specs'), join(GOLDEN_DIR, 'specs'), 'duplicate-destinations specs')
    },
    120_000,
  )
})
