import { existsSync } from 'node:fs'
import path from 'node:path'
import { openCrawlDb } from '@treeline/core'
import type { RunMeta, RunMode } from './types.js'

export function buildRunMeta(outputDir: string, mode: RunMode): RunMeta {
  const dbPath = path.join(outputDir, 'crawl.sqlite')
  let targetUrl: string | null = null
  let pageCount: number | null = null
  if (existsSync(dbPath)) {
    const db = openCrawlDb(dbPath)
    try {
      targetUrl = db.getMeta()?.seedUrl ?? null
      pageCount = db.getAllPages().length
    } finally {
      db.close()
    }
  }
  return { targetUrl, mode, renderedAt: new Date().toISOString(), pageCount }
}
