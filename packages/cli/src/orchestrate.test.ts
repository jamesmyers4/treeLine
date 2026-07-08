import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { runTreelineCrawl } from './orchestrate.js'

const pages: Record<string, string> = {
  '/': '<html><body><a href="/about">about</a><a href="/contact">contact</a></body></html>',
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
    const pomFiles = readdirSync(join(outputDir, 'poms'))
    const specFiles = readdirSync(join(outputDir, 'specs'))
    expect(pomFiles).toHaveLength(Object.keys(pages).length)
    expect(specFiles).toHaveLength(Object.keys(pages).length)
    expect(summary.pomsGenerated).toBe(pomFiles.length)
    expect(summary.specsGenerated).toBe(specFiles.length)
  }, 120_000)
})
