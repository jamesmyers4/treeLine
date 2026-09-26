import { capturePageWithBrowser, AuthExpiredError, AuthWallError } from '@treeline/acquire'
import type { AcquireOptions, AuthSession, PageState } from '@treeline/acquire'
import type { CrawlConfig, CrawlResult, HardPageReasonCode } from './types.js'
import { normalizeUrl, isSameOrigin, isUrlDenied, detectSuspiciousActionVerb } from './url-utils.js'
import { fetchRobotsRules } from './robots.js'
import { fetchSitemapUrls } from './sitemap.js'
import { fetchSeedPage, findCanonicalHref, detectHostnameMismatches } from './origin-scope.js'
import { openCrawlDb } from './persistence.js'
import { clearHardPageEntry, writeHardPageEntry } from './hard-pages.js'
import { createSharedBrowser } from './shared-browser.js'
import type { SharedBrowser } from './shared-browser.js'

const MAX_CAPTURE_SNAPSHOT_LENGTH = 500
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

function truncateCaptureSnapshot(message: string): string {
  const plain = message.replace(ANSI_ESCAPE, '')
  return plain.length > MAX_CAPTURE_SNAPSHOT_LENGTH ? plain.slice(0, MAX_CAPTURE_SNAPSHOT_LENGTH) : plain
}

export async function crawl(
  config: CrawlConfig,
  dbPath: string,
  hardPagesDir: string,
  authSession?: AuthSession,
): Promise<CrawlResult> {
  const db = openCrawlDb(dbPath)
  try {
    const sharedBrowser = createSharedBrowser({ stealth: config.stealth, headless: config.headless })
    try {
      return await runCrawl(config, hardPagesDir, authSession, db, sharedBrowser)
    } finally {
      await sharedBrowser.close()
    }
  } finally {
    db.close()
  }
}

async function capturePageWithRecovery(url: string, sharedBrowser: SharedBrowser, options: AcquireOptions): Promise<PageState> {
  const browser = await sharedBrowser.get()
  try {
    return await capturePageWithBrowser(url, browser, options)
  } catch (err) {
    if (browser.isConnected()) throw err
    console.warn(`[treeline] Browser disconnected while capturing ${url} — relaunching and retrying once.`)
    return await capturePageWithBrowser(url, await sharedBrowser.get(), options)
  }
}

async function runCrawl(
  config: CrawlConfig,
  hardPagesDir: string,
  authSession: AuthSession | undefined,
  db: ReturnType<typeof openCrawlDb>,
  sharedBrowser: SharedBrowser,
): Promise<CrawlResult> {
  db.insertMeta(config.seedUrl, config)
  const { resolvedUrl, html } = await fetchSeedPage(config.seedUrl, authSession, {
    insecureCerts: config.insecureCerts,
    headless: config.headless,
    stealth: config.stealth,
    getBrowser: () => sharedBrowser.get(),
  })
  const seedNorm = normalizeUrl(resolvedUrl)
  const seedOrigin = new URL(seedNorm).origin
  const isAllowed = config.respectRobotsTxt ? await fetchRobotsRules(seedOrigin) : () => true
  const sitemapUrls = await fetchSitemapUrls(seedOrigin)
  const canonicalHref = html ? findCanonicalHref(html) : null
  let canonicalUrl: string | null = null
  if (canonicalHref) {
    try {
      canonicalUrl = new URL(canonicalHref, seedNorm).toString()
    } catch {
      canonicalUrl = null
    }
  }
  const hostnameMismatches = detectHostnameMismatches(seedNorm, sitemapUrls, canonicalUrl)
  for (const mismatch of hostnameMismatches) {
    console.warn(
      `[treeline] Possible hostname mismatch: seed resolved to ${new URL(seedNorm).hostname}, but ${mismatch.source} references ${mismatch.hostname} (${mismatch.url}). This crawl will not automatically follow it.`,
    )
  }
  const frontier: Array<{ url: string; depth: number }> = [{ url: seedNorm, depth: 0 }]
  const deniedUrls = new Set<string>()
  const suspiciousActionUrls = new Map<string, string>()
  const flagSuspiciousActionUrl = (url: string): void => {
    if (suspiciousActionUrls.has(url)) return
    const verb = detectSuspiciousActionVerb(url)
    if (!verb) return
    suspiciousActionUrls.set(url, verb)
    console.warn(
      `[treeline] URL query string looks like it may trigger a state-changing action (matched "${verb}"): ${url}. This is a heuristic warning only — the crawl is still following it normally. Use --deny-url-pattern to actually block it if that's not desired.`,
    )
  }
  for (const sUrl of sitemapUrls) {
    try {
      const norm = normalizeUrl(sUrl)
      if (!isSameOrigin(seedNorm, norm)) continue
      if (isUrlDenied(norm, config.denyUrlPatterns)) {
        deniedUrls.add(norm)
        continue
      }
      flagSuspiciousActionUrl(norm)
      frontier.push({ url: norm, depth: 0 })
    } catch {
      // skip invalid
    }
  }
  const visited = new Set<string>()
  const offOriginRedirects = new Map<string, string>()
  const enqueueLinks = (links: string[], depth: number): void => {
    if (depth >= config.maxDepth) return
    for (const link of links) {
      try {
        const normLink = normalizeUrl(link)
        if (visited.has(normLink) || !isSameOrigin(seedNorm, normLink)) continue
        if (isUrlDenied(normLink, config.denyUrlPatterns)) {
          deniedUrls.add(normLink)
          continue
        }
        flagSuspiciousActionUrl(normLink)
        frontier.push({ url: normLink, depth: depth + 1 })
      } catch {
        // skip invalid
      }
    }
  }
  const sampledEndpoints = new Set<string>()
  let pageCount = 0
  let lastRequestAt = 0
  const throttleMs = config.throttleMs ?? 0
  let abortedAt: CrawlResult['abortedAt']
  while (frontier.length > 0 && pageCount < config.maxPages) {
    const { url, depth } = frontier.shift()!
    if (visited.has(url)) continue
    if (db.pageExists(url)) {
      visited.add(url)
      enqueueLinks(db.getStoredLinks(url), depth)
      continue
    }
    if (config.sameOriginOnly && !isSameOrigin(seedNorm, url)) continue
    if (isUrlDenied(url, config.denyUrlPatterns)) {
      deniedUrls.add(url)
      continue
    }
    if (!isAllowed(new URL(url).pathname)) continue
    visited.add(url)
    if (throttleMs > 0) {
      const elapsed = Date.now() - lastRequestAt
      if (elapsed < throttleMs) {
        await new Promise<void>((r) => setTimeout(r, throttleMs - elapsed))
      }
    }
    lastRequestAt = Date.now()
    try {
      const pageState = await capturePageWithRecovery(url, sharedBrowser, {
        stealth: config.stealth,
        headless: config.headless,
        captureResponseBodies: config.captureResponseBodies,
        maxResponseBodyBytes: config.maxResponseBodyBytes,
        captureRequestBodies: config.captureRequestBodies,
        maxRequestBodyBytes: config.maxRequestBodyBytes,
        sampledEndpoints,
        authSession,
        detectAuthWall: config.detectAuthWall,
        insecureCerts: config.insecureCerts,
      })
      const finalNorm = normalizeUrl(pageState.finalUrl)
      if (finalNorm !== url) {
        if (config.sameOriginOnly && !isSameOrigin(seedNorm, finalNorm)) {
          offOriginRedirects.set(url, pageState.finalUrl)
          console.warn(
            `[treeline] ${url} redirected off-origin to ${pageState.finalUrl} — not recording it as a page of this site.`,
          )
          continue
        }
        if (isUrlDenied(finalNorm, config.denyUrlPatterns)) {
          deniedUrls.add(finalNorm)
          continue
        }
        if (visited.has(finalNorm) || db.pageExists(finalNorm)) {
          visited.add(finalNorm)
          clearHardPageEntry(hardPagesDir, url)
          continue
        }
        visited.add(finalNorm)
      }
      db.recordPageState({ ...pageState, url: finalNorm })
      clearHardPageEntry(hardPagesDir, url)
      clearHardPageEntry(hardPagesDir, finalNorm)
      pageCount++
      enqueueLinks(pageState.links, depth)
    } catch (err) {
      if (err instanceof AuthExpiredError) {
        writeHardPageEntry(hardPagesDir, {
          url,
          reasonCode: 'auth-expired',
          attemptedAt: new Date().toISOString(),
          captureSnapshot: truncateCaptureSnapshot(err.message),
        })
        abortedAt = { url, reason: 'auth-expired' }
        break
      }
      if (err instanceof AuthWallError) {
        writeHardPageEntry(hardPagesDir, {
          url,
          reasonCode: 'auth-wall',
          attemptedAt: new Date().toISOString(),
          captureSnapshot: truncateCaptureSnapshot(err.message),
        })
        continue
      }
      const reasonCode: HardPageReasonCode =
        err instanceof Error && err.message.toLowerCase().includes('timeout')
          ? 'timeout'
          : 'parse-error'
      db.markFailed(url, reasonCode)
      writeHardPageEntry(hardPagesDir, {
        url,
        reasonCode,
        attemptedAt: new Date().toISOString(),
        captureSnapshot: truncateCaptureSnapshot(err instanceof Error ? err.message : String(err)),
      })
    }
  }
  return {
    hostnameMismatches,
    abortedAt,
    deniedUrlCount: deniedUrls.size,
    offOriginRedirects: Array.from(offOriginRedirects, ([url, finalUrl]) => ({ url, finalUrl })),
    suspiciousActionUrls: Array.from(suspiciousActionUrls, ([url, matchedVerb]) => ({ url, matchedVerb })),
  }
}
