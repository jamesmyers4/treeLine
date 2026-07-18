import type { RequestBodyContentTypeCategory } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import type { ApiTestScaffoldEntry, ApiTestScaffoldReport, ApiTestScaffoldRequestFields, ApiTestScaffoldResponseSchema } from './types.js'
import { isApiSurfaceCandidate } from './flow-map.js'
import { sanitizeMarkdownText } from './markdown-safety.js'

export interface ApiTestScaffoldConfig {
  captureRequestBodies: boolean
  captureResponseBodies: boolean
}

const NOT_CAPTURED_REQUEST_NOTE = 'not captured (`--capture-request-bodies` was off for this crawl)'
const NOT_APPLICABLE_REQUEST_MULTIPART_NOTE = 'not applicable (multipart/form-data — request body field names are not extracted for this content type)'
const NOT_APPLICABLE_REQUEST_SIZE_CAP_NOTE = 'not applicable (the request body exceeds `--max-request-body-bytes` for this crawl)'
const NOT_APPLICABLE_REQUEST_UNSUPPORTED_NOTE = 'not applicable (a content type outside JSON/form-urlencoded)'
const NOT_APPLICABLE_REQUEST_NO_BODY_NOTE = 'not applicable (no request body was sent for this request)'
const NOT_APPLICABLE_REQUEST_UNPARSEABLE_NOTE =
  'not applicable (the content type was recognized, but the body could not be parsed as expected — e.g. malformed JSON, or a non-object top-level JSON value)'
const NOT_CAPTURED_RESPONSE_NOTE = 'not captured (`--capture-response-bodies` was off for this crawl)'
const NOT_APPLICABLE_RESPONSE_NOTE =
  'not applicable — no schema could be inferred for this endpoint (e.g. a non-JSON response, an oversized body, or a non-object top-level JSON value)'

// Precedence for a flag-on-but-null request body, per API-CONTENT-TYPE-BUILDOUT.md decision #5:
// the two signals are orthogonal (a json/form-urlencoded body can be null purely from the size
// cap), so multipart is checked first, then the size cap, then the remaining unsupported/
// unparseable cases — never inferred from either signal alone.
function notApplicableRequestNote(
  category: RequestBodyContentTypeCategory | null,
  exceededSizeCap: boolean,
): string {
  if (category === 'multipart') return NOT_APPLICABLE_REQUEST_MULTIPART_NOTE
  if (exceededSizeCap) return NOT_APPLICABLE_REQUEST_SIZE_CAP_NOTE
  if (category === 'other') return NOT_APPLICABLE_REQUEST_UNSUPPORTED_NOTE
  if (category === null) return NOT_APPLICABLE_REQUEST_NO_BODY_NOTE
  return NOT_APPLICABLE_REQUEST_UNPARSEABLE_NOTE
}

function buildRequestFields(
  requestBody: string[] | null,
  captureRequestBodies: boolean,
  contentTypeCategory: RequestBodyContentTypeCategory | null,
  exceededSizeCap: boolean,
): ApiTestScaffoldRequestFields {
  if (!captureRequestBodies) return { status: 'not-captured', fields: [], note: NOT_CAPTURED_REQUEST_NOTE }
  if (requestBody === null) return { status: 'not-applicable', fields: [], note: notApplicableRequestNote(contentTypeCategory, exceededSizeCap) }
  return { status: 'captured', fields: requestBody, note: null }
}

function buildResponseSchema(
  responseBodySchema: Record<string, string> | null,
  captureResponseBodies: boolean,
): ApiTestScaffoldResponseSchema {
  if (!captureResponseBodies) return { status: 'not-captured', schema: null, note: NOT_CAPTURED_RESPONSE_NOTE }
  if (responseBodySchema === null) return { status: 'not-applicable', schema: null, note: NOT_APPLICABLE_RESPONSE_NOTE }
  return { status: 'captured', schema: responseBodySchema, note: null }
}

function endpointPath(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url
  }
}

interface AggregatedEntry {
  method: string
  url: string
  queryParams: Record<string, string>
  requiresAuth: boolean
  requestBody: string[] | null
  requestBodyContentTypeCategory: RequestBodyContentTypeCategory | null
  requestBodyExceededSizeCap: boolean
  responseBodySchema: Record<string, string> | null
}

export function buildApiTestScaffoldEntries(pages: CrawledPage[], config: ApiTestScaffoldConfig): ApiTestScaffoldEntry[] {
  const byKey = new Map<string, AggregatedEntry>()
  for (const page of pages) {
    for (const entry of page.networkLog) {
      if (!isApiSurfaceCandidate(entry)) continue
      const key = `${entry.method} ${entry.url}`
      const existing = byKey.get(key)
      if (existing) {
        if (existing.requestBody === null && entry.requestBody !== null) existing.requestBody = entry.requestBody
        if (existing.requestBodyContentTypeCategory === null && entry.requestBodyContentTypeCategory !== null) {
          existing.requestBodyContentTypeCategory = entry.requestBodyContentTypeCategory
        }
        if (!existing.requestBodyExceededSizeCap && entry.requestBodyExceededSizeCap) {
          existing.requestBodyExceededSizeCap = true
        }
        if (existing.responseBodySchema === null && entry.responseBodySchema !== null) {
          existing.responseBodySchema = entry.responseBodySchema
        }
      } else {
        byKey.set(key, {
          method: entry.method,
          url: entry.url,
          queryParams: entry.queryParams,
          requiresAuth: entry.requiresAuth,
          requestBody: entry.requestBody,
          requestBodyContentTypeCategory: entry.requestBodyContentTypeCategory,
          requestBodyExceededSizeCap: entry.requestBodyExceededSizeCap,
          responseBodySchema: entry.responseBodySchema,
        })
      }
    }
  }
  return Array.from(byKey.values()).map((entry) => {
    const requestFields = buildRequestFields(
      entry.requestBody,
      config.captureRequestBodies,
      entry.requestBodyContentTypeCategory,
      entry.requestBodyExceededSizeCap,
    )
    const responseSchema = buildResponseSchema(entry.responseBodySchema, config.captureResponseBodies)
    const hints = new Set<string>()
    if (requestFields.status === 'captured') {
      for (const field of requestFields.fields) hints.add(field)
    }
    if (responseSchema.status === 'captured' && responseSchema.schema !== null) {
      for (const field of Object.keys(responseSchema.schema)) hints.add(field)
    }
    return {
      method: entry.method,
      endpoint: endpointPath(entry.url),
      queryParams: entry.queryParams,
      requiresAuth: entry.requiresAuth,
      requestFields,
      responseSchema,
      schemaHints: Array.from(hints).sort(),
    }
  })
}

export function generateApiTestScaffold(pages: CrawledPage[], config: ApiTestScaffoldConfig): ApiTestScaffoldReport {
  const capturedPages = pages.filter((p) => p.title !== null && p.ariaSnapshot !== null && p.capturedAt !== null)
  return {
    generatedAt: new Date().toISOString(),
    captureRequestBodies: config.captureRequestBodies,
    captureResponseBodies: config.captureResponseBodies,
    entries: buildApiTestScaffoldEntries(capturedPages, config),
  }
}

function renderQueryParams(params: Record<string, string>): string {
  const keys = Object.keys(params)
  if (keys.length === 0) return '(none)'
  return keys.map((key) => sanitizeMarkdownText(`${key}=${params[key]}`)).join(', ')
}

function renderRequestFields(requestFields: ApiTestScaffoldRequestFields): string[] {
  if (requestFields.status !== 'captured') return [`- **Request fields:** ${requestFields.note}`]
  if (requestFields.fields.length === 0) return ['- **Request fields:** (none captured for this endpoint)']
  return [`- **Request fields:** ${requestFields.fields.map(sanitizeMarkdownText).join(', ')}`]
}

function renderResponseSchema(responseSchema: ApiTestScaffoldResponseSchema): string[] {
  if (responseSchema.status !== 'captured' || responseSchema.schema === null) {
    return [`- **Response schema:** ${responseSchema.note}`]
  }
  const entries = Object.entries(responseSchema.schema)
  if (entries.length === 0) return ['- **Response schema:** (empty object)']
  const lines = ['- **Response schema:**']
  for (const [field, type] of entries) {
    lines.push(`  - \`${sanitizeMarkdownText(field)}\`: ${sanitizeMarkdownText(type)}`)
  }
  return lines
}

function renderEndpointSection(entry: ApiTestScaffoldEntry): string[] {
  const lines: string[] = [`## ${sanitizeMarkdownText(entry.method)} ${sanitizeMarkdownText(entry.endpoint)}`, '']
  lines.push(`- **Query params:** ${renderQueryParams(entry.queryParams)}`)
  lines.push(`- **Requires auth:** ${entry.requiresAuth ? 'Yes' : 'No'}`)
  lines.push(...renderRequestFields(entry.requestFields))
  lines.push(...renderResponseSchema(entry.responseSchema))
  if (entry.schemaHints.length > 0) {
    lines.push(`- **Possible schema hints (inferred, unverified):** ${entry.schemaHints.map(sanitizeMarkdownText).join(', ')}`)
  }
  lines.push('')
  return lines
}

export function renderApiTestScaffoldMarkdown(report: ApiTestScaffoldReport): string {
  const lines: string[] = [
    '# API Test Scaffold',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `${report.entries.length} distinct endpoint${report.entries.length === 1 ? '' : 's'} observed.`,
    '',
  ]
  if (!report.captureRequestBodies) {
    lines.push(
      'Request body/field capture was off for this crawl (`--capture-request-bodies` not set) — request fields are labeled "not captured" below, not left blank.',
      '',
    )
  }
  if (!report.captureResponseBodies) {
    lines.push(
      'Response schema capture was off for this crawl (`--capture-response-bodies` not set) — response schemas are labeled "not captured" below, not left blank.',
      '',
    )
  }
  if (report.entries.length === 0) {
    lines.push('No API endpoints were observed.', '')
    return lines.join('\n')
  }
  for (const entry of report.entries) {
    lines.push(...renderEndpointSection(entry))
  }
  return lines.join('\n')
}
