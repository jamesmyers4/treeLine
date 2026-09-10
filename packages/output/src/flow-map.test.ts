import { describe, it, expect } from 'vitest'
import type { CapturedForm, NetworkEntry } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import { generateFlowMap, isApiSurfaceCandidate, isOwnSiteApiSurface, renderFlowMapMarkdown } from './flow-map.js'

function makeForm(overrides: Partial<CapturedForm>): CapturedForm {
  return {
    formIndex: 0,
    action: '/submit',
    method: 'post',
    fields: [
      {
        role: 'textbox',
        accessibleName: 'Email',
        tagName: 'input',
        inputType: 'email',
        required: true,
        pattern: null,
        testId: null,
        cssPath: 'form > input',
      },
    ],
    ...overrides,
  }
}

function makeNetworkEntry(overrides: Partial<NetworkEntry>): NetworkEntry {
  return {
    url: 'https://example.com/api/data',
    method: 'GET',
    status: 200,
    resourceType: 'xhr',
    durationMs: 50,
    responseBodySample: null,
    responseBodySchema: null,
    responseBodyContentTypeCategory: null,
    responseBodyExceededSizeCap: false,
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

describe('isApiSurfaceCandidate', () => {
  it('includes xhr, fetch, websocket, and eventsource resource types', () => {
    expect(isApiSurfaceCandidate(makeNetworkEntry({ resourceType: 'xhr' }))).toBe(true)
    expect(isApiSurfaceCandidate(makeNetworkEntry({ resourceType: 'fetch' }))).toBe(true)
    expect(isApiSurfaceCandidate(makeNetworkEntry({ resourceType: 'websocket' }))).toBe(true)
    expect(isApiSurfaceCandidate(makeNetworkEntry({ resourceType: 'eventsource' }))).toBe(true)
  })

  it('includes non-GET requests regardless of resource type', () => {
    expect(isApiSurfaceCandidate(makeNetworkEntry({ resourceType: 'document', method: 'POST' }))).toBe(true)
  })

  it('excludes GET requests to static assets', () => {
    expect(isApiSurfaceCandidate(makeNetworkEntry({ resourceType: 'image', method: 'GET' }))).toBe(false)
    expect(isApiSurfaceCandidate(makeNetworkEntry({ resourceType: 'stylesheet', method: 'GET' }))).toBe(false)
    expect(isApiSurfaceCandidate(makeNetworkEntry({ resourceType: 'script', method: 'GET' }))).toBe(false)
    expect(isApiSurfaceCandidate(makeNetworkEntry({ resourceType: 'font', method: 'GET' }))).toBe(false)
    expect(isApiSurfaceCandidate(makeNetworkEntry({ resourceType: 'document', method: 'GET' }))).toBe(false)
  })
})

describe('isOwnSiteApiSurface', () => {
  it('excludes a real cross-origin resource-loading call even though it is a genuine xhr (real Google Fonts shape)', () => {
    const entry = makeNetworkEntry({ url: 'https://fonts.googleapis.com/css2?family=Roboto', method: 'GET', resourceType: 'xhr' })
    expect(isOwnSiteApiSurface('https://example.com/pricing', entry)).toBe(false)
  })

  it('includes a same-origin xhr call to the site\'s own API', () => {
    const entry = makeNetworkEntry({ url: 'https://example.com/api/data', method: 'GET', resourceType: 'xhr' })
    expect(isOwnSiteApiSurface('https://example.com/pricing', entry)).toBe(true)
  })

  it('still excludes a same-origin GET to a static asset (resourceType rule still applies)', () => {
    const entry = makeNetworkEntry({ url: 'https://example.com/app.css', method: 'GET', resourceType: 'stylesheet' })
    expect(isOwnSiteApiSurface('https://example.com/pricing', entry)).toBe(false)
  })
})

describe('generateFlowMap', () => {
  it('reports nothing found when a page has no forms and no interesting network activity', () => {
    const page = makePage({
      networkLog: [makeNetworkEntry({ resourceType: 'image', method: 'GET' })],
    })
    const flowMap = generateFlowMap([page])
    expect(flowMap.forms).toHaveLength(0)
    expect(flowMap.apiSurface).toHaveLength(0)
    expect(flowMap.totalForms).toBe(0)
    expect(flowMap.pagesWithForms).toBe(0)
  })

  it('renders a page with one real form correctly', () => {
    const form = makeForm({})
    const page = makePage({ forms: [form] })
    const flowMap = generateFlowMap([page])
    expect(flowMap.forms).toHaveLength(1)
    expect(flowMap.forms[0]!.url).toBe('https://example.com')
    expect(flowMap.forms[0]!.forms).toEqual([form])
    expect(flowMap.totalForms).toBe(1)
    expect(flowMap.pagesWithForms).toBe(1)
  })

  it('groups forms correctly across multiple pages', () => {
    const pageOne = makePage({ url: 'https://example.com/a', forms: [makeForm({})] })
    const pageTwo = makePage({ url: 'https://example.com/b', forms: [makeForm({ action: '/other' })] })
    const flowMap = generateFlowMap([pageOne, pageTwo])
    expect(flowMap.forms).toHaveLength(2)
    expect(flowMap.forms.map((entry) => entry.url)).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(flowMap.totalForms).toBe(2)
  })

  it('excludes GET requests to static assets from the API surface', () => {
    const page = makePage({
      networkLog: [
        makeNetworkEntry({ url: 'https://example.com/logo.png', resourceType: 'image', method: 'GET' }),
        makeNetworkEntry({ url: 'https://example.com/app.css', resourceType: 'stylesheet', method: 'GET' }),
        makeNetworkEntry({ url: 'https://example.com/app.js', resourceType: 'script', method: 'GET' }),
      ],
    })
    const flowMap = generateFlowMap([page])
    expect(flowMap.apiSurface).toHaveLength(0)
  })

  it('includes an XHR request with method GET', () => {
    const page = makePage({
      networkLog: [makeNetworkEntry({ url: 'https://example.com/api/data', resourceType: 'xhr', method: 'GET' })],
    })
    const flowMap = generateFlowMap([page])
    expect(flowMap.apiSurface).toHaveLength(1)
    expect(flowMap.apiSurface[0]!.method).toBe('GET')
    expect(flowMap.apiSurface[0]!.url).toBe('https://example.com/api/data')
  })

  it('includes a POST request with resourceType document as a form submission navigation', () => {
    const page = makePage({
      networkLog: [makeNetworkEntry({ url: 'https://example.com/submit', resourceType: 'document', method: 'POST' })],
    })
    const flowMap = generateFlowMap([page])
    expect(flowMap.apiSurface).toHaveLength(1)
    expect(flowMap.apiSurface[0]!.method).toBe('POST')
  })

  it('collapses the same method/url pair across pages into one entry with a capped, counted sample', () => {
    const entry = makeNetworkEntry({ url: 'https://example.com/api/track', method: 'POST', resourceType: 'fetch' })
    const pages = ['a', 'b', 'c', 'd', 'e'].map((slug) =>
      makePage({ url: `https://example.com/${slug}`, networkLog: [entry] }),
    )
    const flowMap = generateFlowMap(pages)
    expect(flowMap.apiSurface).toHaveLength(1)
    const surfaceEntry = flowMap.apiSurface[0]!
    expect(surfaceEntry.occurrenceCount).toBe(5)
    expect(surfaceEntry.samplePages).toHaveLength(3)
    expect(surfaceEntry.totalPageCount).toBe(5)
    expect(flowMap.distinctApiEndpoints).toBe(1)
  })

  it('collapses a per-request-token URL hit on 5 pages into 1 endpoint row, not 5 (goldenpetbrands.com Cloudflare-challenge shape)', () => {
    const hashes = ['8f3a2b1c9d4e5f6a', '1a2b3c4d5e6f7a8b', '9c8d7e6f5a4b3c2d', '2b3c4d5e6f7a8b9c', '7a6b5c4d3e2f1a0b']
    const pages = hashes.map((hash, i) =>
      makePage({
        url: `https://example.com/${i}`,
        networkLog: [
          makeNetworkEntry({
            url: `https://example.com/cdn-cgi/challenge-platform/h/g/orchestrate/jsch/v1/${hash}`,
            method: 'GET',
            resourceType: 'xhr',
          }),
        ],
      }),
    )
    const flowMap = generateFlowMap(pages)
    expect(flowMap.apiSurface).toHaveLength(1)
    const surfaceEntry = flowMap.apiSurface[0]!
    expect(surfaceEntry.url).toBe('https://example.com/cdn-cgi/challenge-platform/h/g/orchestrate/jsch/v1/{id}')
    expect(surfaceEntry.occurrenceCount).toBe(5)
    expect(surfaceEntry.distinctUrlCount).toBe(5)
    expect(flowMap.distinctApiEndpoints).toBe(1)
  })

  it('excludes a real third-party resource-loading call from the API surface, even though the capture layer genuinely tags it resourceType: xhr (real Google Fonts shape, CONTEXT.md known gap, now closed)', () => {
    const page = makePage({
      url: 'https://example.com/pricing',
      networkLog: [
        makeNetworkEntry({ url: 'https://fonts.googleapis.com/css2?family=Roboto', method: 'GET', resourceType: 'xhr' }),
        makeNetworkEntry({ url: 'https://example.com/api/pricing-data', method: 'GET', resourceType: 'xhr' }),
      ],
    })
    const flowMap = generateFlowMap([page])
    expect(flowMap.apiSurface).toHaveLength(1)
    expect(flowMap.apiSurface[0]!.url).toBe('https://example.com/api/pricing-data')
    expect(flowMap.distinctApiEndpoints).toBe(1)
  })

  it('does not collapse two genuinely different endpoints that happen to both have long path segments', () => {
    const page = makePage({
      networkLog: [
        makeNetworkEntry({ url: 'https://example.com/api/user-settings', method: 'GET', resourceType: 'xhr' }),
        makeNetworkEntry({ url: 'https://example.com/api/order-history', method: 'GET', resourceType: 'xhr' }),
      ],
    })
    const flowMap = generateFlowMap([page])
    expect(flowMap.apiSurface).toHaveLength(2)
    expect(flowMap.apiSurface.map((e) => e.distinctUrlCount)).toEqual([1, 1])
  })
})

describe('renderFlowMapMarkdown', () => {
  it('states plainly when no forms or API activity were found, without an empty table', () => {
    const flowMap = generateFlowMap([makePage({})])
    const markdown = renderFlowMapMarkdown(flowMap)
    expect(markdown).toContain('No forms were found.')
    expect(markdown).toContain('No API surface activity was found.')
    expect(markdown).not.toContain('| Role | Accessible Name')
    expect(markdown).not.toContain('| Method | URL | Occurrences')
  })

  it('renders form action, method, and fields', () => {
    const page = makePage({ forms: [makeForm({})] })
    const flowMap = generateFlowMap([page])
    const markdown = renderFlowMapMarkdown(flowMap)
    expect(markdown).toContain('Action: /submit')
    expect(markdown).toContain('Method: POST')
    expect(markdown).toContain('Email')
  })

  it('caps sample pages and indicates more exist', () => {
    const entry = makeNetworkEntry({ url: 'https://example.com/api/track', method: 'POST', resourceType: 'fetch' })
    const pages = ['a', 'b', 'c', 'd', 'e'].map((slug) =>
      makePage({ url: `https://example.com/${slug}`, networkLog: [entry] }),
    )
    const flowMap = generateFlowMap(pages)
    const markdown = renderFlowMapMarkdown(flowMap)
    expect(markdown).toContain('+2 more')
  })

  it('notes the distinct-URL count in the table when a row collapsed multiple raw URLs, and omits it otherwise', () => {
    const collapsedPage = makePage({
      networkLog: [
        makeNetworkEntry({ url: 'https://example.com/track/11111', method: 'GET', resourceType: 'xhr' }),
        makeNetworkEntry({ url: 'https://example.com/track/22222', method: 'GET', resourceType: 'xhr' }),
      ],
    })
    const collapsedMarkdown = renderFlowMapMarkdown(generateFlowMap([collapsedPage]))
    expect(collapsedMarkdown).toContain('https://example.com/track/{id} (2 distinct URLs)')
    const plainPage = makePage({
      networkLog: [makeNetworkEntry({ url: 'https://example.com/api/track', method: 'GET', resourceType: 'xhr' })],
    })
    const plainMarkdown = renderFlowMapMarkdown(generateFlowMap([plainPage]))
    expect(plainMarkdown).toContain('https://example.com/api/track |')
    expect(plainMarkdown).not.toContain('distinct URLs')
  })

  it('renders a fenced, pretty-printed block for an endpoint with a captured response body sample', () => {
    const entry = makeNetworkEntry({
      url: 'https://example.com/api/data',
      method: 'GET',
      resourceType: 'xhr',
      responseBodySample: JSON.stringify({ id: 1, name: 'test' }),
    })
    const page = makePage({ networkLog: [entry] })
    const flowMap = generateFlowMap([page])
    const markdown = renderFlowMapMarkdown(flowMap)
    expect(markdown).toContain('## Sample Response Bodies')
    expect(markdown).toContain('"id": 1')
    expect(markdown).toContain('"name": "test"')
  })

  it('does not render a block for an endpoint with no response body sample', () => {
    const entry = makeNetworkEntry({ url: 'https://example.com/api/data', resourceType: 'xhr', responseBodySample: null })
    const page = makePage({ networkLog: [entry] })
    const flowMap = generateFlowMap([page])
    const markdown = renderFlowMapMarkdown(flowMap)
    expect(markdown).not.toContain('## Sample Response Bodies')
  })

  it('does not break out of its fence when the sample contains embedded triple backticks', () => {
    const trickyBody = 'prefix ```escape attempt``` suffix'
    const entry = makeNetworkEntry({
      url: 'https://example.com/api/data',
      resourceType: 'xhr',
      responseBodySample: trickyBody,
    })
    const page = makePage({ networkLog: [entry] })
    const flowMap = generateFlowMap([page])
    const markdown = renderFlowMapMarkdown(flowMap)
    const fenceMatch = markdown.match(/\n(`{4,})\n/)
    expect(fenceMatch).not.toBeNull()
    const fenceLines = markdown.split('\n').filter((line) => /^`+$/.test(line))
    expect(fenceLines.length).toBeGreaterThanOrEqual(2)
    expect(markdown).toContain(trickyBody)
  })

  it('falls back to raw (still fenced, still safe) text when the sample is not valid JSON', () => {
    const rawText = 'not valid json {{{'
    const entry = makeNetworkEntry({ url: 'https://example.com/api/data', resourceType: 'xhr', responseBodySample: rawText })
    const page = makePage({ networkLog: [entry] })
    const flowMap = generateFlowMap([page])
    const markdown = renderFlowMapMarkdown(flowMap)
    expect(markdown).toContain(rawText)
    expect(markdown).toContain('```')
  })
})
