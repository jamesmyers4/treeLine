import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crawl, openCrawlDb } from '@treeline/core'
import type { CrawlConfig } from '@treeline/core'
import { runInterpretation } from '@treeline/interpret'
import {
  generateSelectorReport,
  renderSelectorReportMarkdown,
  generateTestIdAudit,
  renderTestIdAuditMarkdown,
  generateAtlas,
  renderAtlasMarkdown,
  generatePOMsAndSpecs,
  generateAxeReport,
  renderAxeReportMarkdown,
} from '@treeline/output'

export interface TreelineCrawlOptions {
  url: string
  stealth: boolean
  maxPages: number
  maxDepth: number
  throttleMs: number
  outputDir?: string
  skipInterpretation: boolean
}

export interface TreelineCrawlSummary {
  outputDir: string
  pagesCaptured: number
  pagesInterpreted: number
  hardPagesCount: number
  pomsGenerated: number
  specsGenerated: number
  skippedElementsCount: number
  totalAxeViolations: number
  totalAxeNeedsReview: number
}

function deriveOutputDir(url: string): string {
  const hostname = new URL(url).hostname.replace(/\./g, '-')
  return join('treeline-output', hostname)
}

export async function runTreelineCrawl(options: TreelineCrawlOptions): Promise<TreelineCrawlSummary> {
  if (!options.skipInterpretation && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set — export it or pass --skip-interpretation')
  }
  const outputDir = options.outputDir ?? deriveOutputDir(options.url)
  const hardPagesDir = join(outputDir, 'hard-pages')
  const reportsDir = join(outputDir, 'reports')
  const pomsDir = join(outputDir, 'poms')
  const specsDir = join(outputDir, 'specs')
  const dbPath = join(outputDir, 'crawl.sqlite')
  await mkdir(hardPagesDir, { recursive: true })
  await mkdir(reportsDir, { recursive: true })
  await mkdir(pomsDir, { recursive: true })
  await mkdir(specsDir, { recursive: true })
  let db: ReturnType<typeof openCrawlDb> | undefined
  try {
    const crawlConfig: CrawlConfig = {
      seedUrl: options.url,
      sameOriginOnly: true,
      maxDepth: options.maxDepth,
      maxPages: options.maxPages,
      stealth: options.stealth,
      respectRobotsTxt: true,
      throttleMs: options.throttleMs,
    }
    await crawl(crawlConfig, dbPath, hardPagesDir)
    if (!options.skipInterpretation) {
      await runInterpretation(dbPath, hardPagesDir)
    }
    db = openCrawlDb(dbPath)
    const pages = db.getAllPages()
    const interpretations = db.getAllInterpretations()
    const capturedPages = pages.filter((p) => p.title !== null && p.ariaSnapshot !== null && p.capturedAt !== null)
    const selectorReport = generateSelectorReport(pages)
    await writeFile(join(reportsDir, 'selector-report.md'), renderSelectorReportMarkdown(selectorReport))
    const testIdAudit = generateTestIdAudit(pages)
    await writeFile(join(reportsDir, 'testid-audit.md'), renderTestIdAuditMarkdown(testIdAudit))
    const atlas = generateAtlas(pages, interpretations)
    await writeFile(join(reportsDir, 'atlas.md'), renderAtlasMarkdown(atlas))
    const axeReport = generateAxeReport(pages)
    await writeFile(join(reportsDir, 'axe-report.md'), renderAxeReportMarkdown(axeReport))
    const { poms, specs, skipped } = generatePOMsAndSpecs(pages)
    for (const pom of poms) {
      await writeFile(join(pomsDir, pom.fileName), pom.code)
    }
    for (const spec of specs) {
      await writeFile(join(specsDir, spec.fileName), spec.code)
    }
    await writeFile(join(outputDir, 'skipped-elements.json'), JSON.stringify(skipped, null, 2))
    const hardPageFiles = await readdir(hardPagesDir)
    return {
      outputDir,
      pagesCaptured: capturedPages.length,
      pagesInterpreted: interpretations.length,
      hardPagesCount: hardPageFiles.length,
      pomsGenerated: poms.length,
      specsGenerated: specs.length,
      skippedElementsCount: skipped.length,
      totalAxeViolations: axeReport.totalViolations,
      totalAxeNeedsReview: axeReport.totalNeedsReview,
    }
  } finally {
    db?.close()
  }
}
