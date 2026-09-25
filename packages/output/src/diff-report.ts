import type { CaptureFailure, CrawlDiff, RemovedElement, SelectorCandidateChange, TimingChange, VisualChange } from '@treeline/core'
import { urlHash } from '@treeline/core'
import { sanitizeMarkdownTableCell, sanitizeMarkdownText } from './markdown-safety.js'

export type SelectorChangeClassification = 'regression' | 'improvement' | 'other'

export function classifyChange(change: SelectorCandidateChange): SelectorChangeClassification {
  const wasSafe = change.baselineStable && change.baselineUniqueOnPage
  const isSafe = change.currentStable && change.currentUniqueOnPage
  if (wasSafe && !isSafe) return 'regression'
  if (!wasSafe && isSafe) return 'improvement'
  return 'other'
}

export function classifyRemovedElement(removed: RemovedElement): SelectorChangeClassification {
  return removed.locatedByRoleInBaselinePom ? 'regression' : 'other'
}

function describeChange(change: SelectorCandidateChange | RemovedElement): string {
  const suffix = change.occurrenceIndex > 0 ? ` [${change.occurrenceIndex}]` : ''
  return `${sanitizeMarkdownTableCell(change.role)} '${sanitizeMarkdownTableCell(change.accessibleName)}'${suffix}`
}

function formatFlags(stable: boolean, uniqueOnPage: boolean): string {
  return `stable=${stable ? 'yes' : 'no'}, unique=${uniqueOnPage ? 'yes' : 'no'}`
}

function renderChangesTable(changes: SelectorCandidateChange[], emptyMessage: string): string[] {
  if (changes.length === 0) return [emptyMessage, '']
  const lines: string[] = ['| URL | Element | Before | After |', '| --- | --- | --- | --- |']
  for (const change of changes) {
    lines.push(
      `| ${sanitizeMarkdownTableCell(change.url)} | ${describeChange(change)} | ${formatFlags(change.baselineStable, change.baselineUniqueOnPage)} | ${formatFlags(change.currentStable, change.currentUniqueOnPage)} |`,
    )
  }
  lines.push('')
  return lines
}

function renderUrlList(urls: string[], emptyMessage: string): string[] {
  if (urls.length === 0) return [emptyMessage, '']
  const lines = urls.map((url) => `- ${sanitizeMarkdownText(url)}`)
  lines.push('')
  return lines
}

function renderTitleChangesTable(titleChanges: CrawlDiff['titleChanges']): string[] {
  if (titleChanges.length === 0) return ['No title changes found.', '']
  const lines: string[] = ['| URL | Baseline Title | Current Title |', '| --- | --- | --- |']
  for (const change of titleChanges) {
    lines.push(`| ${sanitizeMarkdownTableCell(change.url)} | ${sanitizeMarkdownTableCell(change.baselineTitle)} | ${sanitizeMarkdownTableCell(change.currentTitle)} |`)
  }
  lines.push('')
  return lines
}

function renderSelectorCandidateSection(selectorCandidateChanges: SelectorCandidateChange[]): string[] {
  const lines: string[] = ['## Selector Candidate Changes', '']

  if (selectorCandidateChanges.length === 0) {
    lines.push('No selector candidate changes found.', '')
    return lines
  }

  const regressions = selectorCandidateChanges.filter((change) => classifyChange(change) === 'regression')
  const improvements = selectorCandidateChanges.filter((change) => classifyChange(change) === 'improvement')
  const otherChanges = selectorCandidateChanges.filter((change) => classifyChange(change) === 'other')

  lines.push(
    '### Regressions',
    '',
    ...renderChangesTable(regressions, 'No regressions found.'),
    '### Improvements',
    '',
    ...renderChangesTable(improvements, 'No improvements found.'),
    '### Other',
    '',
    ...renderChangesTable(otherChanges, 'No other selector changes found.'),
  )

  return lines
}

function renderRemovedElementsTable(removed: RemovedElement[], emptyMessage: string): string[] {
  if (removed.length === 0) return [emptyMessage, '']
  const lines: string[] = ['| URL | Element |', '| --- | --- |']
  for (const element of removed) {
    lines.push(`| ${sanitizeMarkdownTableCell(element.url)} | ${describeChange(element)} |`)
  }
  lines.push('')
  return lines
}

function renderRemovedElementsSection(removedElements: RemovedElement[]): string[] {
  const lines: string[] = [
    '## Removed or Renamed Elements',
    '',
    'Baseline elements with no current element of the same role and accessible name at the same occurrence index. ' +
      'A renamed element shows up here under its old name.',
    '',
  ]
  if (removedElements.length === 0) {
    lines.push('No removed or renamed elements found.', '')
    return lines
  }
  const regressions = removedElements.filter((removed) => classifyRemovedElement(removed) === 'regression')
  const other = removedElements.filter((removed) => classifyRemovedElement(removed) === 'other')
  lines.push(
    '### Regressions',
    '',
    "The baseline's generated POM located these by role and accessible name, so that locator no longer matches — these count toward `--fail-on-regression`.",
    '',
    ...renderRemovedElementsTable(regressions, 'No removed elements were located by role in the baseline POM.'),
    '### Other',
    '',
    'Not located by role+name in the baseline POM (a repeating-row member, a testid/CSS-located field, or an element with no stable selector) — informational only.',
    '',
    ...renderRemovedElementsTable(other, 'No other removed elements.'),
  )
  return lines
}

function renderCaptureFailuresSection(captureFailures: CaptureFailure[]): string[] {
  const lines: string[] = [
    '## Capture Failures',
    '',
    "Pages present in both crawls whose capture failed in one of them. They're left out of the title, selector, visual, and timing comparisons, since there's nothing to compare against.",
    '',
  ]
  if (captureFailures.length === 0) {
    lines.push('No capture failures in either crawl.', '')
    return lines
  }
  lines.push('| URL | Failed In | Status |', '| --- | --- | --- |')
  for (const failure of captureFailures) {
    lines.push(`| ${sanitizeMarkdownTableCell(failure.url)} | ${failure.side} | ${sanitizeMarkdownTableCell(failure.status)} |`)
  }
  lines.push('')
  return lines
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function renderVisualChangedTable(changed: VisualChange[]): string[] {
  if (changed.length === 0) return ['No pages with a visual change.', '']
  const lines: string[] = ['| URL | Diff % | Image |', '| --- | --- | --- |']
  for (const change of changed) {
    lines.push(`| ${sanitizeMarkdownTableCell(change.url)} | ${round1(change.diffPixelPercent!)}% | ![Visual diff](visual-diffs/${urlHash(change.url)}.png) |`)
  }
  lines.push('')
  return lines
}

function renderVisualUncomparableList(uncomparable: VisualChange[]): string[] {
  if (uncomparable.length === 0) return ['No pages failed comparison.', '']
  const lines = uncomparable.map((change) => `- ${sanitizeMarkdownText(change.url)} (${change.status})`)
  lines.push('')
  return lines
}

function renderVisualChangesSection(visualChanges: VisualChange[]): string[] {
  const changed = visualChanges.filter((change) => change.status === 'changed')
  const uncomparable = visualChanges.filter((change) => change.status !== 'changed' && change.status !== 'unchanged')

  const lines: string[] = ['## Visual Changes', '']

  if (changed.length === 0 && uncomparable.length === 0) {
    lines.push('No visual changes found.', '')
    return lines
  }

  lines.push(
    '### Changed',
    '',
    ...renderVisualChangedTable(changed),
    '### Could Not Compare',
    '',
    ...renderVisualUncomparableList(uncomparable),
  )

  return lines
}

export type TimingChangeClassification = 'regression' | 'improvement'

export function classifyTimingChange(change: TimingChange): TimingChangeClassification {
  return change.percentChange > 0 ? 'regression' : 'improvement'
}

function renderTimingChangesTable(changes: TimingChange[], emptyMessage: string): string[] {
  if (changes.length === 0) return [emptyMessage, '']
  const lines: string[] = ['| URL | Before (ms) | After (ms) | % Change |', '| --- | --- | --- | --- |']
  for (const change of changes) {
    const sign = change.percentChange > 0 ? '+' : ''
    lines.push(
      `| ${sanitizeMarkdownTableCell(change.url)} | ${change.baselinePageLoadMs} | ${change.currentPageLoadMs} | ${sign}${round1(change.percentChange)}% |`,
    )
  }
  lines.push('')
  return lines
}

function renderTimingChangesSection(timingChanges: TimingChange[]): string[] {
  const lines: string[] = ['## Page Load Timing Changes', '']

  if (timingChanges.length === 0) {
    lines.push('No timing regressions found.', '')
    return lines
  }

  const regressions = timingChanges.filter((change) => classifyTimingChange(change) === 'regression')
  const improvements = timingChanges.filter((change) => classifyTimingChange(change) === 'improvement')

  lines.push(
    '### Regressions',
    '',
    ...renderTimingChangesTable(regressions, 'No timing regressions found.'),
    '### Improvements',
    '',
    ...renderTimingChangesTable(improvements, 'No timing improvements found.'),
  )

  return lines
}

export function renderDiffReportMarkdown(diff: CrawlDiff): string {
  const regressions = diff.selectorCandidateChanges.filter((change) => classifyChange(change) === 'regression')
  const improvements = diff.selectorCandidateChanges.filter((change) => classifyChange(change) === 'improvement')
  const otherChanges = diff.selectorCandidateChanges.filter((change) => classifyChange(change) === 'other')
  const removedRegressions = diff.removedElements.filter((removed) => classifyRemovedElement(removed) === 'regression')
  const visualChangedCount = diff.visualChanges.filter((change) => change.status === 'changed').length
  const timingRegressions = diff.timingChanges.filter((change) => classifyTimingChange(change) === 'regression')
  const timingImprovements = diff.timingChanges.filter((change) => classifyTimingChange(change) === 'improvement')

  const lines: string[] = [
    '# Crawl Diff Report',
    '',
    `Baseline: ${diff.baselineDbPath}`,
    `Current: ${diff.currentDbPath}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `${diff.pagesAdded.length} pages added, ${diff.pagesRemoved.length} pages removed, ${diff.captureFailures.length} capture failures, ${diff.titleChanges.length} title changes, ${regressions.length} selector regressions, ${improvements.length} selector improvements, ${otherChanges.length} other selector changes, ${diff.removedElements.length} removed/renamed elements (${removedRegressions.length} regressions), ${visualChangedCount} visual changes, ${timingRegressions.length} timing regressions, ${timingImprovements.length} timing improvements`,
    '',
    '## Pages Added',
    '',
    ...renderUrlList(diff.pagesAdded, 'No pages added.'),
    '## Pages Removed',
    '',
    ...renderUrlList(diff.pagesRemoved, 'No pages removed.'),
    ...renderCaptureFailuresSection(diff.captureFailures),
    '## Title Changes',
    '',
    ...renderTitleChangesTable(diff.titleChanges),
    ...renderSelectorCandidateSection(diff.selectorCandidateChanges),
    ...renderRemovedElementsSection(diff.removedElements),
    ...renderVisualChangesSection(diff.visualChanges),
    ...renderTimingChangesSection(diff.timingChanges),
  ]

  return lines.join('\n')
}
