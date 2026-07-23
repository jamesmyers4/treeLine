import type { DomInteractiveElement } from '@treeline/acquire'

export type LocatorStrategy = 'role' | 'testid' | 'css' | 'xpath'

export interface SelectorCandidate {
  strategy: LocatorStrategy
  value: string
  stable: boolean
  uniqueOnPage: boolean
}

const NON_ROLE_VALUES = new Set(['', 'generic', 'none'])

function isHashLikeClass(className: string): boolean {
  if (!/^[a-z0-9_-]{6,}$/i.test(className)) return false
  const segments = className.split(/[-_]/).filter((segment) => segment.length > 0)
  const allLettersOnly = segments.every((segment) => /^[a-z]+$/i.test(segment))
  return !allLettersOnly
}

const ENTITY_DIGIT_RUN = /\d{4,}/

function hasEntityDigitRun(token: string): boolean {
  return ENTITY_DIGIT_RUN.test(token)
}

function cssPathIdAndClassTokens(cssPath: string): string[] {
  const matches = cssPath.match(/[#.][^#.\s>:]+/g) ?? []
  return matches.map((token) => token.slice(1))
}

function isCssStable(el: DomInteractiveElement): boolean {
  if (el.cssPath.includes(':nth-of-type')) return false
  if (el.classList.some(isHashLikeClass)) return false
  if (el.elementId !== null && hasEntityDigitRun(el.elementId)) return false
  if (cssPathIdAndClassTokens(el.cssPath).some(hasEntityDigitRun)) return false
  return true
}

function isRoleUnique(el: DomInteractiveElement, allElements: DomInteractiveElement[]): boolean {
  return !allElements.some((other) => other !== el && other.role === el.role && other.accessibleName === el.accessibleName)
}

function isTestIdUnique(el: DomInteractiveElement, allElements: DomInteractiveElement[]): boolean {
  return !allElements.some((other) => other !== el && other.testId === el.testId)
}

function isCssUnique(el: DomInteractiveElement, allElements: DomInteractiveElement[]): boolean {
  return !allElements.some((other) => other !== el && other.cssPath === el.cssPath)
}

function buildCandidates(el: DomInteractiveElement, allElements: DomInteractiveElement[]): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = []
  const hasRealRole = !NON_ROLE_VALUES.has(el.role)
  if (hasRealRole && el.accessibleName.trim() !== '') {
    candidates.push({
      strategy: 'role',
      value: `role=${el.role}[name="${el.accessibleName}"]`,
      stable: true,
      uniqueOnPage: isRoleUnique(el, allElements),
    })
  }
  if (el.testId !== null) {
    candidates.push({
      strategy: 'testid',
      value: `[data-testid="${el.testId}"]`,
      stable: true,
      uniqueOnPage: isTestIdUnique(el, allElements),
    })
  }
  candidates.push({ strategy: 'css', value: el.cssPath, stable: isCssStable(el), uniqueOnPage: isCssUnique(el, allElements) })
  candidates.push({ strategy: 'xpath', value: el.xpath, stable: false, uniqueOnPage: true })
  return candidates
}

export function computeSelectorCandidates(interactiveElements: DomInteractiveElement[]): Map<DomInteractiveElement, SelectorCandidate[]> {
  const candidatesByElement = new Map<DomInteractiveElement, SelectorCandidate[]>()
  for (const el of interactiveElements) {
    candidatesByElement.set(el, buildCandidates(el, interactiveElements))
  }
  return candidatesByElement
}

export interface ElementOccurrence {
  role: string
  accessibleName: string
  occurrenceIndex: number
  element: DomInteractiveElement
}

export function assignOccurrenceIndexes(elements: DomInteractiveElement[]): ElementOccurrence[] {
  const counts = new Map<string, number>()
  const occurrences: ElementOccurrence[] = []
  for (const element of elements) {
    const key = `${element.role} ${element.accessibleName}`
    const occurrenceIndex = counts.get(key) ?? 0
    counts.set(key, occurrenceIndex + 1)
    occurrences.push({ role: element.role, accessibleName: element.accessibleName, occurrenceIndex, element })
  }
  return occurrences
}
