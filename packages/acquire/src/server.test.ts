import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildServer } from './server.js'
import { capturePage } from './capture.js'
import type { PageState } from './types.js'

vi.mock('./capture.js', () => ({
  capturePage: vi.fn(),
  defaultCaptureHandler: { matches: vi.fn(), capture: vi.fn() },
}))

const mockPageState: PageState = {
  url: 'https://example.com',
  title: 'Example Domain',
  ariaSnapshot: '- heading "Example Domain"',
  links: ['https://www.iana.org/domains/example'],
  networkLog: [],
  screenshot: null,
  capturedAt: '2024-01-01T00:00:00.000Z',
  pageLoadMs: 500,
  interactiveElements: [],
  axeViolations: [],
  axeIncomplete: [],
  forms: [],
}

describe('server', () => {
  const TEST_API_KEY = 'test-key-abc123'
  let app: ReturnType<typeof buildServer>

  beforeEach(() => {
    process.env.TREELINE_API_KEY = TEST_API_KEY
    vi.mocked(capturePage).mockResolvedValue(mockPageState)
    app = buildServer()
  })

  afterEach(async () => {
    await app.close()
  })

  it('GET /health returns 200 with status ok with no api key', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })

  it('POST /capture with no x-api-key returns 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/capture',
      payload: { url: 'https://example.com' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'unauthorized' })
  })

  it('POST /capture with correct key and valid url returns 200 with PageState', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/capture',
      headers: { 'x-api-key': TEST_API_KEY },
      payload: { url: 'https://example.com' },
    })
    expect(response.statusCode).toBe(200)
    const body = response.json<PageState>()
    expect(body).toMatchObject({
      url: expect.any(String),
      title: expect.any(String),
      ariaSnapshot: expect.any(String),
      links: expect.any(Array),
      networkLog: expect.any(Array),
      capturedAt: expect.any(String),
    })
  })

  it('POST /capture with correct key and missing url returns 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/capture',
      headers: { 'x-api-key': TEST_API_KEY },
      payload: {},
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'invalid request' })
  })
})
