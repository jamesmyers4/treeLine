import { describe, expect, it, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
})
