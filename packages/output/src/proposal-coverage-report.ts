import type { StoredInterpretation } from '@treeline/core'
import type { CrawledPage } from './input.js'
import type { ContentEligibleWithoutProposalEntry, FormsWithoutProposalEntry, ProposalCoverageReport, ProposalEntry } from './types.js'
import { sanitizeMarkdownTableCell, sanitizeMarkdownText } from './markdown-safety.js'

const SCENARIO_MAX_LENGTH = 120

function truncateScenario(scenario: string): string {
  if (scenario.length <= SCENARIO_MAX_LENGTH) return scenario
  return `${scenario.slice(0, SCENARIO_MAX_LENGTH)}…`
}

export function generateProposalCoverageReport(pages: CrawledPage[], interpretations: StoredInterpretation[]): ProposalCoverageReport {
  const capturedPages = pages.filter((p) => p.title !== null && p.ariaSnapshot !== null && p.capturedAt !== null)
  const interpretationsByUrl = new Map(interpretations.map((interpretation) => [interpretation.url, interpretation]))
  const formFillProposals: ProposalEntry[] = []
  const contentPresenceProposals: ProposalEntry[] = []
  const formsWithoutProposal: FormsWithoutProposalEntry[] = []
  const contentEligibleWithoutProposal: ContentEligibleWithoutProposalEntry[] = []
  const noEligibleElements: string[] = []
  for (const page of capturedPages) {
    const proposedAssertion = interpretationsByUrl.get(page.url)?.proposedAssertion
    if (proposedAssertion?.kind === 'form-fill') {
      formFillProposals.push({ url: page.url, scenario: proposedAssertion.scenario })
      continue
    }
    if (proposedAssertion?.kind === 'content-presence') {
      contentPresenceProposals.push({ url: page.url, scenario: proposedAssertion.scenario })
      continue
    }
    if (page.forms.length > 0) {
      formsWithoutProposal.push({ url: page.url, formCount: page.forms.length })
      continue
    }
    if (page.interactiveElements.length > 0) {
      contentEligibleWithoutProposal.push({ url: page.url, interactiveElementCount: page.interactiveElements.length })
      continue
    }
    noEligibleElements.push(page.url)
  }
  return {
    generatedAt: new Date().toISOString(),
    formFillProposals,
    contentPresenceProposals,
    formsWithoutProposal,
    contentEligibleWithoutProposal,
    noEligibleElements,
  }
}

function renderProposalsSection(formFillProposals: ProposalEntry[], contentPresenceProposals: ProposalEntry[]): string[] {
  const lines: string[] = ['## Pages with a proposed assertion', '']
  if (formFillProposals.length === 0 && contentPresenceProposals.length === 0) {
    lines.push('None found.', '')
    return lines
  }
  lines.push('| URL | Kind | Scenario |', '| --- | --- | --- |')
  for (const entry of formFillProposals) {
    lines.push(`| ${sanitizeMarkdownTableCell(entry.url)} | Form Fill | ${sanitizeMarkdownTableCell(truncateScenario(entry.scenario))} |`)
  }
  for (const entry of contentPresenceProposals) {
    lines.push(`| ${sanitizeMarkdownTableCell(entry.url)} | Content Presence | ${sanitizeMarkdownTableCell(truncateScenario(entry.scenario))} |`)
  }
  lines.push('')
  return lines
}

function renderFormsWithoutProposalSection(gaps: FormsWithoutProposalEntry[]): string[] {
  const lines: string[] = [
    '## Forms without a proposal',
    '',
    'The model declined to propose a fill-and-submit scenario for these forms — expected for search/filter-only ' +
      'forms outside a genuine data-entry pattern, and a real gap worth a look otherwise.',
    '',
  ]
  if (gaps.length === 0) {
    lines.push('None found.', '')
    return lines
  }
  lines.push('| URL | Form Count |', '| --- | --- |')
  for (const gap of gaps) {
    lines.push(`| ${sanitizeMarkdownTableCell(gap.url)} | ${gap.formCount} |`)
  }
  lines.push('')
  return lines
}

function renderContentEligibleWithoutProposalSection(gaps: ContentEligibleWithoutProposalEntry[]): string[] {
  const lines: string[] = [
    '## Content-eligible pages without a proposal',
    '',
    "These pages have captured interactive elements but nothing the model judged as clear evidence of the page's purpose.",
    '',
  ]
  if (gaps.length === 0) {
    lines.push('None found.', '')
    return lines
  }
  lines.push('| URL | Interactive Elements |', '| --- | --- |')
  for (const gap of gaps) {
    lines.push(`| ${sanitizeMarkdownTableCell(gap.url)} | ${gap.interactiveElementCount} |`)
  }
  lines.push('')
  return lines
}

function renderNoEligibleElementsSection(urls: string[]): string[] {
  const lines: string[] = [
    '## Pages with no eligible elements',
    '',
    'Informational, not a gap — these pages have no form and no interactive elements at all, so this feature has ' +
      'nothing to work with regardless of page purpose.',
    '',
  ]
  if (urls.length === 0) {
    lines.push('None found.', '')
    return lines
  }
  for (const url of urls) lines.push(`- ${sanitizeMarkdownText(url)}`)
  lines.push('')
  return lines
}

export function renderProposalCoverageReportMarkdown(report: ProposalCoverageReport): string {
  const lines: string[] = [
    '# Proposal Coverage Report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `${report.formFillProposals.length + report.contentPresenceProposals.length + report.formsWithoutProposal.length + report.contentEligibleWithoutProposal.length + report.noEligibleElements.length} pages total, ` +
      `${report.formFillProposals.length} form-fill proposals, ${report.contentPresenceProposals.length} content-presence proposals, ` +
      `${report.formsWithoutProposal.length} forms without a proposal, ${report.contentEligibleWithoutProposal.length} content-eligible pages without a proposal, ` +
      `${report.noEligibleElements.length} pages with no eligible elements`,
    '',
  ]
  lines.push(...renderProposalsSection(report.formFillProposals, report.contentPresenceProposals))
  lines.push(...renderFormsWithoutProposalSection(report.formsWithoutProposal))
  lines.push(...renderContentEligibleWithoutProposalSection(report.contentEligibleWithoutProposal))
  lines.push(...renderNoEligibleElementsSection(report.noEligibleElements))
  return lines.join('\n')
}
