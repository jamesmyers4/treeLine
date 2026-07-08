import { describe, it, expect } from 'vitest'
import type { DomInteractiveElement } from '@treeline/acquire'
import { urlToClassName, urlToFileBaseName, elementToPropertyName, deduplicatePropertyNames } from './naming.js'

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
