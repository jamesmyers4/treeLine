import { readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { launchHardened, performLoginSession, AuthExpiredError, SeedAuthenticationError } from '@treeline/acquire'
import type { LoginCredentials } from '@treeline/acquire'
import { auditNavMapEntry } from './nav-audit.js'
import { writeVerifyReport } from './report.js'
import type { NavMapEntry, NavMapAuditResult, VerifyRunOptions, VerifyRunSummary } from './types.js'

export async function loadNavMap(navMapPath: string): Promise<NavMapEntry[]> {
  const raw = await readFile(navMapPath, 'utf-8')
  const parsed = JSON.parse(raw) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error(`Nav map at ${navMapPath} must be a JSON array`)
  }
  for (const entry of parsed) {
    const e = entry as Partial<NavMapEntry>
    if (typeof e.label !== 'string' || typeof e.expectedUrl !== 'string' || !Array.isArray(e.clickPath)) {
      throw new Error(`Invalid nav map entry: ${JSON.stringify(entry)}`)
    }
  }
  return parsed as NavMapEntry[]
}

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function samePage(a: string, b: string): boolean {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    return ua.origin === ub.origin && ua.pathname.replace(/\/$/, '') === ub.pathname.replace(/\/$/, '')
  } catch {
    return a === b
  }
}

export async function runNavMapAudit(options: VerifyRunOptions): Promise<VerifyRunSummary> {
  const entries = await loadNavMap(options.navMapPath)
  await mkdir(options.outputDir, { recursive: true })
  const mismatchesDir = join(options.outputDir, 'verify-mismatches')
  const browser = await launchHardened({ insecureCerts: options.insecureCerts })
  const results: NavMapAuditResult[] = []
  try {
    const credentials: LoginCredentials = {
      loginUrl: options.loginUrl,
      username: options.username,
      password: options.password,
      successIndicator: options.successIndicator,
    }
    const { context, page } = await performLoginSession(browser, credentials, { insecureCerts: options.insecureCerts })
    try {
      if (!samePage(page.url(), options.baseUrl)) {
        await page.goto(options.baseUrl, { waitUntil: 'domcontentloaded' })
        await page.waitForLoadState('networkidle').catch(() => undefined)
      }
      const stillValidAtStart = await page.locator(options.successIndicator).count() > 0
      if (!stillValidAtStart) {
        throw new SeedAuthenticationError(options.baseUrl, page.url())
      }
      if (options.dismissSelector) {
        const dismiss = page.locator(options.dismissSelector)
        if (await dismiss.count() > 0) {
          await dismiss.first().click()
          await page.waitForLoadState('networkidle').catch(() => undefined)
        }
      }
      for (const entry of entries) {
        let result: NavMapAuditResult
        try {
          result = await auditNavMapEntry(page, entry, options.loginUrl, options.successIndicator)
        } catch (err) {
          if (err instanceof AuthExpiredError) {
            results.push({ label: entry.label, expectedUrl: entry.expectedUrl, observedUrl: null, status: 'error', errorMessage: 'Session expired mid-run; remaining entries not attempted' })
            break
          }
          throw err
        }
        if (result.status === 'mismatch' || result.status === 'error') {
          await mkdir(mismatchesDir, { recursive: true })
          const screenshotPath = join(mismatchesDir, `${slugify(entry.label)}.png`)
          await page.screenshot({ path: screenshotPath }).catch(() => undefined)
          result.screenshotPath = screenshotPath
        }
        results.push(result)
      }
    } finally {
      await page.close()
      await context.close()
    }
  } finally {
    await browser.close()
  }
  const reportPath = await writeVerifyReport(options.outputDir, results, options.findings)
  return {
    outputDir: options.outputDir,
    reportPath,
    totalEntries: results.length,
    matches: results.filter(r => r.status === 'match').length,
    mismatches: results.filter(r => r.status === 'mismatch').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    errors: results.filter(r => r.status === 'error').length,
  }
}
