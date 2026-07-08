import { openCrawlDb } from './persistence.js'
import { normalizeUrl } from './url-utils.js'

export interface TitleChange {
  url: string
  baselineTitle: string
  currentTitle: string
}

export interface CrawlDiff {
  baselineDbPath: string
  currentDbPath: string
  pagesAdded: string[]
  pagesRemoved: string[]
  titleChanges: TitleChange[]
}

export function diffCrawls(baselineDbPath: string, currentDbPath: string): CrawlDiff {
  const baselineDb = openCrawlDb(baselineDbPath)
  const baselinePages = baselineDb.getAllPages()
  baselineDb.close()

  const currentDb = openCrawlDb(currentDbPath)
  const currentPages = currentDb.getAllPages()
  currentDb.close()

  const baselineByUrl = new Map<string, string | null>()
  for (const page of baselinePages) {
    baselineByUrl.set(normalizeUrl(page.url), page.title)
  }

  const currentByUrl = new Map<string, string | null>()
  for (const page of currentPages) {
    currentByUrl.set(normalizeUrl(page.url), page.title)
  }

  const pagesAdded: string[] = []
  const pagesRemoved: string[] = []
  const titleChanges: TitleChange[] = []

  for (const [url, currentTitle] of currentByUrl) {
    if (!baselineByUrl.has(url)) {
      pagesAdded.push(url)
      continue
    }
    const baselineTitle = baselineByUrl.get(url) ?? null
    if (baselineTitle !== currentTitle) {
      titleChanges.push({
        url,
        baselineTitle: baselineTitle ?? '',
        currentTitle: currentTitle ?? '',
      })
    }
  }

  for (const url of baselineByUrl.keys()) {
    if (!currentByUrl.has(url)) {
      pagesRemoved.push(url)
    }
  }

  return {
    baselineDbPath,
    currentDbPath,
    pagesAdded,
    pagesRemoved,
    titleChanges,
  }
}
