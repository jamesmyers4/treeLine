import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { openCrawlDb } from './persistence.js'
import { normalizeUrl } from './url-utils.js'

export interface VisualChange {
  url: string
  method: 'pixel-diff'
  status: 'changed' | 'unchanged' | 'dimensions-changed' | 'baseline-missing' | 'current-missing'
  diffPixelCount: number | null
  diffPixelPercent: number | null
}

export interface PageScreenshotRecord {
  screenshotPath: string | null
}

// Two independent real crawls of an unchanged page (example.com, and the more
// visually complex httpbin.org/forms/post) both showed a 0% noise floor after
// pixelmatch's own anti-aliasing filtering. 0.1% keeps a margin above that
// observed floor while staying far below any genuine visual change.
const CHANGED_THRESHOLD_PERCENT = 0.1

function resolveScreenshotPath(dbPath: string, screenshotPath: string | null): string | null {
  if (!screenshotPath) return null
  const resolved = join(dirname(dbPath), screenshotPath)
  return existsSync(resolved) ? resolved : null
}

function compareScreenshots(
  url: string,
  baselineDbPath: string,
  currentDbPath: string,
  baselineScreenshotPath: string | null,
  currentScreenshotPath: string | null,
): VisualChange {
  const baselineFile = resolveScreenshotPath(baselineDbPath, baselineScreenshotPath)
  const currentFile = resolveScreenshotPath(currentDbPath, currentScreenshotPath)

  if (!baselineFile) {
    return { url, method: 'pixel-diff', status: 'baseline-missing', diffPixelCount: null, diffPixelPercent: null }
  }
  if (!currentFile) {
    return { url, method: 'pixel-diff', status: 'current-missing', diffPixelCount: null, diffPixelPercent: null }
  }

  const baselineImg = PNG.sync.read(readFileSync(baselineFile))
  const currentImg = PNG.sync.read(readFileSync(currentFile))

  if (baselineImg.width !== currentImg.width || baselineImg.height !== currentImg.height) {
    return { url, method: 'pixel-diff', status: 'dimensions-changed', diffPixelCount: null, diffPixelPercent: null }
  }

  const { width, height } = baselineImg
  const diffPixelCount = pixelmatch(baselineImg.data, currentImg.data, null, width, height, { threshold: 0.1 })
  const diffPixelPercent = (diffPixelCount / (width * height)) * 100

  return {
    url,
    method: 'pixel-diff',
    status: diffPixelPercent > CHANGED_THRESHOLD_PERCENT ? 'changed' : 'unchanged',
    diffPixelCount,
    diffPixelPercent,
  }
}

export function diffVisualChangesFromPages(
  baselineByUrl: Map<string, PageScreenshotRecord>,
  currentByUrl: Map<string, PageScreenshotRecord>,
  baselineDbPath: string,
  currentDbPath: string,
): VisualChange[] {
  const changes: VisualChange[] = []
  for (const [url, currentPage] of currentByUrl) {
    const baselinePage = baselineByUrl.get(url)
    if (!baselinePage) continue
    changes.push(compareScreenshots(url, baselineDbPath, currentDbPath, baselinePage.screenshotPath, currentPage.screenshotPath))
  }
  return changes
}

export function diffScreenshots(baselineDbPath: string, currentDbPath: string): VisualChange[] {
  const baselineDb = openCrawlDb(baselineDbPath)
  const baselinePages = baselineDb.getAllPages()
  baselineDb.close()

  const currentDb = openCrawlDb(currentDbPath)
  const currentPages = currentDb.getAllPages()
  currentDb.close()

  const baselineByUrl = new Map(baselinePages.map((page) => [normalizeUrl(page.url), page]))
  const currentByUrl = new Map(currentPages.map((page) => [normalizeUrl(page.url), page]))

  return diffVisualChangesFromPages(baselineByUrl, currentByUrl, baselineDbPath, currentDbPath)
}
