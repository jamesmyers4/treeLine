import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { runNavMapAudit } from './verify.js'

interface RawVerifyOptions {
  baseUrl: string
  loginUrl: string
  username: string
  successIndicator: string
  output?: string
  insecureCerts: boolean
  dismissSelector?: string
  findingsFile?: string
}

function deriveOutputDir(baseUrl: string): string {
  const hostname = new URL(baseUrl).hostname.replace(/\./g, '-')
  return `treeline-verify-output/${hostname}`
}

const program = new Command()
program.name('verify').description('Audit a human-supplied nav-label map against a live authenticated target')

program
  .argument('<navMapFile>', 'path to a JSON nav-map file')
  .option('--base-url <url>', 'URL to start the audit from, after login')
  .option('--login-url <url>', 'URL of the login page')
  .option('--username <user>', 'username for authentication')
  .option('--success-indicator <selector>', 'CSS selector present only when authenticated')
  .option('--output <dir>', 'output directory for verify-report.md')
  .option('--insecure-certs', 'ignore TLS certificate errors (self-signed/invalid certs) — for local/internal targets only', false)
  .option('--dismiss-selector <selector>', 'optional selector for a blocking overlay/modal to dismiss once after login, before auditing')
  .option('--findings-file <path>', 'optional path to a markdown file whose blank-line-separated paragraphs are appended to verify-report.md under a Findings section')
  .action(async (navMapFile: string, rawOptions: RawVerifyOptions) => {
    const password = process.env.TREELINE_LOGIN_PASSWORD
    if (!password) {
      console.error('Error: TREELINE_LOGIN_PASSWORD environment variable is required')
      process.exitCode = 1
      return
    }
    if (!rawOptions.baseUrl || !rawOptions.loginUrl || !rawOptions.username || !rawOptions.successIndicator) {
      console.error('Error: --base-url, --login-url, --username, and --success-indicator are all required')
      process.exitCode = 1
      return
    }
    const findings = rawOptions.findingsFile
      ? readFileSync(rawOptions.findingsFile, 'utf-8').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
      : undefined
    try {
      const summary = await runNavMapAudit({
        navMapPath: navMapFile,
        baseUrl: rawOptions.baseUrl,
        loginUrl: rawOptions.loginUrl,
        username: rawOptions.username,
        password,
        successIndicator: rawOptions.successIndicator,
        outputDir: rawOptions.output ?? deriveOutputDir(rawOptions.baseUrl),
        insecureCerts: rawOptions.insecureCerts,
        dismissSelector: rawOptions.dismissSelector,
        findings,
      })
      console.log(`Entries checked: ${summary.totalEntries}`)
      console.log(`Matches: ${summary.matches}`)
      console.log(`Mismatches: ${summary.mismatches}`)
      console.log(`Skipped: ${summary.skipped}`)
      console.log(`Errors: ${summary.errors}`)
      console.log(`Report: ${summary.reportPath}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Error: ${message}`)
      process.exitCode = 1
    }
    process.exit(process.exitCode ?? 0)
  })

program.parse()
