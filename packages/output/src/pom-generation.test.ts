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
    screenshot: null,
    capturedAt: new Date().toISOString(),
    interactiveElements: [],
    axeViolations: [],
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
  })
})
