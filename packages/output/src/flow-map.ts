import type { CapturedForm, CapturedFormField, NetworkEntry } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import type { ApiSurfaceEntry, FlowMap, PageFormsEntry } from './types.js'

const API_SURFACE_RESOURCE_TYPES = new Set(['xhr', 'fetch', 'websocket', 'eventsource'])

export function isApiSurfaceCandidate(entry: NetworkEntry): boolean {
  return API_SURFACE_RESOURCE_TYPES.has(entry.resourceType) || entry.method !== 'GET'
}

function buildFormsEntries(pages: CrawledPage[]): PageFormsEntry[] {
  return pages.filter((page) => page.forms.length > 0).map((page) => ({ url: page.url, forms: page.forms }))
}

function buildApiSurface(pages: CrawledPage[]): ApiSurfaceEntry[] {
  const byKey = new Map<string, { method: string; url: string; occurrenceCount: number; pages: string[] }>()
  for (const page of pages) {
    for (const entry of page.networkLog) {
      if (!isApiSurfaceCandidate(entry)) continue
      const key = `${entry.method} ${entry.url}`
      const existing = byKey.get(key)
      if (existing) {
        existing.occurrenceCount += 1
        if (!existing.pages.includes(page.url)) existing.pages.push(page.url)
      } else {
        byKey.set(key, { method: entry.method, url: entry.url, occurrenceCount: 1, pages: [page.url] })
      }
    }
  }
  return Array.from(byKey.values()).map((v) => ({
    method: v.method,
    url: v.url,
    occurrenceCount: v.occurrenceCount,
    samplePages: v.pages.slice(0, 3),
    totalPageCount: v.pages.length,
  }))
}

export function generateFlowMap(pages: CrawledPage[]): FlowMap {
  const capturedPages = pages.filter((p) => p.title !== null && p.ariaSnapshot !== null && p.capturedAt !== null)
  const forms = buildFormsEntries(capturedPages)
  const apiSurface = buildApiSurface(capturedPages)
  const totalForms = forms.reduce((sum, entry) => sum + entry.forms.length, 0)
  return {
    generatedAt: new Date().toISOString(),
    pagesWithForms: forms.length,
    totalForms,
    distinctApiEndpoints: apiSurface.length,
    forms,
    apiSurface,
  }
}

function renderFormFieldsTable(fields: CapturedFormField[]): string[] {
  const lines: string[] = ['| Role | Accessible Name | Input Type | Required | Pattern |', '| --- | --- | --- | --- | --- |']
  for (const field of fields) {
    lines.push(
      `| ${field.role} | ${field.accessibleName} | ${field.inputType ?? '—'} | ${field.required ? 'Yes' : 'No'} | ${field.pattern ?? '—'} |`,
    )
  }
  lines.push('')
  return lines
}

function renderForm(form: CapturedForm): string[] {
  const lines: string[] = [`Action: ${form.action || '(none)'}`, `Method: ${form.method.toUpperCase()}`, '']
  lines.push(...renderFormFieldsTable(form.fields))
  return lines
}

function renderPageFormsSection(entry: PageFormsEntry): string[] {
  const lines: string[] = [`## ${entry.url}`, '']
  for (const form of entry.forms) {
    lines.push(...renderForm(form))
  }
  return lines
}

function renderApiSurfaceTable(entries: ApiSurfaceEntry[]): string[] {
  if (entries.length === 0) return ['No API surface activity was found.', '']
  const lines: string[] = ['| Method | URL | Occurrences | Sample Pages |', '| --- | --- | --- | --- |']
  for (const entry of entries) {
    const remaining = entry.totalPageCount - entry.samplePages.length
    const more = remaining > 0 ? ` (+${remaining} more)` : ''
    lines.push(`| ${entry.method} | ${entry.url} | ${entry.occurrenceCount} | ${entry.samplePages.join(', ')}${more} |`)
  }
  lines.push('')
  return lines
}

export function renderFlowMapMarkdown(flowMap: FlowMap): string {
  const lines: string[] = [
    '# Flow Map',
    '',
    `Generated: ${flowMap.generatedAt}`,
    '',
    `${flowMap.pagesWithForms} pages with forms, ${flowMap.totalForms} total forms, ${flowMap.distinctApiEndpoints} distinct API endpoints observed`,
    '',
    '## Forms',
    '',
  ]
  if (flowMap.forms.length === 0) {
    lines.push('No forms were found.', '')
  } else {
    for (const entry of flowMap.forms) {
      lines.push(...renderPageFormsSection(entry))
    }
  }
  lines.push('## API Surface', '')
  lines.push(...renderApiSurfaceTable(flowMap.apiSurface))
  return lines.join('\n')
}
