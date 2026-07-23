import { describe, it, expect } from 'vitest'
import type { DomInteractiveElement } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import { generatePOM, generateSpec, generatePOMsAndSpecs } from './pom-generation.js'

function makeElement(overrides: Partial<DomInteractiveElement>): DomInteractiveElement {
  return {
    role: 'button',
    accessibleName: 'Submit',
    testId: null,
    tagName: 'button',
    elementId: null,
    classList: [],
    cssPath: 'body > button',
    xpath: '/html/body/button',
    appearedAtMs: null,
    ...overrides,
  }
}

function makePage(overrides: Partial<CrawledPage>): CrawledPage {
  return {
    url: 'https://example.com/about',
    title: 'About',
    ariaSnapshot: '',
    links: [],
    networkLog: [],
    screenshotPath: null,
    capturedAt: new Date().toISOString(),
    pageLoadMs: null,
    interactiveElements: [],
    axeViolations: [],
    axeIncomplete: [],
    forms: [],
    colorPalette: [],
    status: 'ok',
    ...overrides,
  }
}

describe('generatePOM', () => {
  it('generates a direct getByRole locator for a unique stable role candidate', () => {
    const el = makeElement({ role: 'link', accessibleName: 'About', cssPath: 'header > a.about', xpath: '/html/body/header/a[1]' })
    const page = makePage({ interactiveElements: [el] })
    const { pom, skipped } = generatePOM(page)
    expect(skipped).toEqual([])
    expect(pom.code).toContain('getByRole')
    expect(pom.code).toContain('link')
    expect(pom.code).toContain('About')
    expect(pom.code).not.toContain('.nth(')
    expect(pom.code).toContain('readonly aboutLink: Locator')
    expect(pom.code).toContain('this.aboutLink = page.getByRole')
  })

  it('appends .nth() and deduplicates property names when role + accessibleName are shared', () => {
    const aboutLinkOne = makeElement({ role: 'link', accessibleName: 'About', cssPath: 'header > a.about', xpath: '/html/body/header/a[1]' })
    const aboutLinkTwo = makeElement({ role: 'link', accessibleName: 'About', cssPath: 'footer > a.about', xpath: '/html/body/footer/a[1]' })
    const page = makePage({ interactiveElements: [aboutLinkOne, aboutLinkTwo] })
    const { pom, skipped } = generatePOM(page)
    expect(skipped).toEqual([])
    expect(pom.code).toContain('readonly aboutLink1: Locator')
    expect(pom.code).toContain('readonly aboutLink2: Locator')
    expect(pom.code).toContain('this.aboutLink1 = page.getByRole(')
    expect(pom.code).toContain('this.aboutLink2 = page.getByRole(')
    expect(pom.code).toContain('.nth(0)')
    expect(pom.code).toContain('.nth(1)')
  })

  it('excludes an element with no stable candidate and records it as skipped', () => {
    const el = makeElement({
      role: 'generic',
      accessibleName: '',
      testId: null,
      cssPath: 'body > div:nth-of-type(3) > button',
      xpath: '/html/body/div[3]/button',
    })
    const page = makePage({ interactiveElements: [el] })
    const { pom, skipped } = generatePOM(page)
    expect(pom.code).not.toContain(': Locator')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]!.url).toBe(page.url)
    expect(skipped[0]!.reason).toBe('no stable selector candidate available')
  })

  it('generates a class with the expected name, constructor, and goto method', () => {
    const el = makeElement({ role: 'link', accessibleName: 'About' })
    const page = makePage({ url: 'https://example.com/about', interactiveElements: [el] })
    const { pom } = generatePOM(page)
    expect(pom.className).toBe('AboutPage')
    expect(pom.fileName).toBe('about.page.ts')
    expect(pom.code).toContain('export class AboutPage {')
    expect(pom.code).toContain('constructor(page: Page) {')
    expect(pom.code).toContain('async goto(): Promise<void> {')
    expect(pom.code).toContain('this.page.goto(')
    const assignmentLines = pom.code.split('\n').filter((line) => line.trim().startsWith('this.') && line.includes(' = page.'))
    expect(assignmentLines).toHaveLength(1)
  })

  it('emits a legal identifier for a digit-leading accessibleName', () => {
    const first = makeElement({ role: 'link', accessibleName: '3 minutes ago', cssPath: 'td > span.age > a', xpath: '/html/body/table/tbody/tr[1]/td[2]/span/a' })
    const second = makeElement({ role: 'link', accessibleName: '3 minutes ago', cssPath: 'td > span.age2 > a', xpath: '/html/body/table/tbody/tr[2]/td[2]/span/a' })
    const page = makePage({ interactiveElements: [first, second] })
    const { pom } = generatePOM(page)
    expect(pom.code).toContain('readonly _3MinutesAgoLink1: Locator')
    expect(pom.code).toContain('readonly _3MinutesAgoLink2: Locator')
    expect(pom.code).not.toMatch(/readonly \d/)
  })
})

describe('generateSpec', () => {
  it('imports the POM file and asserts the page URL', () => {
    const el = makeElement({ role: 'link', accessibleName: 'About' })
    const page = makePage({ url: 'https://example.com/about', interactiveElements: [el] })
    const { pom } = generatePOM(page)
    const spec = generateSpec(pom, page.url)
    expect(spec.fileName).toBe('about.spec.ts')
    expect(spec.code).toContain(`import { ${pom.className} } from './about.page'`)
    expect(spec.code).toContain('toHaveURL')
    expect(spec.code).toContain(page.url)
  })
})

describe('generatePOMsAndSpecs', () => {
  it('skips a page that failed capture entirely', () => {
    const okPage = makePage({
      url: 'https://example.com/about',
      interactiveElements: [makeElement({ role: 'link', accessibleName: 'About' })],
    })
    const failedPage = makePage({ url: 'https://example.com/broken', title: null, ariaSnapshot: null, capturedAt: null })
    const result = generatePOMsAndSpecs([okPage, failedPage])
    expect(result.poms).toHaveLength(1)
    expect(result.specs).toHaveLength(1)
    expect(result.poms[0]!.className).toBe('AboutPage')
    expect(result.collisions).toEqual([])
  })

  it('does not silently drop a page when two URLs collide on the same base file name (hgwllc.com root vs /home)', () => {
    const rootPage = makePage({ url: 'https://hgwllc.com/', title: 'Home' })
    const homePage = makePage({ url: 'https://hgwllc.com/home', title: 'Home' })
    const result = generatePOMsAndSpecs([homePage, rootPage])
    expect(result.poms).toHaveLength(2)
    expect(result.specs).toHaveLength(2)
    const fileNames = result.poms.map((p) => p.fileName).sort()
    expect(fileNames).toEqual(['home1.page.ts', 'home2.page.ts'])
    const classNames = result.poms.map((p) => p.className).sort()
    expect(classNames).toEqual(['HomePage1', 'HomePage2'])
    expect(result.specs.map((s) => s.fileName).sort()).toEqual(['home1.spec.ts', 'home2.spec.ts'])
    expect(result.collisions).toHaveLength(1)
    expect(result.collisions[0]).toEqual({ baseFileName: 'home', urls: ['https://hgwllc.com/', 'https://hgwllc.com/home'] })
  })

  it('does not silently drop a page when a bare path collides with its .html-suffixed duplicate (goldenpetbrands.com pattern)', () => {
    const barePage = makePage({ url: 'https://goldenpetbrands.com/about', title: 'About' })
    const htmlPage = makePage({ url: 'https://goldenpetbrands.com/about.html', title: 'About' })
    const result = generatePOMsAndSpecs([htmlPage, barePage])
    expect(result.poms).toHaveLength(2)
    expect(result.specs).toHaveLength(2)
    expect(result.poms.map((p) => p.fileName).sort()).toEqual(['about1.page.ts', 'about2.page.ts'])
    expect(result.collisions).toHaveLength(1)
  })

  it('produces identical file names across repeated runs regardless of input order', () => {
    const pages = [
      makePage({ url: 'https://hgwllc.com/home', title: 'Home' }),
      makePage({ url: 'https://hgwllc.com/', title: 'Home' }),
    ]
    const firstRun = generatePOMsAndSpecs(pages)
    const secondRun = generatePOMsAndSpecs([...pages].reverse())
    const firstMap = new Map(firstRun.poms.map((p) => [p.className, p.fileName]))
    const secondMap = new Map(secondRun.poms.map((p) => [p.className, p.fileName]))
    expect([...firstMap.entries()].sort()).toEqual([...secondMap.entries()].sort())
  })

  it('leaves behavior unchanged when there are no collisions', () => {
    const aboutPage = makePage({ url: 'https://example.com/about', title: 'About' })
    const contactPage = makePage({ url: 'https://example.com/contact', title: 'Contact' })
    const result = generatePOMsAndSpecs([aboutPage, contactPage])
    expect(result.collisions).toEqual([])
    expect(result.poms.map((p) => p.fileName).sort()).toEqual(['about.page.ts', 'contact.page.ts'])
  })
})
