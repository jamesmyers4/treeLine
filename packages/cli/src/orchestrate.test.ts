import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { PNG } from 'pngjs'
import { openCrawlDb, urlHash } from '@treeline/core'
import type { DomInteractiveElement, PageState } from '@treeline/acquire'
import { runTreelineCrawl, runTreelineDiff } from './orchestrate.js'

function solidPng(width: number, height: number, color: [number, number, number]): Buffer {
  const png = new PNG({ width, height })
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) * 4
      png.data[idx] = color[0]
      png.data[idx + 1] = color[1]
      png.data[idx + 2] = color[2]
      png.data[idx + 3] = 255
    }
  }
  return PNG.sync.write(png)
}

const pages: Record<string, string> = {
  '/': '<html><body><a href="/about">about</a><a href="/contact">contact</a><form action="/submit" method="post"><input aria-label="Email" type="email" required /></form><script>fetch("/api/ping")</script></body></html>',
  '/about': '<html><body><a href="/">home</a><a href="/contact">contact</a></body></html>',
  '/contact': '<html><body><a href="/">home</a><a href="/about">about</a></body></html>',
}

let server: Server
let baseUrl: string
let tmpDir: string
let outputDir: string

beforeAll(async () => {
  server = createServer((req, res) => {
    const html = pages[req.url ?? '/'] ?? '<html><body>not found</body></html>'
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${addr.port}`
  tmpDir = mkdtempSync(join(tmpdir(), 'treeline-orchestrate-cli-'))
  outputDir = join(tmpDir, 'output')
})

afterAll(() => {
  server.close()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('runTreelineCrawl', () => {
  it('crawls, skips interpretation, and generates all output artifacts', async () => {
    const summary = await runTreelineCrawl({
      url: `${baseUrl}/`,
      stealth: false,
      maxPages: 10,
      maxDepth: 5,
      throttleMs: 0,
      outputDir,
      skipInterpretation: true,
    })
    expect(summary.pagesCaptured).toBe(Object.keys(pages).length)
    expect(summary.pagesInterpreted).toBe(0)
    expect(existsSync(join(outputDir, 'hard-pages'))).toBe(true)
    expect(existsSync(join(outputDir, 'reports'))).toBe(true)
    expect(existsSync(join(outputDir, 'poms'))).toBe(true)
    expect(existsSync(join(outputDir, 'specs'))).toBe(true)
    expect(existsSync(join(outputDir, 'crawl.sqlite'))).toBe(true)
    const selectorReport = readFileSync(join(outputDir, 'reports', 'selector-report.md'), 'utf-8')
    expect(selectorReport.length).toBeGreaterThan(0)
    const testIdAudit = readFileSync(join(outputDir, 'reports', 'testid-audit.md'), 'utf-8')
    expect(testIdAudit.length).toBeGreaterThan(0)
    const atlas = readFileSync(join(outputDir, 'reports', 'atlas.md'), 'utf-8')
    expect(atlas.length).toBeGreaterThan(0)
    expect(atlas).toContain('has not yet been interpreted')
    const axeReport = readFileSync(join(outputDir, 'reports', 'axe-report.md'), 'utf-8')
    expect(axeReport.length).toBeGreaterThan(0)
    const flowMap = readFileSync(join(outputDir, 'reports', 'flow-map.md'), 'utf-8')
    expect(flowMap.length).toBeGreaterThan(0)
    expect(flowMap).toContain('Email')
    expect(flowMap).toContain('/api/ping')
    const coverageReport = readFileSync(join(outputDir, 'reports', 'coverage-report.md'), 'utf-8')
    expect(coverageReport.length).toBeGreaterThan(0)
    expect(coverageReport).toContain('# Coverage Gap Report')
    const pomFiles = readdirSync(join(outputDir, 'poms'))
    const specFiles = readdirSync(join(outputDir, 'specs'))
    expect(pomFiles).toHaveLength(Object.keys(pages).length)
    expect(specFiles).toHaveLength(Object.keys(pages).length)
    expect(summary.pomsGenerated).toBe(pomFiles.length)
    expect(summary.specsGenerated).toBe(specFiles.length)
    expect(typeof summary.totalAxeViolations).toBe('number')
    expect(typeof summary.totalAxeNeedsReview).toBe('number')
  }, 120_000)
})

function makeElement(overrides: Partial<DomInteractiveElement>): DomInteractiveElement {
  return {
    role: 'button',
    accessibleName: 'Submit',
    testId: null,
    tagName: 'button',
    elementId: null,
    classList: [],
    cssPath: 'body > button',
    xpath: '/html/body/button',
    appearedAtMs: null,
    ...overrides,
  }
}

function makePage(
  url: string,
  title: string,
  interactiveElements: DomInteractiveElement[] = [],
  screenshot: Buffer | null = null,
): PageState {
  return {
    url,
    title,
    ariaSnapshot: '',
    links: [],
    networkLog: [],
    screenshot,
    capturedAt: new Date().toISOString(),
    pageLoadMs: 500,
    interactiveElements,
    axeViolations: [],
    axeIncomplete: [],
    forms: [],
  }
}

function seedDb(dbPath: string, pages: PageState[]): void {
  mkdirSync(join(dbPath, '..'), { recursive: true })
  const db = openCrawlDb(dbPath)
  for (const page of pages) {
    db.recordPageState(page)
  }
  db.close()
}

describe('runTreelineDiff', () => {
  let diffTmpDir: string
  let baselineDir: string
  let currentDir: string

  beforeEach(() => {
    diffTmpDir = mkdtempSync(join(tmpdir(), 'treeline-diff-cli-'))
    baselineDir = join(diffTmpDir, 'baseline')
    currentDir = join(diffTmpDir, 'current')
  })

  afterEach(() => {
    rmSync(diffTmpDir, { recursive: true, force: true })
  })

  it('diffs two crawl dirs, writes a report under reports/, and returns matching counts', async () => {
    seedDb(join(baselineDir, 'crawl.sqlite'), [
      makePage('https://example.com/', 'Home', [makeElement({})]),
      makePage('https://example.com/about', 'About'),
    ])
    seedDb(join(currentDir, 'crawl.sqlite'), [
      makePage('https://example.com/', 'Home', [makeElement({}), makeElement({})]),
      makePage('https://example.com/new', 'New Page'),
    ])

    const summary = await runTreelineDiff({ baselineDir, currentDir })

    expect(summary.reportPath).toBe(join(currentDir, 'reports', 'diff-report.md'))
    expect(existsSync(summary.reportPath)).toBe(true)
    expect(summary.pagesAdded).toBe(1)
    expect(summary.pagesRemoved).toBe(1)
    expect(summary.selectorRegressions).toBe(1)
    expect(summary.hasRegressions).toBe(true)

    const report = readFileSync(summary.reportPath, 'utf-8')
    expect(report).toContain(`${summary.pagesAdded} pages added`)
    expect(report).toContain(`${summary.selectorRegressions} selector regressions`)
  })

  it('writes the report under the given --output dir instead of currentDir', async () => {
    seedDb(join(baselineDir, 'crawl.sqlite'), [makePage('https://example.com/', 'Home')])
    seedDb(join(currentDir, 'crawl.sqlite'), [makePage('https://example.com/', 'Home')])
    const explicitOutputDir = join(diffTmpDir, 'diff-output')

    const summary = await runTreelineDiff({ baselineDir, currentDir, outputDir: explicitOutputDir })

    expect(summary.reportPath).toBe(join(explicitOutputDir, 'reports', 'diff-report.md'))
    expect(existsSync(summary.reportPath)).toBe(true)
  })

  it('throws a specific error when the baseline dir has no crawl.sqlite', async () => {
    seedDb(join(currentDir, 'crawl.sqlite'), [makePage('https://example.com/', 'Home')])

    await expect(runTreelineDiff({ baselineDir, currentDir })).rejects.toThrow(/Baseline crawl not found.*baseline/)
    expect(existsSync(join(currentDir, 'reports', 'diff-report.md'))).toBe(false)
  })

  it('throws a specific error when the current dir has no crawl.sqlite', async () => {
    seedDb(join(baselineDir, 'crawl.sqlite'), [makePage('https://example.com/', 'Home')])

    await expect(runTreelineDiff({ baselineDir, currentDir })).rejects.toThrow(/Current crawl not found.*current/)
  })

  it('writes a visual diff PNG to disk at the path the report references, matching the original buffer', async () => {
    seedDb(join(baselineDir, 'crawl.sqlite'), [
      makePage('https://example.com/', 'Home', [], solidPng(20, 20, [255, 255, 255])),
    ])
    seedDb(join(currentDir, 'crawl.sqlite'), [
      makePage('https://example.com/', 'Home', [], solidPng(20, 20, [0, 0, 0])),
    ])

    const summary = await runTreelineDiff({ baselineDir, currentDir })

    expect(summary.visualChanges).toBe(1)
    const imagePath = join(currentDir, 'reports', 'visual-diffs', `${urlHash('https://example.com/')}.png`)
    expect(existsSync(imagePath)).toBe(true)
    const report = readFileSync(summary.reportPath, 'utf-8')
    expect(report).toContain(`visual-diffs/${urlHash('https://example.com/')}.png`)
    expect(report).toContain(`${summary.visualChanges} visual changes`)
  })

  it('does not create a visual-diffs directory when there are no changed pages', async () => {
    const png = solidPng(20, 20, [10, 20, 30])
    seedDb(join(baselineDir, 'crawl.sqlite'), [makePage('https://example.com/', 'Home', [], png)])
    seedDb(join(currentDir, 'crawl.sqlite'), [makePage('https://example.com/', 'Home', [], png)])

    const summary = await runTreelineDiff({ baselineDir, currentDir })

    expect(summary.visualChanges).toBe(0)
    expect(existsSync(join(currentDir, 'reports', 'visual-diffs'))).toBe(false)
  })

  it('writes multiple visual diff PNGs, each at its own correct path', async () => {
    seedDb(join(baselineDir, 'crawl.sqlite'), [
      makePage('https://example.com/', 'Home', [], solidPng(20, 20, [255, 255, 255])),
      makePage('https://example.com/about', 'About', [], solidPng(20, 20, [255, 0, 0])),
    ])
    seedDb(join(currentDir, 'crawl.sqlite'), [
      makePage('https://example.com/', 'Home', [], solidPng(20, 20, [0, 0, 0])),
      makePage('https://example.com/about', 'About', [], solidPng(20, 20, [0, 255, 0])),
    ])

    const summary = await runTreelineDiff({ baselineDir, currentDir })

    expect(summary.visualChanges).toBe(2)
    const visualDiffsDir = join(currentDir, 'reports', 'visual-diffs')
    expect(existsSync(join(visualDiffsDir, `${urlHash('https://example.com/')}.png`))).toBe(true)
    expect(existsSync(join(visualDiffsDir, `${urlHash('https://example.com/about')}.png`))).toBe(true)
    expect(readdirSync(visualDiffsDir)).toHaveLength(2)
  })

  it('overwrites cleanly when run twice against the same output dir', async () => {
    seedDb(join(baselineDir, 'crawl.sqlite'), [
      makePage('https://example.com/', 'Home', [], solidPng(20, 20, [255, 255, 255])),
    ])
    seedDb(join(currentDir, 'crawl.sqlite'), [
      makePage('https://example.com/', 'Home', [], solidPng(20, 20, [0, 0, 0])),
    ])

    await runTreelineDiff({ baselineDir, currentDir })
    const summary = await runTreelineDiff({ baselineDir, currentDir })

    expect(summary.visualChanges).toBe(1)
    const imagePath = join(currentDir, 'reports', 'visual-diffs', `${urlHash('https://example.com/')}.png`)
    expect(existsSync(imagePath)).toBe(true)
  })

  it('reports a visual change without marking hasRegressions, keeping --fail-on-regression exit behavior tied only to selector regressions', async () => {
    seedDb(join(baselineDir, 'crawl.sqlite'), [
      makePage('https://example.com/', 'Home', [], solidPng(20, 20, [255, 255, 255])),
    ])
    seedDb(join(currentDir, 'crawl.sqlite'), [
      makePage('https://example.com/', 'Home', [], solidPng(20, 20, [0, 0, 0])),
    ])

    const summary = await runTreelineDiff({ baselineDir, currentDir })

    expect(summary.visualChanges).toBe(1)
    expect(summary.selectorRegressions).toBe(0)
    expect(summary.hasRegressions).toBe(false)
  })

  it('still reports hasRegressions=true for a real selector regression, unaffected by this session (existing behavior)', async () => {
    seedDb(join(baselineDir, 'crawl.sqlite'), [
      makePage('https://example.com/', 'Home', [makeElement({})]),
    ])
    seedDb(join(currentDir, 'crawl.sqlite'), [
      makePage('https://example.com/', 'Home', [makeElement({}), makeElement({})]),
    ])

    const summary = await runTreelineDiff({ baselineDir, currentDir })

    expect(summary.selectorRegressions).toBe(1)
    expect(summary.hasRegressions).toBe(true)
    expect(summary.visualChanges).toBe(0)
  })
})
