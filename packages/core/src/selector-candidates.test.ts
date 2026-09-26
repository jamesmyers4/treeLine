import { describe, it, expect } from 'vitest'
import type { DomInteractiveElement } from '@treeline/acquire'
import { computeSelectorCandidates, isVolatileAccessibleName } from './selector-candidates.js'

function makeElement(overrides: Partial<DomInteractiveElement>): DomInteractiveElement {
  return {
    role: 'link',
    accessibleName: 'upvote',
    testId: null,
    tagName: 'a',
    elementId: null,
    classList: [],
    cssPath: 'td > a',
    xpath: '/html/body/table/tbody/tr/td/a',
    appearedAtMs: null,
    href: null,
    ...overrides,
  }
}

function cssCandidate(el: DomInteractiveElement) {
  const candidates = computeSelectorCandidates([el]).get(el)!
  return candidates.find((c) => c.strategy === 'css')!
}

describe('isCssStable — entity-id digit runs', () => {
  it('marks an entity-id selector like #up_45201358 unstable', () => {
    const el = makeElement({ elementId: 'up_45201358', cssPath: '#up_45201358' })
    expect(cssCandidate(el).stable).toBe(false)
  })

  it('keeps a semantic id like #main-nav stable', () => {
    const el = makeElement({ elementId: 'main-nav', cssPath: '#main-nav' })
    expect(cssCandidate(el).stable).toBe(true)
  })

  it('keeps short-digit semantic tokens like col2 stable', () => {
    const el = makeElement({ classList: ['col2'], cssPath: 'td.col2 > a' })
    expect(cssCandidate(el).stable).toBe(true)
  })

  it('keeps a 3-digit run stable (below the threshold)', () => {
    const el = makeElement({ elementId: 'error404', cssPath: '#error404' })
    expect(cssCandidate(el).stable).toBe(true)
  })

  it('marks a 4-digit run unstable (at the threshold)', () => {
    const el = makeElement({ elementId: 'item-1000', cssPath: '#item-1000' })
    expect(cssCandidate(el).stable).toBe(false)
  })

  it('marks an entity-shaped class token in an ancestor path segment unstable', () => {
    const el = makeElement({ cssPath: 'tr.item-45201358 > td > a' })
    expect(cssCandidate(el).stable).toBe(false)
  })

  it('marks an entity elementId unstable even when the cssPath itself carries no digits', () => {
    const el = makeElement({ elementId: 'up_45201358', cssPath: 'td.votelinks > a' })
    expect(cssCandidate(el).stable).toBe(false)
  })

  it('leaves the role candidate stable for an entity-id element so POMs can fall back to it', () => {
    const el = makeElement({ elementId: 'up_45201358', cssPath: '#up_45201358' })
    const candidates = computeSelectorCandidates([el]).get(el)!
    const role = candidates.find((c) => c.strategy === 'role')!
    expect(role.stable).toBe(true)
  })
})

describe('isCssStable — pre-existing rules unchanged', () => {
  it('marks an nth-of-type path unstable', () => {
    const el = makeElement({ cssPath: 'div > a:nth-of-type(3)' })
    expect(cssCandidate(el).stable).toBe(false)
  })

  it('marks a hash-like class unstable', () => {
    const el = makeElement({ classList: ['css-1x2y3z'], cssPath: 'a.css-1x2y3z' })
    expect(cssCandidate(el).stable).toBe(false)
  })

  it('keeps a plain semantic path stable', () => {
    const el = makeElement({ classList: ['votearrow'], cssPath: 'td.votelinks > a.votearrow' })
    expect(cssCandidate(el).stable).toBe(true)
  })
})

describe('role candidate uniqueness — matches Playwright getByRole exact: true semantics', () => {
  function roleCandidate(el: DomInteractiveElement, all: DomInteractiveElement[]) {
    return computeSelectorCandidates(all).get(el)!.find((c) => c.strategy === 'role')!
  }

  it('treats names differing only in internal whitespace as the same name, since Playwright collapses whitespace', () => {
    const a = makeElement({ accessibleName: 'Read\n    more' })
    const b = makeElement({ accessibleName: 'Read more' })
    expect(roleCandidate(a, [a, b]).uniqueOnPage).toBe(false)
    expect(roleCandidate(b, [a, b]).uniqueOnPage).toBe(false)
  })

  it('keeps a name that is only a substring of another name unique, since generated locators use exact: true', () => {
    const home = makeElement({ accessibleName: 'Home' })
    const homePage = makeElement({ accessibleName: 'Home page' })
    expect(roleCandidate(home, [home, homePage]).uniqueOnPage).toBe(true)
  })

  it('JSON-escapes quotes in the role selector value and collapses whitespace', () => {
    const el = makeElement({ accessibleName: 'Say  "hi"\n' })
    expect(roleCandidate(el, [el]).value).toBe('role=link[name="Say \\"hi\\""]')
  })
})

describe('isVolatileAccessibleName', () => {
  it.each([
    '0 minutes ago',
    '1 minute ago',
    '23 hours ago',
    '8 days ago',
    'an hour ago',
    'a minute ago',
    '5m ago',
    '3h ago',
    'posted 2 weeks ago',
    'just now',
    '1 comment',
    '389 comments',
    '1,204 points',
    '12 votes',
    '92k+ stargazers on GitHub',
    'Showing 1 to 10 of 15 entries',
  ])('flags %j', (name) => {
    expect(isVolatileAccessibleName(name)).toBe(true)
  })

  it.each([
    'upvote',
    'Playwright v1.56',
    '8:00',
    'Fields Medals 2026',
    'Ten Steps Towards Happiness (2015)',
    "Big Tech Isn't Hiding $1.65T of Debt",
    'CMS 1500 PDF',
    'No Minimum 4 5 6 7 8 9 10',
    'comments',
    'Top 10 stories',
    'Agomez',
  ])('does not flag %j', (name) => {
    expect(isVolatileAccessibleName(name)).toBe(false)
  })
})

describe('role candidate stability — volatile accessible names', () => {
  function roleCandidate(el: DomInteractiveElement) {
    return computeSelectorCandidates([el]).get(el)!.find((c) => c.strategy === 'role')!
  }

  it('marks a relative-time link name unstable', () => {
    expect(roleCandidate(makeElement({ accessibleName: '3 minutes ago' })).stable).toBe(false)
  })

  it('marks a comment-count link name unstable', () => {
    expect(roleCandidate(makeElement({ accessibleName: '49 comments' })).stable).toBe(false)
  })

  it('keeps an ordinary link name stable', () => {
    expect(roleCandidate(makeElement({ accessibleName: 'upvote' })).stable).toBe(true)
  })
})
