import { describe, it, expect } from 'vitest'
import type { DomInteractiveElement } from '@treeline/acquire'
import { urlToClassName, urlToFileBaseName, elementToPropertyName, deduplicatePropertyNames, assignUniqueNames } from './naming.js'

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

describe('urlToClassName', () => {
  it('maps the root path to HomePage', () => {
    expect(urlToClassName('https://example.com/')).toBe('HomePage')
  })

  it('derives a PascalCase name from a nested path', () => {
    expect(urlToClassName('https://example.com/about/team')).toBe('AboutTeamPage')
  })

  it('derives a PascalCase name from a hyphenated path and strips .html', () => {
    expect(urlToClassName('https://example.com/our-brands.html')).toBe('OurBrandsPage')
  })

  it('prefixes an underscore when the path starts with a digit', () => {
    expect(urlToClassName('https://example.com/3d-printers')).toBe('_3dPrintersPage')
  })
})

describe('urlToFileBaseName', () => {
  it('maps the root path to home', () => {
    expect(urlToFileBaseName('https://example.com/')).toBe('home')
  })

  it('derives a kebab-case name from a nested path', () => {
    expect(urlToFileBaseName('https://example.com/about/team')).toBe('about-team')
  })

  it('derives a kebab-case name from a hyphenated path and strips .html', () => {
    expect(urlToFileBaseName('https://example.com/our-brands.html')).toBe('our-brands')
  })
})

describe('elementToPropertyName', () => {
  it('builds a camelCase name from role and accessibleName', () => {
    const el = makeElement({ role: 'link', accessibleName: 'About' })
    expect(elementToPropertyName(el)).toBe('aboutLink')
  })

  it('strips punctuation and camelCases multi-word accessibleName', () => {
    const el = makeElement({ role: 'button', accessibleName: 'Open menu' })
    expect(elementToPropertyName(el)).toBe('openMenuButton')
  })

  it('falls back to tagName + role when accessibleName is empty', () => {
    const el = makeElement({ role: 'nav', accessibleName: '', tagName: 'input' })
    expect(elementToPropertyName(el)).toBe('navInput')
  })

  it('prefixes an underscore when the accessibleName starts with a digit', () => {
    const el = makeElement({ role: 'link', accessibleName: '3 minutes ago' })
    expect(elementToPropertyName(el)).toBe('_3MinutesAgoLink')
  })

  it('does not prefix names that already start with a letter', () => {
    const el = makeElement({ role: 'link', accessibleName: 'About 3 things' })
    expect(elementToPropertyName(el)).toBe('about3ThingsLink')
  })
})

describe('assignUniqueNames', () => {
  it('leaves non-colliding URLs unchanged and reports no collisions', () => {
    const urls = ['https://example.com/about', 'https://example.com/contact']
    const { assignments, collisions } = assignUniqueNames(urls)
    expect(collisions).toEqual([])
    expect(assignments.get('https://example.com/about')).toEqual({
      url: 'https://example.com/about',
      className: 'AboutPage',
      fileBaseName: 'about',
    })
    expect(assignments.get('https://example.com/contact')).toEqual({
      url: 'https://example.com/contact',
      className: 'ContactPage',
      fileBaseName: 'contact',
    })
  })

  it('disambiguates root vs /home colliding on the same base name', () => {
    const urls = ['https://hgwllc.com/home', 'https://hgwllc.com/']
    const { assignments, collisions } = assignUniqueNames(urls)
    expect(collisions).toHaveLength(1)
    expect(collisions[0]!.baseFileName).toBe('home')
    expect(collisions[0]!.urls).toEqual(['https://hgwllc.com/', 'https://hgwllc.com/home'])
    expect(assignments.get('https://hgwllc.com/')).toEqual({
      url: 'https://hgwllc.com/',
      className: 'HomePage1',
      fileBaseName: 'home1',
    })
    expect(assignments.get('https://hgwllc.com/home')).toEqual({
      url: 'https://hgwllc.com/home',
      className: 'HomePage2',
      fileBaseName: 'home2',
    })
  })

  it('disambiguates a bare path vs its .html-suffixed duplicate', () => {
    const urls = ['https://goldenpetbrands.com/about.html', 'https://goldenpetbrands.com/about']
    const { assignments, collisions } = assignUniqueNames(urls)
    expect(collisions).toHaveLength(1)
    expect(collisions[0]!.baseFileName).toBe('about')
    expect(assignments.get('https://goldenpetbrands.com/about')!.fileBaseName).toBe('about1')
    expect(assignments.get('https://goldenpetbrands.com/about.html')!.fileBaseName).toBe('about2')
  })

  it('produces identical assignments across repeated runs on the same input', () => {
    const urls = ['https://example.com/', 'https://example.com/home', 'https://example.com/about']
    const first = assignUniqueNames(urls)
    const second = assignUniqueNames([...urls].reverse())
    expect([...first.assignments.entries()].sort()).toEqual([...second.assignments.entries()].sort())
    expect(first.collisions).toEqual(second.collisions)
  })
})

describe('deduplicatePropertyNames', () => {
  it('leaves unique names unchanged', () => {
    expect(deduplicatePropertyNames(['aboutLink', 'submitButton'])).toEqual(['aboutLink', 'submitButton'])
  })

  it('suffixes duplicate names starting at 1 in DOM order', () => {
    const result = deduplicatePropertyNames(['aboutLink', 'submitButton', 'aboutLink'])
    expect(result).toEqual(['aboutLink1', 'submitButton', 'aboutLink2'])
  })
})
