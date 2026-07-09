import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { CapturedForm, PageState } from '@treeline/acquire'
import { openCrawlDb } from './persistence.js'

function makePage(url: string, forms: CapturedForm[] = []): PageState {
  return {
    url,
    title: 'Title',
    ariaSnapshot: '',
    links: [],
    networkLog: [],
    screenshot: null,
    capturedAt: new Date().toISOString(),
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
