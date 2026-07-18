import { Command } from 'commander'
import { runTreelineCrawl, runTreelineDiff, formatAbortedCrawlMessage } from './orchestrate.js'
import type { TreelineCrawlOptions, TreelineDiffOptions } from './orchestrate.js'

interface RawCrawlOptions {
  stealth: boolean
  maxPages: string
  maxDepth: string
  throttleMs: string
  output?: string
  skipInterpretation: boolean
  captureResponseBodies: boolean
  maxResponseBodyBytes: string
  captureRequestBodies: boolean
  maxRequestBodyBytes: string
  loginUrl?: string
  username?: string
  usernameSelector?: string
  passwordSelector?: string
  submitSelector?: string
  successIndicator?: string
  detectAuthWall: boolean
  insecureCerts: boolean
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
  .option('--capture-response-bodies', 'capture a sample response body for JSON API calls', false)
  .option('--max-response-body-bytes <n>', 'maximum response body size to capture, in bytes', '512000')
  .option('--capture-request-bodies', 'capture request body field names (values redacted) for JSON and form-urlencoded POSTs', false)
  .option('--max-request-body-bytes <n>', 'maximum request body size to read for field-name extraction, in bytes', '65536')
  .option('--login-url <url>', 'URL of the login page, for authenticated crawling (required alongside --success-indicator)')
  .option('--username <user>', 'username for authenticated crawling (required alongside --login-url)')
  .option('--username-selector <selector>', 'CSS selector for the login form username field')
  .option('--password-selector <selector>', 'CSS selector for the login form password field')
  .option('--submit-selector <selector>', 'CSS selector for the login form submit control')
  .option('--success-indicator <selector>', 'CSS selector present only when authenticated (required alongside --login-url)')
  .option('--detect-auth-wall', 'flag pages that appear to require authentication when no credentials are configured', false)
  .option('--insecure-certs', 'ignore TLS certificate errors (self-signed/invalid certs) — for local/internal targets only, never a public site', false)
  .action(async (url: string, rawOptions: RawCrawlOptions) => {
    const options: TreelineCrawlOptions = {
      url,
      stealth: rawOptions.stealth,
      maxPages: Number(rawOptions.maxPages),
      maxDepth: Number(rawOptions.maxDepth),
      throttleMs: Number(rawOptions.throttleMs),
      outputDir: rawOptions.output,
      skipInterpretation: rawOptions.skipInterpretation,
      captureResponseBodies: rawOptions.captureResponseBodies,
      maxResponseBodyBytes: Number(rawOptions.maxResponseBodyBytes),
      captureRequestBodies: rawOptions.captureRequestBodies,
      maxRequestBodyBytes: Number(rawOptions.maxRequestBodyBytes),
      loginUrl: rawOptions.loginUrl,
      username: rawOptions.username,
      usernameSelector: rawOptions.usernameSelector,
      passwordSelector: rawOptions.passwordSelector,
      submitSelector: rawOptions.submitSelector,
      successIndicator: rawOptions.successIndicator,
      detectAuthWall: rawOptions.detectAuthWall,
      insecureCerts: rawOptions.insecureCerts,
    }
    try {
      const summary = await runTreelineCrawl(options)
      if (summary.abortedAt) {
        console.log(formatAbortedCrawlMessage(summary.abortedAt, summary.pagesCaptured))
      }
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
      console.log(`Distinct colors found: ${summary.distinctColorsFound}`)
      if (summary.apiTestScaffoldGenerated) {
        console.log('API test scaffold: reports/api-test-scaffold.md')
      }
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
