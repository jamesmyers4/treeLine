import { Command } from 'commander'
import { runTreelineCrawl, runTreelineDiff } from './orchestrate.js'
import type { TreelineCrawlOptions, TreelineDiffOptions } from './orchestrate.js'

interface RawCrawlOptions {
  stealth: boolean
  maxPages: string
  maxDepth: string
  throttleMs: string
  output?: string
  skipInterpretation: boolean
}

interface RawDiffOptions {
  output?: string
  failOnRegression: boolean
}

const program = new Command()
program.name('treeline').description('AI-powered site comprehension engine')

program
  .command('crawl <url>')
  .description('Crawl a site and generate test artifacts, docs, and data')
  .option('--stealth', 'enable hardened stealth acquisition', false)
  .option('--max-pages <n>', 'maximum number of pages to crawl', '20')
  .option('--max-depth <n>', 'maximum link depth to crawl', '2')
  .option('--throttle-ms <n>', 'delay between requests in milliseconds', '500')
  .option('--output <dir>', 'output directory for crawl artifacts')
  .option('--skip-interpretation', 'skip AI interpretation of captured pages', false)
  .action(async (url: string, rawOptions: RawCrawlOptions) => {
    const options: TreelineCrawlOptions = {
      url,
      stealth: rawOptions.stealth,
      maxPages: Number(rawOptions.maxPages),
      maxDepth: Number(rawOptions.maxDepth),
      throttleMs: Number(rawOptions.throttleMs),
      outputDir: rawOptions.output,
      skipInterpretation: rawOptions.skipInterpretation,
    }
    try {
      const summary = await runTreelineCrawl(options)
      console.log(`Output directory: ${summary.outputDir}`)
      console.log(`Pages captured: ${summary.pagesCaptured}`)
      console.log(`Pages interpreted: ${summary.pagesInterpreted}`)
      console.log(`Hard pages: ${summary.hardPagesCount}`)
      console.log(`POMs generated: ${summary.pomsGenerated}`)
      console.log(`Specs generated: ${summary.specsGenerated}`)
      console.log(`Proposed assertion specs generated: ${summary.proposedAssertionSpecsGenerated}`)
      console.log(`Skipped elements: ${summary.skippedElementsCount}`)
      console.log(`Axe violations: ${summary.totalAxeViolations}`)
      console.log(`Axe needs review: ${summary.totalAxeNeedsReview}`)
      console.log(`Slow-loading pages: ${summary.flaggedSlowPages}`)
      console.log(`Slow network requests: ${summary.flaggedSlowNetworkRequests}`)
      console.log(`High-latency elements: ${summary.flaggedHighLatencyElements}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Error: ${message}`)
      process.exitCode = 1
    }
    process.exit(process.exitCode ?? 0)
  })

program
  .command('diff <baselineDir> <currentDir>')
  .description('Compare two crawl output directories and generate a diff report')
  .option('--output <dir>', 'output directory for the diff report')
  .option('--fail-on-regression', 'exit with code 1 if selector regressions are found', false)
  .action(async (baselineDir: string, currentDir: string, rawOptions: RawDiffOptions) => {
    const options: TreelineDiffOptions = {
      baselineDir,
      currentDir,
      outputDir: rawOptions.output,
    }
    try {
      const summary = await runTreelineDiff(options)
      console.log(`Pages added: ${summary.pagesAdded}`)
      console.log(`Pages removed: ${summary.pagesRemoved}`)
      console.log(`Title changes: ${summary.titleChanges}`)
      console.log(`Selector regressions: ${summary.selectorRegressions}`)
      console.log(`Selector improvements: ${summary.selectorImprovements}`)
      console.log(`Other selector changes: ${summary.selectorOther}`)
      console.log(`Visual changes: ${summary.visualChanges}`)
      console.log(`Report: ${summary.reportPath}`)
      if (rawOptions.failOnRegression && summary.hasRegressions) {
        process.exitCode = 1
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Error: ${message}`)
      process.exitCode = 1
    }
    process.exit(process.exitCode ?? 0)
  })

program.parse()
