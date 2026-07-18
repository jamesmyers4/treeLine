import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sanitizeMarkdownTableCell } from '@treeline/output'
import type { NavMapAuditResult } from './types.js'

const STATUS_ORDER: Record<NavMapAuditResult['status'], number> = { mismatch: 0, error: 1, skipped: 2, match: 3 }

function renderRow(r: NavMapAuditResult): string {
  const label = sanitizeMarkdownTableCell(r.label)
  const expected = sanitizeMarkdownTableCell(r.expectedUrl)
  const observed = sanitizeMarkdownTableCell(r.observedUrl ?? (r.errorMessage ? `error: ${r.errorMessage}` : '—'))
  const status = r.status
  return `| ${label} | ${expected} | ${observed} | ${status} |`
}

export async function writeVerifyReport(outputDir: string, results: NavMapAuditResult[], findings?: string[]): Promise<string> {
  const sorted = [...results].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])
  const matches = results.filter(r => r.status === 'match').length
  const mismatches = results.filter(r => r.status === 'mismatch').length
  const skipped = results.filter(r => r.status === 'skipped')
  const errors = results.filter(r => r.status === 'error')
  const lines: string[] = []
  lines.push('# Nav-Map Verification Report')
  lines.push('')
  lines.push(`${results.length} entries checked: ${matches} match, ${mismatches} mismatch, ${skipped.length} skipped, ${errors.length} error.`)
  lines.push('')
  lines.push('Mismatches and errors are sorted first — the same "regressions surfaced first" convention `treeline diff` already uses.')
  lines.push('')
  lines.push('| Label | Expected URL | Observed URL | Status |')
  lines.push('| --- | --- | --- | --- |')
  for (const r of sorted.filter(r => r.status !== 'skipped')) {
    lines.push(renderRow(r))
    if (r.screenshotPath) {
      lines.push('')
      lines.push(`Screenshot: ${r.screenshotPath}`)
      lines.push('')
    }
  }
  lines.push('')
  if (skipped.length > 0) {
    lines.push('## Skipped (precondition required)')
    lines.push('')
    lines.push('These entries were not clicked through automatically because the app requires extra state first (a selected patient, an existing record, etc.). See prose notes below for any finding confirmed manually.')
    lines.push('')
    lines.push('| Label | Expected URL | Precondition |')
    lines.push('| --- | --- | --- |')
    for (const r of skipped) {
      lines.push(`| ${sanitizeMarkdownTableCell(r.label)} | ${sanitizeMarkdownTableCell(r.expectedUrl)} | ${sanitizeMarkdownTableCell(r.precondition ?? '')} |`)
    }
    lines.push('')
  }
  if (findings && findings.length > 0) {
    lines.push('## Findings')
    lines.push('')
    for (const finding of findings) {
      lines.push(finding)
      lines.push('')
    }
  }
  const reportPath = join(outputDir, 'verify-report.md')
  await writeFile(reportPath, lines.join('\n'))
  return reportPath
}
