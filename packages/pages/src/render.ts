import { promises as fs } from 'node:fs'
import path from 'node:path'
import { discoverPoms, discoverReports, discoverSpecs, discoverVisualDiffs } from './discover.js'
import { extractTitle, renderMarkdownFragment } from './markdown.js'
import { renderTypeScriptFragment } from './code.js'
import { htmlPage } from './template.js'
import { renderIndexHtml } from './index-page.js'
import { buildRunMeta } from './meta.js'
import type { RenderedPage, RenderResult } from './types.js'

async function renderReports(outputDir: string, targetDir: string): Promise<RenderedPage[]> {
  const files = await discoverReports(outputDir)
  const pages: RenderedPage[] = []
  for (const file of files) {
    const sourcePath = path.join(outputDir, 'reports', file)
    const source = await fs.readFile(sourcePath, 'utf-8')
    const title = extractTitle(source, file)
    const fragment = renderMarkdownFragment(source)
    const outputPath = path.join(targetDir, 'reports', file.replace(/\.md$/, '.html'))
    await fs.writeFile(outputPath, htmlPage(title, fragment, '../index.html'))
    pages.push({ title, sourcePath, outputPath })
  }
  return pages
}

async function renderTsDirectory(
  outputDir: string,
  targetDir: string,
  dirName: 'poms' | 'specs',
  files: string[]
): Promise<RenderedPage[]> {
  const pages: RenderedPage[] = []
  for (const file of files) {
    const sourcePath = path.join(outputDir, dirName, file)
    const source = await fs.readFile(sourcePath, 'utf-8')
    const fragment = await renderTypeScriptFragment(source)
    const outputPath = path.join(targetDir, dirName, file.replace(/\.ts$/, '.html'))
    await fs.writeFile(outputPath, htmlPage(file, fragment, '../index.html'))
    pages.push({ title: file, sourcePath, outputPath })
  }
  return pages
}

async function copyVisualDiffs(outputDir: string, targetDir: string): Promise<string[]> {
  const files = await discoverVisualDiffs(outputDir)
  if (files.length === 0) return []
  const destDir = path.join(targetDir, 'reports', 'visual-diffs')
  await fs.mkdir(destDir, { recursive: true })
  for (const file of files) {
    await fs.copyFile(
      path.join(outputDir, 'reports', 'visual-diffs', file),
      path.join(destDir, file)
    )
  }
  return files
}

export async function renderOutputToHtml(outputDir: string, targetDir: string): Promise<RenderResult> {
  await fs.mkdir(path.join(targetDir, 'reports'), { recursive: true })
  await fs.mkdir(path.join(targetDir, 'poms'), { recursive: true })
  await fs.mkdir(path.join(targetDir, 'specs'), { recursive: true })

  const visualDiffImages = await copyVisualDiffs(outputDir, targetDir)
  const reports = await renderReports(outputDir, targetDir)

  const pomFiles = await discoverPoms(outputDir)
  const poms = await renderTsDirectory(outputDir, targetDir, 'poms', pomFiles)

  const specFiles = await discoverSpecs(outputDir)
  const specs = await renderTsDirectory(outputDir, targetDir, 'specs', specFiles)

  const indexPath = path.join(targetDir, 'index.html')
  await fs.writeFile(indexPath, renderIndexHtml(targetDir, reports, poms, specs))

  const mode = reports.some((r) => path.basename(r.sourcePath) === 'diff-report.md') ? 'diff' : 'crawl'
  const meta = buildRunMeta(outputDir, mode)
  await fs.writeFile(path.join(targetDir, 'meta.json'), JSON.stringify(meta, null, 2))

  return { outputDir, targetDir, indexPath, reports, poms, specs, visualDiffImages, meta }
}
