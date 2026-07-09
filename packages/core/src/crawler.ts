import { capturePage } from '@treeline/acquire'
import type { CrawlConfig, CrawlResult, HardPageReasonCode } from './types.js'
import { normalizeUrl, isSameOrigin } from './url-utils.js'
import { fetchRobotsRules } from './robots.js'
import { fetchSitemapUrls } from './sitemap.js'
import { fetchSeedPage, findCanonicalHref, detectHostnameMismatches } from './origin-scope.js'
import { openCrawlDb } from './persistence.js'
import { writeHardPageEntry } from './hard-pages.js'

export async function crawl(
  config: CrawlConfig,
  dbPath: string,
  hardPagesDir: string,
): Promise<CrawlResult> {
  const db = openCrawlDb(dbPath)
  db.insertMeta(config.seedUrl, config)
  const { resolvedUrl, html } = await fetchSeedPage(config.seedUrl)
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
  let pageCount = 0
  let lastRequestAt = 0
  const throttleMs = config.throttleMs ?? 0
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
      const pageState = await capturePage(url, { stealth: config.stealth })
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
  db.close()
  return { hostnameMismatches }
}
