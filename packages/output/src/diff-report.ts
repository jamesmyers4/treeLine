import type { CrawlDiff, SelectorCandidateChange } from '@treeline/core'

export type SelectorChangeClassification = 'regression' | 'improvement' | 'other'

export function classifyChange(change: SelectorCandidateChange): SelectorChangeClassification {
  const wasSafe = change.baselineStable && change.baselineUniqueOnPage
  const isSafe = change.currentStable && change.currentUniqueOnPage
  if (wasSafe && !isSafe) return 'regression'
  if (!wasSafe && isSafe) return 'improvement'
  return 'other'
}

function describeChange(change: SelectorCandidateChange): string {
  const suffix = change.occurrenceIndex > 0 ? ` [${change.occurrenceIndex}]` : ''
  return `${change.role} '${change.accessibleName}'${suffix}`
}

function formatFlags(stable: boolean, uniqueOnPage: boolean): string {
  return `stable=${stable ? 'yes' : 'no'}, unique=${uniqueOnPage ? 'yes' : 'no'}`
}

function renderChangesTable(changes: SelectorCandidateChange[], emptyMessage: string): string[] {
  if (changes.length === 0) return [emptyMessage, '']
  const lines: string[] = ['| URL | Element | Before | After |', '| --- | --- | --- | --- |']
  for (const change of changes) {
    lines.push(
      `| ${change.url} | ${describeChange(change)} | ${formatFlags(change.baselineStable, change.baselineUniqueOnPage)} | ${formatFlags(change.currentStable, change.currentUniqueOnPage)} |`,
    )
  }
  lines.push('')
  return lines
}

function renderUrlList(urls: string[], emptyMessage: string): string[] {
  if (urls.length === 0) return [emptyMessage, '']
  const lines = urls.map((url) => `- ${url}`)
  lines.push('')
  return lines
}

function renderTitleChangesTable(titleChanges: CrawlDiff['titleChanges']): string[] {
  if (titleChanges.length === 0) return ['No title changes found.', '']
  const lines: string[] = ['| URL | Baseline Title | Current Title |', '| --- | --- | --- |']
  for (const change of titleChanges) {
    lines.push(`| ${change.url} | ${change.baselineTitle} | ${change.currentTitle} |`)
  }
  lines.push('')
  return lines
}

export function renderDiffReportMarkdown(diff: CrawlDiff): string {
  const regressions = diff.selectorCandidateChanges.filter((change) => classifyChange(change) === 'regression')
  const improvements = diff.selectorCandidateChanges.filter((change) => classifyChange(change) === 'improvement')
  const otherChanges = diff.selectorCandidateChanges.filter((change) => classifyChange(change) === 'other')

  const lines: string[] = [
    '# Crawl Diff Report',
    '',
    `Baseline: ${diff.baselineDbPath}`,
    `Current: ${diff.currentDbPath}`,
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `${diff.pagesAdded.length} pages added, ${diff.pagesRemoved.length} pages removed, ${diff.titleChanges.length} title changes, ${regressions.length} selector regressions, ${improvements.length} selector improvements, ${otherChanges.length} other selector changes`,
    '',
    '## Pages Added',
    '',
    ...renderUrlList(diff.pagesAdded, 'No pages added.'),
    '## Pages Removed',
    '',
    ...renderUrlList(diff.pagesRemoved, 'No pages removed.'),
    '## Title Changes',
    '',
    ...renderTitleChangesTable(diff.titleChanges),
    '## Selector Candidate Changes',
    '',
  ]

  if (diff.selectorCandidateChanges.length === 0) {
    lines.push('No selector candidate changes found.', '')
    return lines.join('\n')
  }

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

  return lines.join('\n')
}
