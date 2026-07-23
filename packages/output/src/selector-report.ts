import type { DomInteractiveElement } from '@treeline/acquire'
import { computeSelectorCandidates } from '@treeline/core'
import type { CrawledPage } from './input.js'
import { detectRepeatingRegions } from './repeating-regions.js'
import type { PageSelectorReport, SelectorCandidate, SelectorReport, SelectorReportEntry } from './types.js'
import { sanitizeMarkdownTableCell, sanitizeMarkdownText } from './markdown-safety.js'

function describeElement(el: DomInteractiveElement): string {
  if (el.accessibleName) return `${el.role} '${el.accessibleName}'`
  return el.tagName
}

function buildEntry(
  url: string,
  el: DomInteractiveElement,
  candidatesByElement: Map<DomInteractiveElement, SelectorCandidate[]>,
  instanceCount: number,
): SelectorReportEntry {
  return {
    url,
    elementDescription: describeElement(el),
    candidates: candidatesByElement.get(el)!,
    instanceCount,
  }
}

function buildPageEntries(page: CrawledPage, candidatesByElement: Map<DomInteractiveElement, SelectorCandidate[]>): SelectorReportEntry[] {
  const groups = detectRepeatingRegions(page.interactiveElements)
  const instanceCountByRepresentative = new Map<DomInteractiveElement, number>()
  const consumed = new Set<DomInteractiveElement>()
  for (const group of groups) {
    const representative = group.members[0]!
    instanceCountByRepresentative.set(representative, group.instanceCount)
    for (const member of group.members) consumed.add(member)
  }
  const entries: SelectorReportEntry[] = []
  for (const el of page.interactiveElements) {
    const representativeInstanceCount = instanceCountByRepresentative.get(el)
    if (consumed.has(el) && representativeInstanceCount === undefined) continue
    entries.push(buildEntry(page.url, el, candidatesByElement, representativeInstanceCount ?? 1))
  }
  return entries
}

export function generateSelectorReport(pages: CrawledPage[]): SelectorReport {
  const reportPages: PageSelectorReport[] = pages.map((page) => {
    const candidatesByElement = computeSelectorCandidates(page.interactiveElements)
    return {
      url: page.url,
      entries: buildPageEntries(page, candidatesByElement),
    }
  })
  return { generatedAt: new Date().toISOString(), pages: reportPages }
}

export function renderSelectorReportMarkdown(report: SelectorReport): string {
  const lines: string[] = ['# Selector Stability Report', '', `Generated: ${report.generatedAt}`, '']
  for (const page of report.pages) {
    lines.push(
      `## ${sanitizeMarkdownText(page.url)}`,
      '',
      '| Element | Instances | Strategy | Selector | Stable | Unique |',
      '| --- | --- | --- | --- | --- | --- |',
    )
    for (const entry of page.entries) {
      const instancesCell = entry.instanceCount > 1 ? `${entry.instanceCount} (1 shown)` : '1'
      for (const candidate of entry.candidates) {
        lines.push(
          `| ${sanitizeMarkdownTableCell(entry.elementDescription)} | ${instancesCell} | ${candidate.strategy} | ${sanitizeMarkdownTableCell(candidate.value)} | ${candidate.stable ? 'Yes' : 'No'} | ${candidate.uniqueOnPage ? 'Yes' : 'No'} |`,
        )
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}
