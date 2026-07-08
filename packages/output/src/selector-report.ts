import type { DomInteractiveElement } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import type {
  PageSelectorReport,
  SelectorCandidate,
  SelectorReport,
  SelectorReportEntry,
} from './types.js'

const NON_ROLE_VALUES = new Set(['', 'generic', 'none'])

function isHashLikeClass(className: string): boolean {
  if (!/^[a-z0-9_-]{6,}$/i.test(className)) return false
  const segments = className.split(/[-_]/).filter((segment) => segment.length > 0)
  const allLettersOnly = segments.every((segment) => /^[a-z]+$/i.test(segment))
  return !allLettersOnly
}

function isCssStable(el: DomInteractiveElement): boolean {
  if (el.cssPath.includes(':nth-of-type')) return false
  if (el.classList.some(isHashLikeClass)) return false
  return true
}

function describeElement(el: DomInteractiveElement): string {
  if (el.accessibleName) return `${el.role} '${el.accessibleName}'`
  return el.tagName
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

function buildEntry(url: string, el: DomInteractiveElement, allElements: DomInteractiveElement[]): SelectorReportEntry {
  return {
    url,
    elementDescription: describeElement(el),
    candidates: buildCandidates(el, allElements),
  }
}

export function generateSelectorReport(pages: CrawledPage[]): SelectorReport {
  const reportPages: PageSelectorReport[] = pages.map((page) => ({
    url: page.url,
    entries: page.interactiveElements.map((el) => buildEntry(page.url, el, page.interactiveElements)),
  }))
  return { generatedAt: new Date().toISOString(), pages: reportPages }
}

export function renderSelectorReportMarkdown(report: SelectorReport): string {
  const lines: string[] = ['# Selector Stability Report', '', `Generated: ${report.generatedAt}`, '']
  for (const page of report.pages) {
    lines.push(
      `## ${page.url}`,
      '',
      '| Element | Strategy | Selector | Stable | Unique |',
      '| --- | --- | --- | --- | --- |',
    )
    for (const entry of page.entries) {
      for (const candidate of entry.candidates) {
        lines.push(
          `| ${entry.elementDescription} | ${candidate.strategy} | ${candidate.value} | ${candidate.stable ? 'Yes' : 'No'} | ${candidate.uniqueOnPage ? 'Yes' : 'No'} |`,
        )
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}
