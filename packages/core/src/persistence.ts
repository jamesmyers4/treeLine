import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import type { AxeIncompleteResult, AxeViolation, CapturedForm, DomInteractiveElement, NetworkEntry, PageState } from '@treeline/acquire'
import type { CrawlConfig, HardPageReasonCode, StoredInterpretation } from './types.js'
import { urlHash } from './url-utils.js'

function screenshotFileName(url: string): string {
  return `${urlHash(url)}.png`
}

export function openCrawlDb(dbPath: string) {
  const db = new Database(dbPath)
  const outputDir = dirname(dbPath)
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
      screenshotPath TEXT,
      capturedAt TEXT,
      pageLoadMs INTEGER,
      status TEXT,
      interactiveElements TEXT,
      axeViolations TEXT,
      axeIncomplete TEXT,
      forms TEXT
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
      let screenshotPath: string | null = null
      if (pageState.screenshot) {
        const fileName = screenshotFileName(pageState.url)
        const screenshotsDir = join(outputDir, 'screenshots')
        mkdirSync(screenshotsDir, { recursive: true })
        writeFileSync(join(screenshotsDir, fileName), pageState.screenshot)
        screenshotPath = join('screenshots', fileName)
      }
      db.prepare(`
        INSERT OR REPLACE INTO pages (url, title, ariaSnapshot, links, networkLog, screenshotPath, capturedAt, pageLoadMs, status, interactiveElements, axeViolations, axeIncomplete, forms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        pageState.url,
        pageState.title,
        pageState.ariaSnapshot,
        JSON.stringify(pageState.links),
        JSON.stringify(pageState.networkLog),
        screenshotPath,
        pageState.capturedAt,
        pageState.pageLoadMs,
        'ok',
        JSON.stringify(pageState.interactiveElements),
        JSON.stringify(pageState.axeViolations),
        JSON.stringify(pageState.axeIncomplete),
        JSON.stringify(pageState.forms),
      )
    },
    pageExists(url: string): boolean {
      return db.prepare('SELECT 1 FROM pages WHERE url = ?').get(url) !== undefined
    },
    getMeta(): { seedUrl: string; startedAt: string; config: CrawlConfig } | null {
      const row = db.prepare('SELECT * FROM crawl_meta ORDER BY startedAt DESC LIMIT 1').get() as
        | Record<string, string | null>
        | undefined
      if (!row) return null
      return {
        seedUrl: row.seedUrl as string,
        startedAt: row.startedAt as string,
        config: row.config ? (JSON.parse(row.config as string) as CrawlConfig) : ({} as CrawlConfig),
      }
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
      screenshotPath: string | null
      capturedAt: string | null
      pageLoadMs: number | null
      interactiveElements: DomInteractiveElement[]
      axeViolations: AxeViolation[]
      axeIncomplete: AxeIncompleteResult[]
      forms: CapturedForm[]
      status: string
    }> {
      const rows = db.prepare('SELECT * FROM pages').all() as Array<Record<string, string | number | Buffer | null>>
      return rows.map((row) => ({
        url: (row.url as string) ?? '',
        title: (row.title as string) ?? null,
        ariaSnapshot: (row.ariaSnapshot as string) ?? null,
        links: row.links ? (JSON.parse(row.links as string) as string[]) : [],
        networkLog: row.networkLog ? (JSON.parse(row.networkLog as string) as NetworkEntry[]) : [],
        screenshotPath: (row.screenshotPath as string) ?? null,
        capturedAt: (row.capturedAt as string) ?? null,
        pageLoadMs: (row.pageLoadMs as number) ?? null,
        interactiveElements: row.interactiveElements
          ? (JSON.parse(row.interactiveElements as string) as DomInteractiveElement[])
          : [],
        axeViolations: row.axeViolations ? (JSON.parse(row.axeViolations as string) as AxeViolation[]) : [],
        axeIncomplete: row.axeIncomplete ? (JSON.parse(row.axeIncomplete as string) as AxeIncompleteResult[]) : [],
        forms: row.forms ? (JSON.parse(row.forms as string) as CapturedForm[]) : [],
        status: (row.status as string) ?? '',
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
