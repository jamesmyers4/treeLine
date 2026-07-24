import { describe, expect, it, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openCrawlDb } from '@treeline/core'
import { renderOutputToHtml } from './render.js'

const fixtureOutputDir = path.join(import.meta.dirname, '..', 'test', 'fixtures', 'sample-output')

const tmpDirs: string[] = []

async function makeTargetDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'treeline-pages-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir) await fs.rm(dir, { recursive: true, force: true })
  }
})

describe('renderOutputToHtml', () => {
  it('renders every real report, POM, and spec from a real crawl+diff output directory', async () => {
    const targetDir = await makeTargetDir()
    const result = await renderOutputToHtml(fixtureOutputDir, targetDir)

    expect(result.reports.map((r) => path.basename(r.sourcePath)).sort()).toEqual([
      'atlas.md',
      'axe-report.md',
      'diff-report.md',
      'flow-map.md',
      'selector-report.md',
      'testid-audit.md'
    ])
    expect(result.poms).toHaveLength(1)
    expect(result.specs).toHaveLength(1)
    expect(result.visualDiffImages).toEqual(['b559c7edd3fb.png'])

    for (const page of [...result.reports, ...result.poms, ...result.specs]) {
      const stat = await fs.stat(page.outputPath)
      expect(stat.isFile()).toBe(true)
    }
  })

  it('produces an index.html linking to every rendered file', async () => {
    const targetDir = await makeTargetDir()
    await renderOutputToHtml(fixtureOutputDir, targetDir)

    const index = await fs.readFile(path.join(targetDir, 'index.html'), 'utf-8')
    expect(index).toContain('reports/atlas.html')
    expect(index).toContain('reports/diff-report.html')
    expect(index).toContain('poms/home.page.html')
    expect(index).toContain('specs/home.spec.html')
  })

  it('copies visual-diff images alongside the rendered diff report and preserves the relative link', async () => {
    const targetDir = await makeTargetDir()
    await renderOutputToHtml(fixtureOutputDir, targetDir)

    const copiedImage = path.join(targetDir, 'reports', 'visual-diffs', 'b559c7edd3fb.png')
    const stat = await fs.stat(copiedImage)
    expect(stat.isFile()).toBe(true)

    const diffHtml = await fs.readFile(path.join(targetDir, 'reports', 'diff-report.html'), 'utf-8')
    expect(diffHtml).toContain('<img src="visual-diffs/b559c7edd3fb.png"')
  })

  it('renders a POM as syntax-highlighted HTML, not raw source', async () => {
    const targetDir = await makeTargetDir()
    await renderOutputToHtml(fixtureOutputDir, targetDir)

    const pomHtml = await fs.readFile(path.join(targetDir, 'poms', 'home.page.html'), 'utf-8')
    expect(pomHtml).toContain('class="shiki')
    expect(pomHtml).toContain('HomePage')
  })

  it('writes a meta.json alongside the rendered output, detecting diff mode from the reports present', async () => {
    const targetDir = await makeTargetDir()
    const result = await renderOutputToHtml(fixtureOutputDir, targetDir)

    expect(result.meta.mode).toBe('diff')
    expect(typeof result.meta.renderedAt).toBe('string')
    expect(result.meta.targetUrl).toBeNull()
    expect(result.meta.pageCount).toBeNull()

    const metaJson = await fs.readFile(path.join(targetDir, 'meta.json'), 'utf-8')
    expect(JSON.parse(metaJson)).toEqual(result.meta)
  })

  it('populates meta.json targetUrl and pageCount from a real crawl.sqlite, and detects crawl (not diff) mode', async () => {
    const outputDir = await makeTargetDir()
    await fs.mkdir(path.join(outputDir, 'reports'), { recursive: true })
    await fs.writeFile(path.join(outputDir, 'reports', 'atlas.md'), '# Site Atlas\n\n1 pages captured, 0 interpreted\n')
    const db = openCrawlDb(path.join(outputDir, 'crawl.sqlite'))
    db.insertMeta('https://example.com/', {
      seedUrl: 'https://example.com/',
      sameOriginOnly: true,
      maxDepth: 2,
      maxPages: 20,
      stealth: false,
      respectRobotsTxt: true,
      throttleMs: 500,
    })
    db.recordPageState({
      url: 'https://example.com/',
      title: 'Example',
      ariaSnapshot: '',
      links: [],
      networkLog: [],
      screenshot: null,
      capturedAt: new Date().toISOString(),
      pageLoadMs: 500,
      interactiveElements: [],
      axeViolations: [],
      axeIncomplete: [],
      forms: [],
      colorPalette: [],
      assertableAttributes: [],
    })
    db.close()

    const targetDir = await makeTargetDir()
    const result = await renderOutputToHtml(outputDir, targetDir)

    expect(result.meta.mode).toBe('crawl')
    expect(result.meta.targetUrl).toBe('https://example.com/')
    expect(result.meta.pageCount).toBe(1)
  })
})
