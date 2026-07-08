import Database from 'better-sqlite3'
import type { AxeViolation, DomInteractiveElement, NetworkEntry, PageState } from '@treeline/acquire'
import type { CrawlConfig, HardPageReasonCode, StoredInterpretation } from './types.js'

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
      status TEXT,
      interactiveElements TEXT,
      axeViolations TEXT
    );
    CREATE TABLE IF NOT EXISTS interpretations (
      url TEXT PRIMARY KEY,
      tierUsed TEXT,
      pageType TEXT,
      purpose TEXT,
      keyDataEntities TEXT,
      confidence REAL,
      interpretedAt TEXT
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
        INSERT OR REPLACE INTO pages (url, title, ariaSnapshot, links, networkLog, screenshot, capturedAt, status, interactiveElements, axeViolations)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        pageState.url,
        pageState.title,
        pageState.ariaSnapshot,
        JSON.stringify(pageState.links),
        JSON.stringify(pageState.networkLog),
        pageState.screenshot,
        pageState.capturedAt,
        'ok',
        JSON.stringify(pageState.interactiveElements),
        JSON.stringify(pageState.axeViolations),
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
    getAllPages(): Array<{
      url: string
      title: string | null
      ariaSnapshot: string | null
      links: string[]
      networkLog: NetworkEntry[]
      screenshot: string | null
      capturedAt: string | null
      interactiveElements: DomInteractiveElement[]
      axeViolations: AxeViolation[]
      status: string
    }> {
      const rows = db.prepare('SELECT * FROM pages').all() as Array<Record<string, string | null>>
      return rows.map((row) => ({
        url: row.url ?? '',
        title: row.title ?? null,
        ariaSnapshot: row.ariaSnapshot ?? null,
        links: row.links ? (JSON.parse(row.links) as string[]) : [],
        networkLog: row.networkLog ? (JSON.parse(row.networkLog) as NetworkEntry[]) : [],
        screenshot: row.screenshot ?? null,
        capturedAt: row.capturedAt ?? null,
        interactiveElements: row.interactiveElements
          ? (JSON.parse(row.interactiveElements) as DomInteractiveElement[])
          : [],
        axeViolations: row.axeViolations ? (JSON.parse(row.axeViolations) as AxeViolation[]) : [],
        status: row.status ?? '',
      }))
    },
    recordInterpretation(interp: StoredInterpretation): void {
      db.prepare(`
        INSERT OR REPLACE INTO interpretations (url, tierUsed, pageType, purpose, keyDataEntities, confidence, interpretedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        interp.url,
        interp.tierUsed,
        interp.pageType,
        interp.purpose,
        JSON.stringify(interp.keyDataEntities),
        interp.confidence,
        interp.interpretedAt,
      )
    },
    getInterpretation(url: string): StoredInterpretation | null {
      const row = db.prepare('SELECT * FROM interpretations WHERE url = ?').get(url) as
        | Record<string, string | number | null>
        | undefined
      if (!row) return null
      return {
        url: row.url as string,
        tierUsed: row.tierUsed as string,
        pageType: row.pageType as string,
        purpose: row.purpose as string,
        keyDataEntities: row.keyDataEntities ? (JSON.parse(row.keyDataEntities as string) as string[]) : [],
        confidence: row.confidence as number,
        interpretedAt: row.interpretedAt as string,
      }
    },
    getAllInterpretations(): StoredInterpretation[] {
      const rows = db.prepare('SELECT * FROM interpretations').all() as Array<Record<string, string | number | null>>
      return rows.map((row) => ({
        url: row.url as string,
        tierUsed: row.tierUsed as string,
        pageType: row.pageType as string,
        purpose: row.purpose as string,
        keyDataEntities: row.keyDataEntities ? (JSON.parse(row.keyDataEntities as string) as string[]) : [],
        confidence: row.confidence as number,
        interpretedAt: row.interpretedAt as string,
      }))
    },
    close(): void {
      db.close()
    },
  }
}
