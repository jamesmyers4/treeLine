import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CapturedForm, PageState } from '@treeline/acquire'

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
  pageLoadMs: 500,
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

  it('returns proposedAssertion: null and makes only one API call when the page has no forms', async () => {
    const mockClient = makeMockClient(mockToolUseResponse)
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    const result = await interpretPage(mockPageState)
    expect(result.proposedAssertion).toBeNull()
    expect(mockClient.messages.create).toHaveBeenCalledTimes(1)
  })
})

describe('interpretPage — proposedAssertion (forms-gated)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const form: CapturedForm = {
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
        cssPath: 'body > form > input',
      },
      {
        role: 'button',
        accessibleName: 'Submit',
        tagName: 'input',
        inputType: 'submit',
        required: false,
        pattern: null,
        testId: null,
        cssPath: 'body > form > input[type=submit]',
      },
    ],
  }

  const formPageState: PageState = {
    ...mockPageState,
    forms: [form],
  }

  const mockProposalResponse = {
    content: [{
      type: 'tool_use',
      id: 'tool_proposal_1',
      name: 'propose_assertion',
      input: {
        applicable: true,
        scenario: 'Fill out and submit the signup form with synthetic data',
        fieldValues: [{ fieldIndex: 0, value: 'test@example.com' }],
        successAssertion: 'A confirmation message appears'
      }
    }]
  }

  function makeSequentialMockClient(responses: unknown[]) {
    const create = vi.fn()
    for (const response of responses) create.mockResolvedValueOnce(response)
    return { messages: { create } }
  }

  it('makes a second propose_assertion call when the page has a form', async () => {
    const mockClient = makeSequentialMockClient([mockToolUseResponse, mockProposalResponse])
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    await interpretPage(formPageState)
    expect(mockClient.messages.create).toHaveBeenCalledTimes(2)
    const secondCall = mockClient.messages.create.mock.calls[1][0]
    expect(secondCall.tool_choice).toEqual({ type: 'tool', name: 'propose_assertion' })
  })

  it('returns a populated ProposedAssertion including formIndex and an unverified-guess caveat', async () => {
    const mockClient = makeSequentialMockClient([mockToolUseResponse, mockProposalResponse])
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    const result = await interpretPage(formPageState)
    expect(result.proposedAssertion).not.toBeNull()
    expect(result.proposedAssertion?.scenario).toBe('Fill out and submit the signup form with synthetic data')
    expect(result.proposedAssertion?.formIndex).toBe(0)
    expect(result.proposedAssertion?.fieldValues).toEqual([{ fieldIndex: 0, accessibleName: 'Email', value: 'test@example.com' }])
    expect(result.proposedAssertion?.successAssertion).toBe('A confirmation message appears')
    expect(typeof result.proposedAssertion?.successAssertionCaveat).toBe('string')
    expect(result.proposedAssertion?.successAssertionCaveat.length).toBeGreaterThan(0)
  })

  it('returns proposedAssertion: null when the model reports applicable: false', async () => {
    const notApplicableResponse = {
      content: [{
        type: 'tool_use',
        id: 'tool_proposal_2',
        name: 'propose_assertion',
        input: { applicable: false, scenario: '', fieldValues: [], successAssertion: '' }
      }]
    }
    const mockClient = makeSequentialMockClient([mockToolUseResponse, notApplicableResponse])
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    const result = await interpretPage(formPageState)
    expect(result.proposedAssertion).toBeNull()
  })

  it('degrades to proposedAssertion: null (not a thrown error) after exhausting retries on a malformed proposal response', async () => {
    const malformedResponse = {
      content: [{
        type: 'tool_use',
        id: 'tool_proposal_bad',
        name: 'propose_assertion',
        input: { applicable: true }
      }]
    }
    const mockClient = makeSequentialMockClient([mockToolUseResponse, malformedResponse, malformedResponse])
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    const result = await interpretPage(formPageState)
    expect(result.proposedAssertion).toBeNull()
    expect(result.pageType).toBe('login')
    expect(mockClient.messages.create).toHaveBeenCalledTimes(3)
  })

  it('always derives accessibleName from the real captured field, ignoring anything the model might claim about it', async () => {
    const mockClient = makeSequentialMockClient([mockToolUseResponse, mockProposalResponse])
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    const result = await interpretPage(formPageState)
    expect(result.proposedAssertion?.fieldValues[0]?.accessibleName).toBe(form.fields[0]!.accessibleName)
  })

  it('drops a field value whose fieldIndex points at the submit button rather than a fillable field', async () => {
    const responseReferencingButton = {
      content: [{
        type: 'tool_use',
        id: 'tool_proposal_button_ref',
        name: 'propose_assertion',
        input: {
          applicable: true,
          scenario: 'Fill out and submit the signup form with synthetic data',
          fieldValues: [
            { fieldIndex: 0, value: 'test@example.com' },
            { fieldIndex: 1, value: 'clicked' }
          ],
          successAssertion: 'A confirmation message appears'
        }
      }]
    }
    const mockClient = makeSequentialMockClient([mockToolUseResponse, responseReferencingButton])
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    const result = await interpretPage(formPageState)
    expect(result.proposedAssertion?.fieldValues).toHaveLength(1)
    expect(result.proposedAssertion?.fieldValues[0]?.fieldIndex).toBe(0)
  })

  it('drops a field value whose fieldIndex is out of range', async () => {
    const responseWithBadIndex = {
      content: [{
        type: 'tool_use',
        id: 'tool_proposal_oob',
        name: 'propose_assertion',
        input: {
          applicable: true,
          scenario: 'Fill out and submit the signup form with synthetic data',
          fieldValues: [
            { fieldIndex: 0, value: 'test@example.com' },
            { fieldIndex: 99, value: 'garbage' }
          ],
          successAssertion: 'A confirmation message appears'
        }
      }]
    }
    const mockClient = makeSequentialMockClient([mockToolUseResponse, responseWithBadIndex])
    vi.mocked(getAnthropicClient).mockReturnValue(mockClient as never)
    const result = await interpretPage(formPageState)
    expect(result.proposedAssertion?.fieldValues).toHaveLength(1)
    expect(result.proposedAssertion?.fieldValues[0]?.fieldIndex).toBe(0)
  })
})
