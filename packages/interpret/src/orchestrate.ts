import { openCrawlDb, writeHardPageEntry } from '@treeline/core'
import type { StoredInterpretation } from '@treeline/core'
import type { PageState } from '@treeline/acquire'
import { interpretPage } from './interpret.js'

export async function runInterpretation(dbPath: string, hardPagesDir: string): Promise<void> {
  const db = openCrawlDb(dbPath)
  const pages = db.getAllPages()
  const capturedPages = pages.filter((p) => p.title !== null && p.ariaSnapshot !== null && p.capturedAt !== null)
  for (const page of capturedPages) {
    if (db.getInterpretation(page.url)) continue
    const pageState: PageState = {
      ...page,
      title: page.title!,
      ariaSnapshot: page.ariaSnapshot!,
      capturedAt: page.capturedAt!,
    }
    try {
      const result = await interpretPage(pageState)
      const stored: StoredInterpretation = {
        ...result,
        interpretedAt: new Date().toISOString(),
      }
      db.recordInterpretation(stored)
    } catch {
      writeHardPageEntry(hardPagesDir, {
        url: page.url,
        reasonCode: 'parse-error',
        attemptedAt: new Date().toISOString(),
        captureSnapshot: null,
      })
    }
  }
  db.close()
}
