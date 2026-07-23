import { describe, it, expect } from 'vitest'
import type { DomInteractiveElement } from '@treeline/acquire'
import { computeSelectorCandidates } from './selector-candidates.js'

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
