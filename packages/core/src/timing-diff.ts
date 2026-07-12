import { openCrawlDb } from './persistence.js'
import { normalizeUrl } from './url-utils.js'

export interface TimingChange {
  url: string
  baselinePageLoadMs: number
  currentPageLoadMs: number
  percentChange: number
}

export interface PageTimingRecord {
  url: string
  pageLoadMs: number | null
}

// Real repeated back-to-back crawls with identical config, same technique
// used to derive the visual-diff and timing-report thresholds. A pure local
// fixture (no external DNS/TLS, isolating app-level noise) held run-to-run
// swings within +/-6.4% across 5 runs. A real external multi-page site
// (playwright.dev, 6 pages) held within +/-17%. A real external single-page
// site (example.com, 5 runs) held within +/-15% for 4 of 5 runs, but one run
// spiked to +126% from what looks like a cold DNS/TLS handshake after
// connection reuse expired. 50% sits with real margin above the ~17%
// ceiling observed across both local and normal external-network profiles.
// The single +126% cold-connection outlier is a known, real false-positive
// source this threshold does not fully eliminate — an inherent limitation
// of relative page-load-time diffing against external network-bound sites,
// not something a static threshold alone can solve. Revisit if this proves
// noisy in practice.
const TIMING_NOISE_THRESHOLD_PERCENT = 50

export function diffPageLoadTimingFromPages(
  baselineByUrl: Map<string, PageTimingRecord>,
  currentByUrl: Map<string, PageTimingRecord>,
): TimingChange[] {
  const changes: TimingChange[] = []
  for (const [url, currentPage] of currentByUrl) {
    const baselinePage = baselineByUrl.get(url)
    if (!baselinePage) continue
    if (baselinePage.pageLoadMs === null || currentPage.pageLoadMs === null) continue

    const baselinePageLoadMs = baselinePage.pageLoadMs
    const currentPageLoadMs = currentPage.pageLoadMs
    const percentChange = ((currentPageLoadMs - baselinePageLoadMs) / baselinePageLoadMs) * 100
    if (Math.abs(percentChange) <= TIMING_NOISE_THRESHOLD_PERCENT) continue

    changes.push({ url, baselinePageLoadMs, currentPageLoadMs, percentChange })
  }
  return changes
}

export function diffPageLoadTiming(baselineDbPath: string, currentDbPath: string): TimingChange[] {
  const baselineDb = openCrawlDb(baselineDbPath)
  const baselinePages = baselineDb.getAllPages()
  baselineDb.close()

  const currentDb = openCrawlDb(currentDbPath)
  const currentPages = currentDb.getAllPages()
  currentDb.close()

  const baselineByUrl = new Map(baselinePages.map((page) => [normalizeUrl(page.url), page]))
  const currentByUrl = new Map(currentPages.map((page) => [normalizeUrl(page.url), page]))

  return diffPageLoadTimingFromPages(baselineByUrl, currentByUrl)
}
