import { capturePage, AuthExpiredError, AuthWallError } from '@treeline/acquire'
import type { AuthSession } from '@treeline/acquire'
import type { CrawlConfig, CrawlResult, HardPageReasonCode } from './types.js'
import { normalizeUrl, isSameOrigin } from './url-utils.js'
import { fetchRobotsRules } from './robots.js'
import { fetchSitemapUrls } from './sitemap.js'
import { fetchSeedPage, findCanonicalHref, detectHostnameMismatches } from './origin-scope.js'
import { openCrawlDb } from './persistence.js'
import { writeHardPageEntry } from './hard-pages.js'

const MAX_CAPTURE_SNAPSHOT_LENGTH = 500

function truncateCaptureSnapshot(message: string): string {
  return message.length > MAX_CAPTURE_SNAPSHOT_LENGTH ? message.slice(0, MAX_CAPTURE_SNAPSHOT_LENGTH) : message
}

export async function crawl(
  config: CrawlConfig,
  dbPath: string,
  hardPagesDir: string,
  authSession?: AuthSession,
): Promise<CrawlResult> {
  const db = openCrawlDb(dbPath)
  try {
    return await runCrawl(config, hardPagesDir, authSession, db)
  } finally {
    db.close()
  }
}

async function runCrawl(
  config: CrawlConfig,
  hardPagesDir: string,
  authSession: AuthSession | undefined,
  db: ReturnType<typeof openCrawlDb>,
): Promise<CrawlResult> {
  db.insertMeta(config.seedUrl, config)
  const { resolvedUrl, html } = await fetchSeedPage(config.seedUrl, authSession, config.insecureCerts)
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
  for (const sUrl of sitemapUrls) {
    try {
      const norm = normalizeUrl(sUrl)
      if (isSameOrigin(seedNorm, norm)) frontier.push({ url: norm, depth: 0 })
    } catch {
      // skip invalid
    }
  }
  const visited = new Set<string>()
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
      continue
    }
    if (config.sameOriginOnly && !isSameOrigin(seedNorm, url)) continue
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
      const pageState = await capturePage(url, {
        stealth: config.stealth,
        captureResponseBodies: config.captureResponseBodies,
        maxResponseBodyBytes: config.maxResponseBodyBytes,
        captureRequestBodies: config.captureRequestBodies,
        maxRequestBodyBytes: config.maxRequestBodyBytes,
        sampledEndpoints,
        authSession,
        detectAuthWall: config.detectAuthWall,
        insecureCerts: config.insecureCerts,
      })
      db.recordPageState(pageState)
      pageCount++
      if (depth < config.maxDepth) {
        for (const link of pageState.links) {
          try {
            const normLink = normalizeUrl(link)
            if (!visited.has(normLink) && isSameOrigin(seedNorm, normLink)) {
              frontier.push({ url: normLink, depth: depth + 1 })
            }
          } catch {
            // skip invalid
          }
        }
      }
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
        captureSnapshot: null,
      })
    }
  }
  return { hostnameMismatches, abortedAt }
}
