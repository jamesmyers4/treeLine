import { describe, it, expect } from 'vitest'
import type { NetworkEntry } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import { buildApiTestScaffoldEntries, generateApiTestScaffold, renderApiTestScaffoldMarkdown } from './api-test-scaffold.js'

function makeNetworkEntry(overrides: Partial<NetworkEntry>): NetworkEntry {
  return {
    url: 'https://example.com/api/data',
    method: 'GET',
    status: 200,
    resourceType: 'xhr',
    durationMs: 50,
    responseBodySample: null,
    responseBodySchema: null,
    requestBody: null,
    requestBodyContentTypeCategory: null,
    requestBodyExceededSizeCap: false,
    requestHeaderNames: [],
    queryParams: {},
    requiresAuth: false,
    ...overrides,
  }
}

function makePage(overrides: Partial<CrawledPage>): CrawledPage {
  return {
    url: 'https://example.com',
    title: 'Test Page',
    ariaSnapshot: '',
    links: [],
    networkLog: [],
    screenshotPath: null,
    capturedAt: new Date().toISOString(),
    pageLoadMs: null,
    interactiveElements: [],
    axeViolations: [],
    axeIncomplete: [],
    forms: [],
    colorPalette: [],
    assertableAttributes: [],
    status: 'ok',
    ...overrides,
  }
}

describe('buildApiTestScaffoldEntries', () => {
  it('excludes GET requests to static assets, same filter as the flow map', () => {
    const page = makePage({ networkLog: [makeNetworkEntry({ resourceType: 'image', method: 'GET' })] })
    const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: true, captureResponseBodies: true })
    expect(entries).toHaveLength(0)
  })

  it('dedupes the same method/url pair across pages into one entry', () => {
    const entry = makeNetworkEntry({ url: 'https://example.com/api/track', method: 'POST', resourceType: 'fetch' })
    const pages = ['a', 'b'].map((slug) => makePage({ url: `https://example.com/${slug}`, networkLog: [entry] }))
    const entries = buildApiTestScaffoldEntries(pages, { captureRequestBodies: true, captureResponseBodies: true })
    expect(entries).toHaveLength(1)
  })

  it('renders the endpoint as method + path, without the query string', () => {
    const page = makePage({
      networkLog: [
        makeNetworkEntry({
          url: 'https://example.com/api/search?q=shoes&page=2',
          method: 'GET',
          queryParams: { q: 'shoes', page: '2' },
        }),
      ],
    })
    const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: true, captureResponseBodies: true })
    expect(entries[0]!.endpoint).toBe('https://example.com/api/search')
    expect(entries[0]!.queryParams).toEqual({ q: 'shoes', page: '2' })
  })

  it('carries requiresAuth through unchanged', () => {
    const page = makePage({ networkLog: [makeNetworkEntry({ requiresAuth: true })] })
    const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: true, captureResponseBodies: true })
    expect(entries[0]!.requiresAuth).toBe(true)
  })

  describe('request fields — the not-applicable vs not-captured distinction', () => {
    it('is "captured" with real field names when the flag was on and a body was sampled', () => {
      const page = makePage({ networkLog: [makeNetworkEntry({ method: 'POST', requestBody: ['username', 'password'] })] })
      const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: true, captureResponseBodies: false })
      expect(entries[0]!.requestFields).toEqual({ status: 'captured', fields: ['username', 'password'], note: null })
    })

    it('is "not-captured" when --capture-request-bodies was off for the crawl, regardless of the entry', () => {
      const page = makePage({ networkLog: [makeNetworkEntry({ method: 'POST', requestBody: null })] })
      const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: false, captureResponseBodies: false })
      expect(entries[0]!.requestFields.status).toBe('not-captured')
      expect(entries[0]!.requestFields.note).toMatch(/--capture-request-bodies/)
    })

    it('is "not-applicable" when the flag was on but the request had no eligible body (e.g. multipart)', () => {
      const page = makePage({ networkLog: [makeNetworkEntry({ method: 'POST', requestBody: null })] })
      const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: true, captureResponseBodies: false })
      expect(entries[0]!.requestFields.status).toBe('not-applicable')
      expect(entries[0]!.requestFields.note).not.toMatch(/--capture-request-bodies/)
    })
  })

  describe('request fields — specific not-applicable attribution (multipart / size cap / unsupported content type)', () => {
    it('labels multipart specifically, distinct from the generic unsupported-content-type wording', () => {
      const page = makePage({
        networkLog: [makeNetworkEntry({ method: 'POST', requestBody: null, requestBodyContentTypeCategory: 'multipart' })],
      })
      const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: true, captureResponseBodies: false })
      expect(entries[0]!.requestFields.note).toMatch(/multipart\/form-data/)
    })

    it('labels the size cap specifically for a json body that was null purely from exceeding the cap', () => {
      const page = makePage({
        networkLog: [
          makeNetworkEntry({
            method: 'POST',
            requestBody: null,
            requestBodyContentTypeCategory: 'json',
            requestBodyExceededSizeCap: true,
          }),
        ],
      })
      const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: true, captureResponseBodies: false })
      expect(entries[0]!.requestFields.note).toMatch(/max-request-body-bytes/)
    })

    it('labels the size cap specifically for a form-urlencoded body that was null purely from exceeding the cap', () => {
      const page = makePage({
        networkLog: [
          makeNetworkEntry({
            method: 'POST',
            requestBody: null,
            requestBodyContentTypeCategory: 'form-urlencoded',
            requestBodyExceededSizeCap: true,
          }),
        ],
      })
      const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: true, captureResponseBodies: false })
      expect(entries[0]!.requestFields.note).toMatch(/max-request-body-bytes/)
    })

    it('precedence: multipart wins over the size cap when a multipart body is also oversized', () => {
      const page = makePage({
        networkLog: [
          makeNetworkEntry({
            method: 'POST',
            requestBody: null,
            requestBodyContentTypeCategory: 'multipart',
            requestBodyExceededSizeCap: true,
          }),
        ],
      })
      const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: true, captureResponseBodies: false })
      expect(entries[0]!.requestFields.note).toMatch(/multipart\/form-data/)
      expect(entries[0]!.requestFields.note).not.toMatch(/max-request-body-bytes/)
    })

    it('labels an unrecognized content type distinctly from both multipart and the size cap', () => {
      const page = makePage({
        networkLog: [makeNetworkEntry({ method: 'POST', requestBody: null, requestBodyContentTypeCategory: 'other' })],
      })
      const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: true, captureResponseBodies: false })
      expect(entries[0]!.requestFields.note).not.toMatch(/multipart\/form-data/)
      expect(entries[0]!.requestFields.note).not.toMatch(/max-request-body-bytes/)
      expect(entries[0]!.requestFields.note).toMatch(/unsupported|outside JSON/)
    })

    it('labels a request with no body at all (e.g. a GET) distinctly from an unsupported content type', () => {
      const page = makePage({
        networkLog: [makeNetworkEntry({ method: 'GET', resourceType: 'xhr', requestBody: null, requestBodyContentTypeCategory: null })],
      })
      const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: true, captureResponseBodies: false })
      expect(entries[0]!.requestFields.note).toMatch(/no request body was sent/)
    })

    it('labels a recognized-but-unparseable json body (e.g. malformed) distinctly, when not from the size cap', () => {
      const page = makePage({
        networkLog: [
          makeNetworkEntry({
            method: 'POST',
            requestBody: null,
            requestBodyContentTypeCategory: 'json',
            requestBodyExceededSizeCap: false,
          }),
        ],
      })
      const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: true, captureResponseBodies: false })
      expect(entries[0]!.requestFields.note).toMatch(/could not be parsed/)
    })
  })

  describe('response schema — the same not-applicable vs not-captured distinction', () => {
    it('is "captured" with the real schema when the flag was on and a schema was inferred', () => {
      const page = makePage({ networkLog: [makeNetworkEntry({ responseBodySchema: { id: 'number', name: 'string' } })] })
      const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: false, captureResponseBodies: true })
      expect(entries[0]!.responseSchema).toEqual({ status: 'captured', schema: { id: 'number', name: 'string' }, note: null })
    })

    it('is "not-captured" when --capture-response-bodies was off for the crawl', () => {
      const page = makePage({ networkLog: [makeNetworkEntry({ responseBodySchema: null })] })
      const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: false, captureResponseBodies: false })
      expect(entries[0]!.responseSchema.status).toBe('not-captured')
      expect(entries[0]!.responseSchema.note).toMatch(/--capture-response-bodies/)
    })

    it('is "not-applicable" when the flag was on but no schema could be inferred (e.g. non-JSON, oversized, or a top-level array)', () => {
      const page = makePage({ networkLog: [makeNetworkEntry({ responseBodySchema: null })] })
      const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: false, captureResponseBodies: true })
      expect(entries[0]!.responseSchema.status).toBe('not-applicable')
      expect(entries[0]!.responseSchema.note).not.toMatch(/--capture-response-bodies/)
    })
  })

  it('deduplicates schema hints from both request and response field names, dropping overlaps', () => {
    const page = makePage({
      networkLog: [
        makeNetworkEntry({
          method: 'POST',
          requestBody: ['patientId', 'notes'],
          responseBodySchema: { patientId: 'string', status: 'string' },
        }),
      ],
    })
    const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: true, captureResponseBodies: true })
    expect(entries[0]!.schemaHints).toEqual(['notes', 'patientId', 'status'])
  })

  it('produces no schema hints when neither flag was on', () => {
    const page = makePage({ networkLog: [makeNetworkEntry({ method: 'POST' })] })
    const entries = buildApiTestScaffoldEntries([page], { captureRequestBodies: false, captureResponseBodies: false })
    expect(entries[0]!.schemaHints).toEqual([])
  })
})

describe('generateApiTestScaffold', () => {
  it('carries the crawl-level flags onto the report', () => {
    const report = generateApiTestScaffold([makePage({})], { captureRequestBodies: true, captureResponseBodies: false })
    expect(report.captureRequestBodies).toBe(true)
    expect(report.captureResponseBodies).toBe(false)
  })
})

describe('renderApiTestScaffoldMarkdown', () => {
  it('states plainly when no endpoints were observed', () => {
    const report = generateApiTestScaffold([makePage({})], { captureRequestBodies: true, captureResponseBodies: true })
    const markdown = renderApiTestScaffoldMarkdown(report)
    expect(markdown).toContain('No API endpoints were observed.')
  })

  it('renders one heading per unique endpoint with method + path', () => {
    const page = makePage({ networkLog: [makeNetworkEntry({ url: 'https://example.com/api/foo', method: 'POST' })] })
    const report = generateApiTestScaffold([page], { captureRequestBodies: true, captureResponseBodies: true })
    const markdown = renderApiTestScaffoldMarkdown(report)
    expect(markdown).toContain('## POST https://example.com/api/foo')
  })

  it('labels the request-fields section as not captured, with the flag name, when the flag was off', () => {
    const page = makePage({ networkLog: [makeNetworkEntry({ method: 'POST' })] })
    const report = generateApiTestScaffold([page], { captureRequestBodies: false, captureResponseBodies: true })
    const markdown = renderApiTestScaffoldMarkdown(report)
    expect(markdown).toContain('not captured (`--capture-request-bodies` was off for this crawl)')
  })

  it('labels the response-schema section as not applicable, distinct wording from not-captured, on a flag-on multipart-shaped miss', () => {
    const page = makePage({ networkLog: [makeNetworkEntry({ responseBodySchema: null })] })
    const report = generateApiTestScaffold([page], { captureRequestBodies: false, captureResponseBodies: true })
    const markdown = renderApiTestScaffoldMarkdown(report)
    expect(markdown).toContain('not applicable')
    expect(markdown).not.toContain('not captured (`--capture-response-bodies`')
  })

  it('prints a top-level note when a capture flag was off for the whole crawl', () => {
    const page = makePage({ networkLog: [makeNetworkEntry({ method: 'POST' })] })
    const report = generateApiTestScaffold([page], { captureRequestBodies: false, captureResponseBodies: false })
    const markdown = renderApiTestScaffoldMarkdown(report)
    expect(markdown).toContain('Request body/field capture was off for this crawl')
    expect(markdown).toContain('Response schema capture was off for this crawl')
  })

  it('renders query params, requires-auth, and schema hints for a fully-captured endpoint', () => {
    const page = makePage({
      networkLog: [
        makeNetworkEntry({
          url: 'https://example.com/api/login?redirect=/dashboard',
          method: 'POST',
          queryParams: { redirect: '/dashboard' },
          requiresAuth: true,
          requestBody: ['username', 'password'],
          responseBodySchema: { token: 'string' },
        }),
      ],
    })
    const report = generateApiTestScaffold([page], { captureRequestBodies: true, captureResponseBodies: true })
    const markdown = renderApiTestScaffoldMarkdown(report)
    expect(markdown).toContain('redirect=/dashboard')
    expect(markdown).toContain('**Requires auth:** Yes')
    expect(markdown).toContain('username, password')
    expect(markdown).toContain('`token`: string')
    expect(markdown).toContain('**Possible schema hints (inferred, unverified):** password, token, username')
  })

  it('sanitizes untrusted field/URL content so an embedded newline cannot inject a fake heading', () => {
    const page = makePage({
      networkLog: [
        makeNetworkEntry({
          method: 'POST',
          requestBody: ['legit\n## Fake Heading'],
        }),
      ],
    })
    const report = generateApiTestScaffold([page], { captureRequestBodies: true, captureResponseBodies: false })
    const markdown = renderApiTestScaffoldMarkdown(report)
    expect(markdown).not.toContain('\n## Fake Heading')
  })
})
