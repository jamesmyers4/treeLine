import Database from 'better-sqlite3'
import type { PageState } from '@treeline/acquire'
import type { CrawlConfig, HardPageReasonCode } from './types.js'

export function openCrawlDb(dbPath: string) {
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS crawl_meta (
      seedUrl TEXT,
      startedAt TEXT,
      config TEXT
    );
    CREATE TABLE IF NOT EXISTS pages (
      url TEXT PRIMARY KEY,
      title TEXT,
      ariaSnapshot TEXT,
      links TEXT,
      networkLog TEXT,
      screenshot TEXT,
      capturedAt TEXT,
      status TEXT
    );
  `)
  return {
    insertMeta(seedUrl: string, config: CrawlConfig): void {
      db.prepare('INSERT INTO crawl_meta (seedUrl, startedAt, config) VALUES (?, ?, ?)').run(
        seedUrl,
        new Date().toISOString(),
        JSON.stringify(config),
      )
    },
    recordPageState(pageState: PageState): void {
      db.prepare(`
        INSERT OR REPLACE INTO pages (url, title, ariaSnapshot, links, networkLog, screenshot, capturedAt, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        pageState.url,
        pageState.title,
        pageState.ariaSnapshot,
        JSON.stringify(pageState.links),
        JSON.stringify(pageState.networkLog),
        pageState.screenshot,
        pageState.capturedAt,
        'ok',
      )
    },
    pageExists(url: string): boolean {
      return db.prepare('SELECT 1 FROM pages WHERE url = ?').get(url) !== undefined
    },
    markFailed(url: string, reasonCode: HardPageReasonCode): void {
      db.prepare(
        'INSERT OR REPLACE INTO pages (url, status, capturedAt) VALUES (?, ?, ?)',
      ).run(url, reasonCode, new Date().toISOString())
    },
    getAllPages(): unknown[] {
      return db.prepare('SELECT * FROM pages').all()
    },
    close(): void {
      db.close()
    },
  }
}
