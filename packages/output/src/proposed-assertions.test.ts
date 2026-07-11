import { describe, it, expect } from 'vitest'
import type { CapturedForm } from '@treeline/acquire'
import type { ProposedAssertion, StoredInterpretation } from '@treeline/core'
import type { CrawledPage } from './input.js'
import { generateProposedAssertionSpecs, renderProposedAssertionSpec } from './proposed-assertions.js'

function makeForm(overrides: Partial<CapturedForm> = {}): CapturedForm {
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
      {
        role: 'checkbox',
        accessibleName: 'Subscribe',
        tagName: 'input',
        inputType: 'checkbox',
        required: false,
        pattern: null,
        testId: null,
        cssPath: 'form > input[type=checkbox]',
      },
      {
        role: 'button',
        accessibleName: 'Sign Up',
        tagName: 'input',
        inputType: 'submit',
        required: false,
        pattern: null,
        testId: null,
        cssPath: 'form > input[type=submit]',
      },
    ],
    ...overrides,
  }
}

function makePage(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url: 'https://example.com/signup',
    title: 'Signup',
    ariaSnapshot: '',
    links: [],
    networkLog: [],
    screenshotPath: null,
    capturedAt: new Date().toISOString(),
    pageLoadMs: null,
    interactiveElements: [],
    axeViolations: [],
    axeIncomplete: [],
    forms: [makeForm()],
    status: 'ok',
    ...overrides,
  }
}

function makeAssertion(overrides: Partial<ProposedAssertion> = {}): ProposedAssertion {
  return {
    scenario: 'Fill out and submit the signup form with synthetic data',
    formIndex: 0,
    fieldValues: [
      { fieldIndex: 0, accessibleName: 'Email', value: 'test@example.com' },
      { fieldIndex: 1, accessibleName: 'Subscribe', value: 'true' },
    ],
    successAssertion: 'A confirmation message appears',
    successAssertionCaveat: 'This success assertion is an unverified guess.',
    ...overrides,
  }
}

function makeInterpretation(overrides: Partial<StoredInterpretation> = {}): StoredInterpretation {
  return {
    url: 'https://example.com/signup',
    tierUsed: 'haiku',
    pageType: 'form',
    purpose: 'Collect signup details',
    keyDataEntities: ['email'],
    confidence: 0.9,
    interpretedAt: new Date().toISOString(),
    proposedAssertion: null,
    ...overrides,
  }
}

describe('renderProposedAssertionSpec', () => {
  it('wraps the generated test in test.skip', () => {
    const code = renderProposedAssertionSpec(makePage(), makeAssertion())
    expect(code).toContain('test.skip(')
    expect(code).not.toMatch(/\btest\(/)
  })

  it('includes an AI-proposed / unverified header comment', () => {
    const code = renderProposedAssertionSpec(makePage(), makeAssertion())
    expect(code).toContain('AI-PROPOSED TEST')
    expect(code).toContain('UNVERIFIED')
  })

  it('uses a role-based locator with .fill() for a textbox field', () => {
    const code = renderProposedAssertionSpec(makePage(), makeAssertion())
    expect(code).toContain(`page.getByRole("textbox", { name: "Email" }).fill("test@example.com")`)
  })

  it('uses .check() rather than .fill() for a checkbox field', () => {
    const code = renderProposedAssertionSpec(makePage(), makeAssertion())
    expect(code).toContain(`page.getByRole("checkbox", { name: "Subscribe" }).check()`)
    expect(code).not.toContain(`page.getByRole("checkbox", { name: "Subscribe" }).fill(`)
  })

  it('clicks the real captured submit button by its role and accessible name', () => {
    const code = renderProposedAssertionSpec(makePage(), makeAssertion())
    expect(code).toContain(`page.getByRole("button", { name: "Sign Up" }).click()`)
  })

  it('does not generate a fill/check line for the submit button itself, even if the model referenced its fieldIndex', () => {
    const code = renderProposedAssertionSpec(makePage(), makeAssertion({
      fieldValues: [
        { fieldIndex: 0, accessibleName: 'Email', value: 'test@example.com' },
        { fieldIndex: 2, accessibleName: 'Sign Up', value: 'Sign Up' },
      ],
    }))
    const clickLines = code.split('\n').filter((line) => line.includes("name: \"Sign Up\""))
    expect(clickLines).toHaveLength(1)
    expect(clickLines[0]).toContain('.click()')
  })

  it('includes the success assertion and its unverified-guess caveat as comments', () => {
    const code = renderProposedAssertionSpec(makePage(), makeAssertion())
    expect(code).toContain('// A confirmation message appears')
    expect(code).toContain('// This success assertion is an unverified guess.')
  })

  it('falls back to a generic textbox locator keyed by accessibleName when fieldIndex is out of range', () => {
    const code = renderProposedAssertionSpec(makePage(), makeAssertion({
      fieldValues: [{ fieldIndex: 99, accessibleName: 'Nonexistent Field', value: 'Test Value' }],
    }))
    expect(code).toContain(`page.getByRole("textbox", { name: "Nonexistent Field" }).fill("Test Value")`)
  })
})

describe('generateProposedAssertionSpecs', () => {
  it('generates one .proposed.spec.ts file for a page with a non-null proposedAssertion', () => {
    const pages = [makePage()]
    const interpretations = [makeInterpretation({ proposedAssertion: makeAssertion() })]
    const specs = generateProposedAssertionSpecs(pages, interpretations)
    expect(specs).toHaveLength(1)
    expect(specs[0]!.fileName).toBe('signup.proposed.spec.ts')
    expect(specs[0]!.code).toContain('test.skip(')
  })

  it('generates nothing for a page with proposedAssertion: null', () => {
    const pages = [makePage()]
    const interpretations = [makeInterpretation({ proposedAssertion: null })]
    const specs = generateProposedAssertionSpecs(pages, interpretations)
    expect(specs).toHaveLength(0)
  })

  it('generates nothing for a page with no interpretation at all', () => {
    const pages = [makePage()]
    const specs = generateProposedAssertionSpecs(pages, [])
    expect(specs).toHaveLength(0)
  })

  it('skips pages that were never successfully captured', () => {
    const pages = [makePage({ title: null, ariaSnapshot: null, capturedAt: null })]
    const interpretations = [makeInterpretation({ proposedAssertion: makeAssertion() })]
    const specs = generateProposedAssertionSpecs(pages, interpretations)
    expect(specs).toHaveLength(0)
  })
})
