import { existsSync } from 'node:fs'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crawl, diffCrawls, openCrawlDb, urlHash } from '@treeline/core'
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
  generateFlowMap,
  renderFlowMapMarkdown,
  classifyChange,
  renderDiffReportMarkdown,
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
    const flowMap = generateFlowMap(pages)
    await writeFile(join(reportsDir, 'flow-map.md'), renderFlowMapMarkdown(flowMap))
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

export interface TreelineDiffOptions {
  baselineDir: string
  currentDir: string
  outputDir?: string
}

export interface TreelineDiffSummary {
  reportPath: string
  pagesAdded: number
  pagesRemoved: number
  titleChanges: number
  selectorRegressions: number
  selectorImprovements: number
  selectorOther: number
  hasRegressions: boolean
  visualChanges: number
}

export async function runTreelineDiff(options: TreelineDiffOptions): Promise<TreelineDiffSummary> {
  const baselineDbPath = join(options.baselineDir, 'crawl.sqlite')
  const currentDbPath = join(options.currentDir, 'crawl.sqlite')
  if (!existsSync(baselineDbPath)) {
    throw new Error(`Baseline crawl not found: no crawl.sqlite in ${options.baselineDir}`)
  }
  if (!existsSync(currentDbPath)) {
    throw new Error(`Current crawl not found: no crawl.sqlite in ${options.currentDir}`)
  }
  const diff = diffCrawls(baselineDbPath, currentDbPath)
  const regressions = diff.selectorCandidateChanges.filter((change) => classifyChange(change) === 'regression')
  const improvements = diff.selectorCandidateChanges.filter((change) => classifyChange(change) === 'improvement')
  const other = diff.selectorCandidateChanges.filter((change) => classifyChange(change) === 'other')
  const resolvedOutputDir = options.outputDir ?? options.currentDir
  const reportsDir = join(resolvedOutputDir, 'reports')
  await mkdir(reportsDir, { recursive: true })
  const reportPath = join(reportsDir, 'diff-report.md')
  await writeFile(reportPath, renderDiffReportMarkdown(diff))
  const changedVisuals = diff.visualChanges.filter((change) => change.status === 'changed' && change.diffImageBuffer !== null)
  if (changedVisuals.length > 0) {
    const visualDiffsDir = join(reportsDir, 'visual-diffs')
    await mkdir(visualDiffsDir, { recursive: true })
    for (const change of changedVisuals) {
      await writeFile(join(visualDiffsDir, `${urlHash(change.url)}.png`), change.diffImageBuffer!)
    }
  }
  return {
    reportPath,
    pagesAdded: diff.pagesAdded.length,
    pagesRemoved: diff.pagesRemoved.length,
    titleChanges: diff.titleChanges.length,
    selectorRegressions: regressions.length,
    selectorImprovements: improvements.length,
    selectorOther: other.length,
    hasRegressions: regressions.length > 0,
    visualChanges: changedVisuals.length,
  }
}
