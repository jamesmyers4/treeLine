import { describe, it, expect } from 'vitest'
import type { CapturedForm, NetworkEntry } from '@treeline/acquire'
import type { CrawledPage } from './input.js'
import { generateFlowMap, isApiSurfaceCandidate, renderFlowMapMarkdown } from './flow-map.js'

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
  return { url: 'https://example.com/api/data', method: 'GET', status: 200, resourceType: 'xhr', ...overrides }
}

function makePage(overrides: Partial<CrawledPage>): CrawledPage {
  return {
    url: 'https://example.com',
    title: 'Test Page',
    ariaSnapshot: '',
    links: [],
    networkLog: [],
    screenshot: null,
    capturedAt: new Date().toISOString(),
    interactiveElements: [],
    axeViolations: [],
    axeIncomplete: [],
    forms: [],
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
})
