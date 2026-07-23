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

function makeHnFixture(rowCount: number): DomInteractiveElement[] {
  const elements: DomInteractiveElement[] = []
  for (let i = 1; i <= rowCount; i++) {
    const storyId = 45201358 + i
    elements.push(
      makeElement({
        role: 'link',
        accessibleName: 'upvote',
        elementId: `up_${storyId}`,
        cssPath: `#up_${storyId}`,
        xpath: `/html/body/table/tbody/tr[${i}]/td[1]/a`,
      }),
    )
    elements.push(
      makeElement({
        role: 'link',
        accessibleName: `Story number ${i}`,
        cssPath: `table > tbody > tr.athing:nth-of-type(${i}) > td.title > span.titleline > a`,
        xpath: `/html/body/table/tbody/tr[${i}]/td[2]/span/a`,
      }),
    )
    elements.push(
      makeElement({
        role: 'text',
        accessibleName: `${i} points`,
        tagName: 'span',
        cssPath: `table > tbody > tr.athing:nth-of-type(${i}) > td.subtext > span.score`,
        xpath: `/html/body/table/tbody/tr[${i}]/td[3]/span`,
      }),
    )
  }
  return elements
}

describe('generatePOM — repeating rows (feedback #3)', () => {
  it('emits one row component class + indexed accessor for a 30-row repeating region instead of per-instance fields', () => {
    const page = makePage({ interactiveElements: makeHnFixture(30) })
    const { pom } = generatePOM(page)
    expect(pom.code).toContain('export class AthingRow {')
    expect(pom.code).toContain('readonly root: Locator')
    expect(pom.code).toContain('readonly titleLink: Locator')
    expect(pom.code).toContain('readonly subtextText: Locator')
    expect(pom.code).toContain('this.titleLink = root.locator("td.title > span.titleline > a")')
    expect(pom.code).toContain('this.subtextText = root.locator("td.subtext > span.score")')
    expect(pom.code).toContain('athingRow(index: number): AthingRow {')
    expect(pom.code).toContain('return new AthingRow(this.page.locator("table > tbody > tr.athing").nth(index))')
  })

  it('does not emit 30 separate per-story fields on the page class for the row-covered elements', () => {
    const page = makePage({ interactiveElements: makeHnFixture(30) })
    const { pom } = generatePOM(page)
    expect(pom.code).not.toContain('titleLink1')
    expect(pom.code).not.toContain('storyNumber1Link')
    const pageClassStart = pom.code.indexOf('export class AboutPage')
    const pageClassBody = pom.code.slice(pageClassStart)
    expect(pageClassBody).not.toContain('td.title > span.titleline > a')
  })

  it('also row-ifies an entity-id-keyed repeating group (no ancestor nth-of-type, e.g. HN vote links) via a shared role+name row root', () => {
    const page = makePage({ interactiveElements: makeHnFixture(30) })
    const { pom } = generatePOM(page)
    expect(pom.code).toContain('export class UpvoteLinkRow {')
    expect(pom.code).toContain('readonly upvoteLink: Locator')
    expect(pom.code).toContain('this.upvoteLink = root')
    expect(pom.code).toContain('upvoteLinkRow(index: number): UpvoteLinkRow {')
    expect(pom.code).toContain('return new UpvoteLinkRow(this.page.getByRole("link", { name: "upvote" }).nth(index))')
    expect(pom.code).not.toContain('readonly upvoteLink1: Locator')
  })

  it('leaves a flat entity-id repeating group un-row-ified when its members do not share one accessibleName', () => {
    const elements: DomInteractiveElement[] = []
    for (let i = 1; i <= 5; i++) {
      elements.push(makeElement({ role: 'link', accessibleName: `reply to comment ${i}`, elementId: `reply_${1000000 + i}`, cssPath: `#reply_${1000000 + i}`, xpath: `/x${i}` }))
    }
    const page = makePage({ interactiveElements: elements })
    const { pom } = generatePOM(page)
    expect(pom.code).not.toContain('Row {')
    expect(pom.code).toContain('readonly replyToComment1Link: Locator')
    expect(pom.code).toContain('readonly replyToComment5Link: Locator')
  })

  it('does not row-ify a duplicate-destinations-shaped page with only two same-text links (below MIN_REPEATING_INSTANCE_COUNT)', () => {
    const first = makeElement({ role: 'link', accessibleName: 'Read more', cssPath: 'main > article:nth-of-type(1) > a.cta', xpath: '/html/body/main/article[1]/a' })
    const second = makeElement({ role: 'link', accessibleName: 'Read more', cssPath: 'main > article:nth-of-type(2) > a.cta', xpath: '/html/body/main/article[2]/a' })
    const page = makePage({ interactiveElements: [first, second] })
    const { pom } = generatePOM(page)
    expect(pom.code).not.toContain('Row {')
    expect(pom.code).toContain('readonly readMoreLink1: Locator')
    expect(pom.code).toContain('readonly readMoreLink2: Locator')
  })

  it('generated row component code passes the syntax gate (parses as valid TypeScript)', () => {
    const page = makePage({ interactiveElements: makeHnFixture(30) })
    expect(() => generatePOM(page)).not.toThrow()
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
