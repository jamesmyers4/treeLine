import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PageState } from '@treeline/acquire'

vi.mock('./client.js', () => ({
  getAnthropicClient: vi.fn()
}))

import { getAnthropicClient } from './client.js'
import { interpretPage } from './interpret.js'

const mockPageState: PageState = {
  url: 'https://example.com/login',
  title: 'Login',
  ariaSnapshot: 'heading "Login"\ntextbox "Username"\ntextbox "Password"\nbutton "Sign In"',
  links: [],
  networkLog: [],
  screenshot: null,
  capturedAt: '2026-01-01T00:00:00.000Z',
  interactiveElements: [],
  axeViolations: [],
  axeIncomplete: [],
  forms: []
}

const mockToolUseResponse = {
  content: [{
    type: 'tool_use',
    id: 'tool_123',
    name: 'interpret_page',
    input: {
      pageType: 'login',
      purpose: 'Authenticate users',
      keyDataEntities: ['username', 'password'],
      confidence: 0.95
    }
  }]
}

function makeMockClient(response: unknown) {
  return { messages: { create: vi.fn().mockResolvedValue(response) } }
}

describe('interpretPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns a PageInterpretation with correct fields', async () => {
    const mockClient = makeMockClient(mockToolUseResponse)
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    const result = await interpretPage(mockPageState)
    expect(result.url).toBe(mockPageState.url)
    expect(result.pageType).toBe('login')
    expect(result.purpose).toBe('Authenticate users')
    expect(result.keyDataEntities).toEqual(['username', 'password'])
    expect(result.confidence).toBe(0.95)
  })

  it('sets tierUsed based on routing decision', async () => {
    const mockClient = makeMockClient(mockToolUseResponse)
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    const result = await interpretPage(mockPageState)
    expect(['haiku', 'sonnet']).toContain(result.tierUsed)
  })

  it('throws when tool_use block is missing from response', async () => {
    const badResponse = { content: [{ type: 'text', text: 'oops' }] }
    const mockClient = makeMockClient(badResponse)
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    await expect(interpretPage(mockPageState)).rejects.toThrow(
      `interpret_page tool_use block missing from API response for URL: ${mockPageState.url}`
    )
  })

  it('throws when tool_use input has unexpected shape', async () => {
    const badResponse = {
      content: [{
        type: 'tool_use',
        id: 'tool_abc',
        name: 'interpret_page',
        input: { pageType: 'login' }
      }]
    }
    const mockClient = makeMockClient(badResponse)
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    await expect(interpretPage(mockPageState)).rejects.toThrow(
      `interpret_page tool_use input has unexpected shape for URL: ${mockPageState.url}`
    )
  })

  it('throws when keyDataEntities is a comma-separated string instead of an array', async () => {
    const badResponse = {
      content: [{
        type: 'tool_use',
        id: 'tool_def',
        name: 'interpret_page',
        input: {
          pageType: 'login',
          purpose: 'Authenticate users',
          keyDataEntities: 'username,password',
          confidence: 0.95
        }
      }]
    }
    const mockClient = makeMockClient(badResponse)
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    await expect(interpretPage(mockPageState)).rejects.toThrow(
      `interpret_page tool_use input has unexpected shape for URL: ${mockPageState.url}`
    )
  })

  it('throws when confidence is a string instead of a number', async () => {
    const badResponse = {
      content: [{
        type: 'tool_use',
        id: 'tool_ghi',
        name: 'interpret_page',
        input: {
          pageType: 'login',
          purpose: 'Authenticate users',
          keyDataEntities: ['username', 'password'],
          confidence: '0.9'
        }
      }]
    }
    const mockClient = makeMockClient(badResponse)
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    await expect(interpretPage(mockPageState)).rejects.toThrow(
      `interpret_page tool_use input has unexpected shape for URL: ${mockPageState.url}`
    )
  })

  it('uses haiku model for simple pages', async () => {
    const simpleState: PageState = {
      ...mockPageState,
      ariaSnapshot: 'heading "Simple"\nlink "Home"'
    }
    const mockClient = makeMockClient(mockToolUseResponse)
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    await interpretPage(simpleState)
    const createCall = mockClient.messages.create.mock.calls[0][0]
    expect(createCall.model).toMatch(/haiku/)
  })

  it('uses sonnet model for complex pages', async () => {
    const manyButtons = Array.from({ length: 10 }, (_, i) => `button "B${i}"`).join('\n')
    const complexState: PageState = { ...mockPageState, ariaSnapshot: manyButtons }
    const mockClient = makeMockClient(mockToolUseResponse)
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    await interpretPage(complexState)
    const createCall = mockClient.messages.create.mock.calls[0][0]
    expect(createCall.model).toMatch(/sonnet/)
  })

  it('sends url and aria snapshot in the user message', async () => {
    const mockClient = makeMockClient(mockToolUseResponse)
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    await interpretPage(mockPageState)
    const createCall = mockClient.messages.create.mock.calls[0][0]
    const userContent = createCall.messages[0].content as string
    expect(userContent).toContain(mockPageState.url)
    expect(userContent).toContain(mockPageState.ariaSnapshot)
  })

  it('forces tool_choice to interpret_page', async () => {
    const mockClient = makeMockClient(mockToolUseResponse)
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    await interpretPage(mockPageState)
    const createCall = mockClient.messages.create.mock.calls[0][0]
    expect(createCall.tool_choice).toEqual({ type: 'tool', name: 'interpret_page' })
  })

  it('retries once and succeeds when the first call is malformed and the second is well-formed', async () => {
    const malformedResponse = {
      content: [{
        type: 'tool_use',
        id: 'tool_retry_1',
        name: 'interpret_page',
        input: { pageType: 'login' }
      }]
    }
    const mockClient = {
      messages: {
        create: vi.fn()
          .mockResolvedValueOnce(malformedResponse)
          .mockResolvedValueOnce(mockToolUseResponse)
      }
    }
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    const result = await interpretPage(mockPageState)
    expect(result.pageType).toBe('login')
    expect(result.purpose).toBe('Authenticate users')
    expect(mockClient.messages.create).toHaveBeenCalledTimes(2)
  })

  it('throws after exhausting retries when every call is malformed', async () => {
    const malformedResponse = {
      content: [{
        type: 'tool_use',
        id: 'tool_retry_2',
        name: 'interpret_page',
        input: { pageType: 'login' }
      }]
    }
    const mockClient = {
      messages: {
        create: vi.fn().mockResolvedValue(malformedResponse)
      }
    }
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    await expect(interpretPage(mockPageState)).rejects.toThrow(
      `interpret_page tool_use input has unexpected shape for URL: ${mockPageState.url}`
    )
    expect(mockClient.messages.create).toHaveBeenCalledTimes(2)
  })

  it('declares keyDataEntities as an array schema with a string items constraint', async () => {
    const mockClient = makeMockClient(mockToolUseResponse)
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    await interpretPage(mockPageState)
    const createCall = mockClient.messages.create.mock.calls[0][0]
    const tool = createCall.tools[0]
    const keyDataEntitiesSchema = tool.input_schema.properties.keyDataEntities
    expect(keyDataEntitiesSchema.type).toBe('array')
    expect(keyDataEntitiesSchema.items).toEqual({ type: 'string' })
    expect(typeof keyDataEntitiesSchema.description).toBe('string')
    expect(keyDataEntitiesSchema.description.length).toBeGreaterThan(0)
  })
})
