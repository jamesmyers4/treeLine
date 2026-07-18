import type { Page } from 'playwright'
import { normalizeForComparison, checkAuthStillValid, AuthExpiredError } from '@treeline/acquire'
import type { NavMapEntry, NavMapAuditResult } from './types.js'

function escapeForTextIs(segment: string): string {
  return segment.replace(/"/g, '\\"')
}

async function clickSegment(page: Page, segment: string): Promise<void> {
  for (const frame of page.frames()) {
    const link = frame.getByRole('link', { name: segment })
    if (await link.count() > 0) {
      await link.first().click()
      return
    }
    const button = frame.getByRole('button', { name: segment })
    if (await button.count() > 0) {
      await button.first().click()
      return
    }
  }
  for (const frame of page.frames()) {
    const visibleText = frame.locator(`:text-is("${escapeForTextIs(segment)}"):visible`)
    if (await visibleText.count() > 0) {
      await visibleText.first().click()
      return
    }
  }
  throw new Error(`No clickable element with accessible name or visible text "${segment}" found in any frame`)
}

export async function auditNavMapEntry(page: Page, entry: NavMapEntry, loginUrl: string, successIndicator: string): Promise<NavMapAuditResult> {
  if (entry.precondition) {
    return { label: entry.label, expectedUrl: entry.expectedUrl, observedUrl: null, status: 'skipped', precondition: entry.precondition }
  }
  const baselineFrameUrls = new Set(page.frames().map(f => f.url()))
  const baselineTopUrl = page.url()
  try {
    for (const segment of entry.clickPath) {
      await clickSegment(page, segment)
      await page.waitForLoadState('networkidle').catch(() => undefined)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { label: entry.label, expectedUrl: entry.expectedUrl, observedUrl: null, status: 'error', errorMessage: message }
  }
  const stillValid = await checkAuthStillValid(page, successIndicator, loginUrl)
  if (!stillValid) {
    throw new AuthExpiredError(page.url())
  }
  const newFrameUrls = page.frames().map(f => f.url()).filter(u => u !== 'about:blank' && !baselineFrameUrls.has(u))
  const observedUrl = newFrameUrls.length > 0 ? newFrameUrls[newFrameUrls.length - 1]! : page.url()
  const matches = normalizeForComparison(observedUrl) === normalizeForComparison(entry.expectedUrl)
  if (!matches && observedUrl === baselineTopUrl && newFrameUrls.length === 0) {
    return { label: entry.label, expectedUrl: entry.expectedUrl, observedUrl, status: 'error', errorMessage: 'No navigation observed after completing clickPath' }
  }
  return { label: entry.label, expectedUrl: entry.expectedUrl, observedUrl, status: matches ? 'match' : 'mismatch' }
}
