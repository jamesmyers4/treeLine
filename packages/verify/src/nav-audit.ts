import type { Locator, Page } from 'playwright'
import { normalizeForComparison, checkAuthStillValid, AuthExpiredError } from '@treeline/acquire'
import type { NavMapEntry, NavMapAuditResult } from './types.js'

function escapeForTextIs(segment: string): string {
  return segment.replace(/"/g, '\\"')
}

// Origin + path only, no query string — deliberately more lenient than normalizeForComparison
// (which this file also uses for the real match/mismatch determination, unchanged). A real
// target can legitimately append a per-session security token to an otherwise-correct
// destination (session 61: OpenEMR's Admin > System > Language lands on
// "language.php?m=definition&csrf_token_form=<live-token>" — a real, correct navigation, not a
// wrong destination) — normalizeForComparison's exact-query-string match still (correctly)
// reports that as a mismatch, since it genuinely isn't byte-identical to a static expectedUrl a
// human wrote down once. This helper doesn't change that verdict; it only lets the report add a
// clarifying note so a human doesn't have to manually diff the two URLs to see the difference is
// just a token, not a wrong page.
function pathOnlyMatches(a: string, b: string): boolean {
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    return ua.origin === ub.origin && ua.pathname.replace(/\/$/, '') === ub.pathname.replace(/\/$/, '')
  } catch {
    return false
  }
}

const FRAME_SETTLE_MAX_WAIT_MS = 5000
const FRAME_SETTLE_QUIET_MS = 1500
const FRAME_SETTLE_POLL_INTERVAL_MS = 150

// networkidle alone is not sufficient here — a real click on a knockout.js-driven OpenEMR nav
// item can trigger the actual iframe-src navigation asynchronously (plausibly behind a
// session/permission check before the swap), well after networkidle already resolves. A single
// fixed sleep is one option, but this repo's own convention is to wait for a real, observable
// condition to settle rather than an arbitrary duration — so this polls the live frame URL list
// until it stops changing (quiet for FRAME_SETTLE_QUIET_MS) or FRAME_SETTLE_MAX_WAIT_MS elapses,
// whichever comes first. Confirmed live against a real OpenEMR target (session 61): without
// this, "Admin > Config" and every "Admin > System > *" entry that followed it in the same run
// failed — the exact, previously-undiagnosed CONTEXT.md finding — because the real navigation
// hadn't happened yet by the time the next click's element lookup ran. With this, all five
// entries pass and land on their real expected destinations.
// FRAME_SETTLE_QUIET_MS is deliberately generous (3x the observed real-world delay on OpenEMR,
// which resolved within ~500ms of quiet time in live testing): a quiet-debounce is a heuristic,
// not a guarantee — it can only ever infer "probably done," never prove "nothing more is
// pending." A real regression test (verify.test.ts, a fixture with a deliberate ~800ms
// click-to-navigate delay) caught an earlier version of this constant (500ms) exiting early and
// missing the eventual navigation entirely — don't shrink this without re-running that test
// first, and don't assume a shorter value is safe just because it happens to pass once.
async function waitForFrameSettle(page: Page): Promise<void> {
  const start = Date.now()
  let lastSignature = JSON.stringify(page.frames().map(f => f.url()))
  let lastChangeAt = Date.now()
  while (Date.now() - start < FRAME_SETTLE_MAX_WAIT_MS) {
    await page.waitForTimeout(FRAME_SETTLE_POLL_INTERVAL_MS)
    const signature = JSON.stringify(page.frames().map(f => f.url()))
    if (signature !== lastSignature) {
      lastSignature = signature
      lastChangeAt = Date.now()
      continue
    }
    if (Date.now() - lastChangeAt >= FRAME_SETTLE_QUIET_MS) return
  }
}

async function findClickTarget(page: Page, segment: string): Promise<Locator | null> {
  for (const frame of page.frames()) {
    const link = frame.getByRole('link', { name: segment })
    if (await link.count() > 0) return link.first()
    const button = frame.getByRole('button', { name: segment })
    if (await button.count() > 0) return button.first()
  }
  for (const frame of page.frames()) {
    const visibleText = frame.locator(`:text-is("${escapeForTextIs(segment)}"):visible`)
    if (await visibleText.count() > 0) return visibleText.first()
  }
  return null
}

const CLICK_TARGET_RETRY_MAX_WAIT_MS = 3000
const CLICK_TARGET_RETRY_INTERVAL_MS = 200

// A click target can be transiently absent right after a prior clickPath segment's navigation
// has just settled — session 61, live OpenEMR: "Fees > EDI History" and "Patient > New/Search"
// intermittently came back "not found" immediately after "Fees > Posting Payments"'s own real
// two-hop redirect completed, on some runs but not others, despite each working when retried —
// plausibly residual dropdown/backdrop DOM state from the just-finished prior action, not yet
// cleared by the time this lookup ran. A single immediate check can race this; poll for up to
// CLICK_TARGET_RETRY_MAX_WAIT_MS rather than failing on the very next tick. Zero added cost in
// the common case where the element is already there on the first check.
async function clickSegment(page: Page, segment: string): Promise<void> {
  const start = Date.now()
  for (;;) {
    const target = await findClickTarget(page, segment)
    if (target) {
      await target.click()
      return
    }
    if (Date.now() - start >= CLICK_TARGET_RETRY_MAX_WAIT_MS) {
      throw new Error(`No clickable element with accessible name or visible text "${segment}" found in any frame`)
    }
    await page.waitForTimeout(CLICK_TARGET_RETRY_INTERVAL_MS)
  }
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
      await waitForFrameSettle(page)
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
  if (matches) {
    return { label: entry.label, expectedUrl: entry.expectedUrl, observedUrl, status: 'match' }
  }
  const queryOnlyDifference = pathOnlyMatches(observedUrl, entry.expectedUrl)
  return { label: entry.label, expectedUrl: entry.expectedUrl, observedUrl, status: 'mismatch', queryOnlyDifference }
}
