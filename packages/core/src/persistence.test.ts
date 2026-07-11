import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { CapturedForm, DomInteractiveElement, PageState } from '@treeline/acquire'
import type { CrawlConfig, StoredInterpretation } from './types.js'
import { openCrawlDb } from './persistence.js'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function makePage(url: string, forms: CapturedForm[] = [], screenshot: Buffer | null = null): PageState {
  return {
    url,
    title: 'Title',
    ariaSnapshot: '',
    links: [],
    networkLog: [],
    screenshot,
    capturedAt: new Date().toISOString(),
    pageLoadMs: 842,
    interactiveElements: [],
    axeViolations: [],
    axeIncomplete: [],
    forms,
  }
}

function makeForm(overrides: Partial<CapturedForm> = {}): CapturedForm {
  return {
    formIndex: 0,
    action: '/submit',
    method: 'post',
    fields: [
      {
        role: 'textbox',
        accessibleName: 'Email',
        tagName: 'input',
        inputType: 'email',
        required: true,
        pattern: null,
        testId: null,
        cssPath: 'body > form > input',
      },
    ],
    ...overrides,
  }
}

let tmpDir: string
let dbPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'treeline-persistence-test-'))
  dbPath = join(tmpDir, 'crawl.db')
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('forms persistence', () => {
  it('round-trips a non-empty forms array field for field', () => {
    const forms = [makeForm(), makeForm({ formIndex: 1, action: '/other', method: 'get' })]
    const db = openCrawlDb(dbPath)
    db.recordPageState(makePage('https://example.com/', forms))
    const pages = db.getAllPages()
    db.close()
    expect(pages).toHaveLength(1)
    expect(pages[0].forms).toEqual(forms)
  })

  it('round-trips an empty forms array as [] not undefined/null', () => {
    const db = openCrawlDb(dbPath)
    db.recordPageState(makePage('https://example.com/no-form', []))
    const pages = db.getAllPages()
    db.close()
    expect(pages[0].forms).toEqual([])
    expect(pages[0].forms).not.toBeUndefined()
    expect(pages[0].forms).not.toBeNull()
  })

  it('keeps forms isolated per page across multiple rows', () => {
    const formsA = [makeForm({ action: '/a' })]
    const formsB = [makeForm({ action: '/b' }), makeForm({ formIndex: 1, action: '/b2' })]
    const db = openCrawlDb(dbPath)
    db.recordPageState(makePage('https://example.com/a', formsA))
    db.recordPageState(makePage('https://example.com/b', formsB))
    db.recordPageState(makePage('https://example.com/c', []))
    const pages = db.getAllPages()
    db.close()
    const pageA = pages.find((p) => p.url === 'https://example.com/a')!
    const pageB = pages.find((p) => p.url === 'https://example.com/b')!
    const pageC = pages.find((p) => p.url === 'https://example.com/c')!
    expect(pageA.forms).toEqual(formsA)
    expect(pageB.forms).toEqual(formsB)
    expect(pageC.forms).toEqual([])
  })

  it('does not affect pageExists resumability once forms are present', () => {
    const db = openCrawlDb(dbPath)
    expect(db.pageExists('https://example.com/')).toBe(false)
    db.recordPageState(makePage('https://example.com/', [makeForm()]))
    expect(db.pageExists('https://example.com/')).toBe(true)
    expect(db.pageExists('https://example.com/other')).toBe(false)
    db.close()
  })
})

describe('pageLoadMs persistence', () => {
  it('round-trips a non-zero pageLoadMs', () => {
    const page = makePage('https://example.com/')
    page.pageLoadMs = 1337
    const db = openCrawlDb(dbPath)
    db.recordPageState(page)
    const pages = db.getAllPages()
    db.close()
    expect(pages[0].pageLoadMs).toBe(1337)
  })

  it('stores null pageLoadMs for pages recorded via markFailed', () => {
    const db = openCrawlDb(dbPath)
    db.markFailed('https://example.com/failed', 'timeout')
    const pages = db.getAllPages()
    db.close()
    expect(pages[0].pageLoadMs).toBeNull()
  })
})

describe('appearedAtMs persistence (per-element appearance latency)', () => {
  it('round-trips a real appearedAtMs value alongside a null one within interactiveElements', () => {
    const elements: DomInteractiveElement[] = [
      {
        role: 'button',
        accessibleName: 'Immediate',
        testId: null,
        tagName: 'button',
        elementId: null,
        classList: [],
        cssPath: 'body > button',
        xpath: '/html/body/button',
        appearedAtMs: null,
      },
      {
        role: 'link',
        accessibleName: 'Delayed',
        testId: null,
        tagName: 'a',
        elementId: null,
        classList: [],
        cssPath: 'body > a',
        xpath: '/html/body/a',
        appearedAtMs: 842,
      },
    ]
    const page = makePage('https://example.com/')
    page.interactiveElements = elements
    const db = openCrawlDb(dbPath)
    db.recordPageState(page)
    const pages = db.getAllPages()
    db.close()
    expect(pages[0].interactiveElements).toEqual(elements)
  })
})

describe('interpretation persistence', () => {
  function makeInterpretation(overrides: Partial<StoredInterpretation> = {}): StoredInterpretation {
    return {
      url: 'https://example.com/',
      tierUsed: 'haiku',
      pageType: 'landing',
      purpose: 'Welcome users',
      keyDataEntities: ['user'],
      confidence: 0.9,
      interpretedAt: new Date().toISOString(),
      proposedAssertion: null,
      ...overrides,
    }
  }

  it('round-trips a null proposedAssertion', () => {
    const db = openCrawlDb(dbPath)
    db.recordInterpretation(makeInterpretation())
    const stored = db.getInterpretation('https://example.com/')
    db.close()
    expect(stored?.proposedAssertion).toBeNull()
  })

  it('round-trips a non-null proposedAssertion', () => {
    const proposedAssertion = {
      scenario: 'Fill out and submit the signup form with synthetic data',
      formIndex: 0,
      fieldValues: [{ fieldIndex: 0, accessibleName: 'Email', value: 'test@example.com' }],
      successAssertion: 'A confirmation message appears',
      successAssertionCaveat: 'This success assertion is an unverified guess.',
    }
    const db = openCrawlDb(dbPath)
    db.recordInterpretation(makeInterpretation({ proposedAssertion }))
    const stored = db.getInterpretation('https://example.com/')
    const all = db.getAllInterpretations()
    db.close()
    expect(stored?.proposedAssertion).toEqual(proposedAssertion)
    expect(all[0]?.proposedAssertion).toEqual(proposedAssertion)
  })
})

describe('crawl_meta persistence', () => {
  it('returns null when no meta has been inserted', () => {
    const db = openCrawlDb(dbPath)
    const meta = db.getMeta()
    db.close()
    expect(meta).toBeNull()
  })

  it('round-trips seedUrl, startedAt, and config', () => {
    const config: CrawlConfig = {
      seedUrl: 'https://example.com/',
      sameOriginOnly: true,
      maxDepth: 2,
      maxPages: 20,
      stealth: false,
      respectRobotsTxt: true,
      throttleMs: 500,
    }
    const db = openCrawlDb(dbPath)
    db.insertMeta('https://example.com/', config)
    const meta = db.getMeta()
    db.close()
    expect(meta).not.toBeNull()
    expect(meta!.seedUrl).toBe('https://example.com/')
    expect(typeof meta!.startedAt).toBe('string')
    expect(meta!.config).toEqual(config)
  })
})

describe('screenshot persistence', () => {
  const fakePng = Buffer.concat([PNG_SIGNATURE, Buffer.from('fake-png-bytes-for-testing')])

  it('writes a non-null screenshot to disk and stores its path, not the buffer', () => {
    const db = openCrawlDb(dbPath)
    db.recordPageState(makePage('https://example.com/', [], fakePng))
    const pages = db.getAllPages()
    db.close()
    expect(pages).toHaveLength(1)
    expect(typeof pages[0].screenshotPath).toBe('string')
    const onDiskPath = join(tmpDir, pages[0].screenshotPath!)
    expect(existsSync(onDiskPath)).toBe(true)
  })

  it('writes no file and stores a null screenshotPath when screenshot is null', () => {
    const db = openCrawlDb(dbPath)
    db.recordPageState(makePage('https://example.com/failed', [], null))
    const pages = db.getAllPages()
    db.close()
    expect(pages[0].screenshotPath).toBeNull()
    expect(existsSync(join(tmpDir, 'screenshots'))).toBe(false)
  })

  it('getAllPages returns a screenshotPath matching what was actually written to disk', () => {
    const db = openCrawlDb(dbPath)
    db.recordPageState(makePage('https://example.com/', [], fakePng))
    const pages = db.getAllPages()
    db.close()
    const onDiskPath = join(tmpDir, pages[0].screenshotPath!)
    expect(existsSync(onDiskPath)).toBe(true)
    expect(readFileSync(onDiskPath).equals(fakePng)).toBe(true)
  })

  it('produces separate, non-colliding screenshot files for the same URL across two output directories', () => {
    const tmpDirB = mkdtempSync(join(tmpdir(), 'treeline-persistence-test-'))
    const dbPathB = join(tmpDirB, 'crawl.db')
    const dbA = openCrawlDb(dbPath)
    dbA.recordPageState(makePage('https://example.com/', [], fakePng))
    const pagesA = dbA.getAllPages()
    dbA.close()
    const dbB = openCrawlDb(dbPathB)
    dbB.recordPageState(makePage('https://example.com/', [], fakePng))
    const pagesB = dbB.getAllPages()
    dbB.close()
    expect(pagesA[0].screenshotPath).toBe(pagesB[0].screenshotPath)
    const pathA = join(tmpDir, pagesA[0].screenshotPath!)
    const pathB = join(tmpDirB, pagesB[0].screenshotPath!)
    expect(pathA).not.toBe(pathB)
    expect(existsSync(pathA)).toBe(true)
    expect(existsSync(pathB)).toBe(true)
    rmSync(tmpDirB, { recursive: true, force: true })
  })

  it('round-trips the exact captured buffer bytes, not just "a file exists"', () => {
    const db = openCrawlDb(dbPath)
    db.recordPageState(makePage('https://example.com/', [], fakePng))
    const pages = db.getAllPages()
    db.close()
    const onDisk = readFileSync(join(tmpDir, pages[0].screenshotPath!))
    expect(onDisk.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
    expect(onDisk.equals(fakePng)).toBe(true)
  })

  it('does not affect pageExists resumability once a screenshotPath is present', () => {
    const db = openCrawlDb(dbPath)
    expect(db.pageExists('https://example.com/')).toBe(false)
    db.recordPageState(makePage('https://example.com/', [], fakePng))
    expect(db.pageExists('https://example.com/')).toBe(true)
    expect(db.pageExists('https://example.com/other')).toBe(false)
    db.close()
  })
})
