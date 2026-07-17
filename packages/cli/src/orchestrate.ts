import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { crawl, diffCrawls, openCrawlDb, urlHash } from '@treeline/core'
import type { CrawlConfig, CrawlResult, HardPageEntry } from '@treeline/core'
import { performLogin, launchHardened } from '@treeline/acquire'
import type { AuthSession, LoginCredentials } from '@treeline/acquire'
import { runInterpretation } from '@treeline/interpret'
import {
  generateSelectorReport,
  renderSelectorReportMarkdown,
  generateTestIdAudit,
  renderTestIdAuditMarkdown,
  generateAtlas,
  renderAtlasMarkdown,
  generatePOMsAndSpecs,
  generateProposedAssertionSpecs,
  generateAxeReport,
  renderAxeReportMarkdown,
  generateFlowMap,
  renderFlowMapMarkdown,
  generateCoverageReport,
  renderCoverageReportMarkdown,
  generateTimingReport,
  renderTimingReportMarkdown,
  generateProposalCoverageReport,
  renderProposalCoverageReportMarkdown,
  generateColorReport,
  renderColorReportMarkdown,
  classifyChange,
  renderDiffReportMarkdown,
} from '@treeline/output'

async function readHardPageEntries(hardPagesDir: string): Promise<HardPageEntry[]> {
  const files = await readdir(hardPagesDir)
  const entries: HardPageEntry[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    const raw = await readFile(join(hardPagesDir, file), 'utf-8')
    entries.push(JSON.parse(raw) as HardPageEntry)
  }
  return entries
}

export interface TreelineCrawlOptions {
  url: string
  stealth: boolean
  maxPages: number
  maxDepth: number
  throttleMs: number
  outputDir?: string
  skipInterpretation: boolean
  captureResponseBodies: boolean
  maxResponseBodyBytes: number
  loginUrl?: string
  username?: string
  usernameSelector?: string
  passwordSelector?: string
  submitSelector?: string
  successIndicator?: string
  detectAuthWall: boolean
}

export interface TreelineCrawlSummary {
  outputDir: string
  pagesCaptured: number
  pagesInterpreted: number
  hardPagesCount: number
  pomsGenerated: number
  specsGenerated: number
  proposedAssertionSpecsGenerated: number
  skippedElementsCount: number
  totalAxeViolations: number
  totalAxeNeedsReview: number
  flaggedSlowPages: number
  flaggedSlowNetworkRequests: number
  flaggedHighLatencyElements: number
  distinctColorsFound: number
  abortedAt?: CrawlResult['abortedAt']
}

function deriveOutputDir(url: string): string {
  const hostname = new URL(url).hostname.replace(/\./g, '-')
  return join('treeline-output', hostname)
}

export function formatAbortedCrawlMessage(abortedAt: NonNullable<CrawlResult['abortedAt']>, pagesCaptured: number): string {
  return `Crawl aborted: session expired at ${abortedAt.url} after ${pagesCaptured} pages — fix credentials and re-run to resume from here`
}

async function resolveAuthSession(options: TreelineCrawlOptions): Promise<AuthSession | undefined> {
  const authFlagsUsed =
    options.loginUrl !== undefined ||
    options.username !== undefined ||
    options.usernameSelector !== undefined ||
    options.passwordSelector !== undefined ||
    options.submitSelector !== undefined ||
    options.successIndicator !== undefined
  if (!authFlagsUsed) return undefined
  if (!options.loginUrl || !options.successIndicator) {
    throw new Error('Authenticated crawling requires both --login-url and --success-indicator to be set')
  }
  if (!options.username) {
    throw new Error('--username is required when --login-url is set')
  }
  const password = process.env.TREELINE_LOGIN_PASSWORD
  if (!password) {
    throw new Error('TREELINE_LOGIN_PASSWORD is not set — export it before using --login-url')
  }
  const creds: LoginCredentials = {
    loginUrl: options.loginUrl,
    username: options.username,
    password,
    successIndicator: options.successIndicator,
    usernameSelector: options.usernameSelector,
    passwordSelector: options.passwordSelector,
    submitSelector: options.submitSelector,
  }
  const browser = await launchHardened({ stealth: options.stealth })
  try {
    const storageState = await performLogin(browser, creds)
    return { storageState, successIndicator: creds.successIndicator, loginUrl: creds.loginUrl }
  } finally {
    await browser.close()
  }
}

export async function runTreelineCrawl(options: TreelineCrawlOptions): Promise<TreelineCrawlSummary> {
  if (!options.skipInterpretation && !process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set — export it or pass --skip-interpretation')
  }
  const authSession = await resolveAuthSession(options)
  if (authSession && options.detectAuthWall) {
    console.warn(
      '[treeline] --detect-auth-wall has no effect when --login-url is set — auth-wall detection only applies to crawls with no configured session. Ignoring --detect-auth-wall for this run.',
    )
  }
  const effectiveDetectAuthWall = options.detectAuthWall && !authSession
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
      captureResponseBodies: options.captureResponseBodies,
      maxResponseBodyBytes: options.maxResponseBodyBytes,
      detectAuthWall: effectiveDetectAuthWall,
    }
    const crawlResult = await crawl(crawlConfig, dbPath, hardPagesDir, authSession)
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
    const proposedAssertionSpecs = generateProposedAssertionSpecs(pages, interpretations)
    for (const spec of proposedAssertionSpecs) {
      await writeFile(join(specsDir, spec.fileName), spec.code)
    }
    await writeFile(join(outputDir, 'skipped-elements.json'), JSON.stringify(skipped, null, 2))
    const hardPageEntries = await readHardPageEntries(hardPagesDir)
    const coverageReport = generateCoverageReport(pages, skipped, hardPageEntries)
    await writeFile(join(reportsDir, 'coverage-report.md'), renderCoverageReportMarkdown(coverageReport))
    const timingReport = generateTimingReport(pages)
    await writeFile(join(reportsDir, 'timing-report.md'), renderTimingReportMarkdown(timingReport))
    const proposalCoverageReport = generateProposalCoverageReport(pages, interpretations)
    await writeFile(join(reportsDir, 'proposal-coverage-report.md'), renderProposalCoverageReportMarkdown(proposalCoverageReport))
    const colorReport = generateColorReport(pages)
    await writeFile(join(reportsDir, 'color-report.md'), renderColorReportMarkdown(colorReport))
    return {
      outputDir,
      pagesCaptured: capturedPages.length,
      pagesInterpreted: interpretations.length,
      hardPagesCount: hardPageEntries.length,
      pomsGenerated: poms.length,
      specsGenerated: specs.length,
      proposedAssertionSpecsGenerated: proposedAssertionSpecs.length,
      skippedElementsCount: skipped.length,
      totalAxeViolations: axeReport.totalViolations,
      totalAxeNeedsReview: axeReport.totalNeedsReview,
      flaggedSlowPages: timingReport.flaggedPageCount,
      flaggedSlowNetworkRequests: timingReport.flaggedNetworkRequestCount,
      flaggedHighLatencyElements: timingReport.flaggedElementCount,
      distinctColorsFound: colorReport.siteWideScheme.length,
      abortedAt: crawlResult.abortedAt,
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
