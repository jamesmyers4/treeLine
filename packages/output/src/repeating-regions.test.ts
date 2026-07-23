import { describe, it, expect } from 'vitest'
import type { DomInteractiveElement } from '@treeline/acquire'
import { detectRepeatingRegions, MIN_REPEATING_INSTANCE_COUNT } from './repeating-regions.js'

function makeElement(overrides: Partial<DomInteractiveElement>): DomInteractiveElement {
  return {
    role: 'link',
    accessibleName: 'Story title',
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

function makeHnFixture(rowCount: number): DomInteractiveElement[] {
  const elements: DomInteractiveElement[] = []
  for (let i = 1; i <= rowCount; i++) {
    const storyId = 45201358 + i
    elements.push(
      makeElement({
        role: 'link',
        accessibleName: `Story ${i}`,
        elementId: `up_${storyId}`,
        cssPath: `#up_${storyId}`,
        xpath: `/html/body/table/tbody/tr[${i}]/td[1]/a`,
      }),
    )
    elements.push(
      makeElement({
        role: 'link',
        accessibleName: `Story ${i} title`,
        cssPath: `table > tbody > tr.athing:nth-of-type(${i}) > td.title > span.titleline > a`,
        xpath: `/html/body/table/tbody/tr[${i}]/td[2]/span/a`,
      }),
    )
    elements.push(
      makeElement({
        role: 'link',
        accessibleName: `${i} points`,
        tagName: 'span',
        cssPath: `table > tbody > tr.athing:nth-of-type(${i}) > td.subtext > span.score`,
        xpath: `/html/body/table/tbody/tr[${i}]/td[3]/span`,
      }),
    )
  }
  return elements
}

describe('detectRepeatingRegions — HN-shaped fixture', () => {
  it('groups 30 identical vote-arrow rows into one pattern', () => {
    const groups = detectRepeatingRegions(makeHnFixture(30))
    const voteGroup = groups.find((g) => g.structuralSignature === '#up_N')
    expect(voteGroup).toBeDefined()
    expect(voteGroup!.instanceCount).toBe(30)
  })

  it('groups 30 identical title-link rows into one pattern, distinct from the vote-arrow group', () => {
    const groups = detectRepeatingRegions(makeHnFixture(30))
    const titleGroup = groups.find((g) => g.structuralSignature.includes('td.title'))
    expect(titleGroup).toBeDefined()
    expect(titleGroup!.instanceCount).toBe(30)
    expect(titleGroup!.role).toBe('link')
  })

  it('groups 30 identical points-span rows into their own pattern, keyed by role and tagName', () => {
    const groups = detectRepeatingRegions(makeHnFixture(30))
    const pointsGroup = groups.find((g) => g.structuralSignature.includes('td.subtext'))
    expect(pointsGroup).toBeDefined()
    expect(pointsGroup!.instanceCount).toBe(30)
    expect(pointsGroup!.tagName).toBe('span')
  })

  it('detects exactly three pattern groups for the 30-row fixture', () => {
    const groups = detectRepeatingRegions(makeHnFixture(30))
    expect(groups.length).toBe(3)
  })
})

describe('detectRepeatingRegions — negative cases', () => {
  it('returns no groups for a heterogeneous page with no structural repetition', () => {
    const elements = [
      makeElement({ accessibleName: 'Home', cssPath: 'nav > a.home' }),
      makeElement({ accessibleName: 'About', tagName: 'button', role: 'button', cssPath: 'header > button.about' }),
      makeElement({ accessibleName: 'Search', tagName: 'input', role: 'textbox', cssPath: 'form > input.search' }),
    ]
    expect(detectRepeatingRegions(elements)).toEqual([])
  })

  it('does not misclassify two same-text links (duplicate-destinations) as a repeating region', () => {
    const elements = [
      makeElement({ accessibleName: 'Learn more', cssPath: 'header > nav > a.cta:nth-of-type(1)' }),
      makeElement({ accessibleName: 'Learn more', cssPath: 'footer > nav > a.cta:nth-of-type(1)' }),
    ]
    expect(detectRepeatingRegions(elements)).toEqual([])
  })

  it('does not misclassify an ordinary 3-item nav (Home/About/Contact siblings varying only by their own nth-of-type) as a repeating region', () => {
    const elements = [
      makeElement({ role: 'link', accessibleName: 'Home', cssPath: 'nav > a:nth-of-type(1)' }),
      makeElement({ role: 'link', accessibleName: 'About', cssPath: 'nav > a:nth-of-type(2)' }),
      makeElement({ role: 'link', accessibleName: 'Contact', cssPath: 'nav > a:nth-of-type(3)' }),
    ]
    expect(detectRepeatingRegions(elements)).toEqual([])
  })

  it('still detects a real repeating region when the varying nth-of-type is on an ancestor, not the leaf itself', () => {
    const elements = [1, 2, 3].map((i) =>
      makeElement({ role: 'link', accessibleName: `Item ${i}`, cssPath: `ul > li:nth-of-type(${i}) > a` }),
    )
    const groups = detectRepeatingRegions(elements)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.instanceCount).toBe(3)
  })

  it('requires at least MIN_REPEATING_INSTANCE_COUNT members before qualifying as a pattern', () => {
    const rows = makeHnFixture(MIN_REPEATING_INSTANCE_COUNT - 1)
    expect(detectRepeatingRegions(rows)).toEqual([])
  })

  it('qualifies once the instance count reaches MIN_REPEATING_INSTANCE_COUNT', () => {
    const rows = makeHnFixture(MIN_REPEATING_INSTANCE_COUNT)
    expect(detectRepeatingRegions(rows).length).toBe(3)
  })
})
