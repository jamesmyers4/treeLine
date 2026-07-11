import type { DomInteractiveElement } from '@treeline/acquire'
import { computeSelectorCandidates } from '@treeline/core'
import type { CrawledPage } from './input.js'
import type { PageSelectorReport, SelectorCandidate, SelectorReport, SelectorReportEntry } from './types.js'
import { sanitizeMarkdownTableCell, sanitizeMarkdownText } from './markdown-safety.js'

function describeElement(el: DomInteractiveElement): string {
  if (el.accessibleName) return `${el.role} '${el.accessibleName}'`
  return el.tagName
}

function buildEntry(url: string, el: DomInteractiveElement, candidatesByElement: Map<DomInteractiveElement, SelectorCandidate[]>): SelectorReportEntry {
  return {
    url,
    elementDescription: describeElement(el),
    candidates: candidatesByElement.get(el)!,
  }
}

export function generateSelectorReport(pages: CrawledPage[]): SelectorReport {
  const reportPages: PageSelectorReport[] = pages.map((page) => {
    const candidatesByElement = computeSelectorCandidates(page.interactiveElements)
    return {
      url: page.url,
      entries: page.interactiveElements.map((el) => buildEntry(page.url, el, candidatesByElement)),
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
      '| Element | Strategy | Selector | Stable | Unique |',
      '| --- | --- | --- | --- | --- |',
    )
    for (const entry of page.entries) {
      for (const candidate of entry.candidates) {
        lines.push(
          `| ${sanitizeMarkdownTableCell(entry.elementDescription)} | ${candidate.strategy} | ${sanitizeMarkdownTableCell(candidate.value)} | ${candidate.stable ? 'Yes' : 'No'} | ${candidate.uniqueOnPage ? 'Yes' : 'No'} |`,
        )
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}
