import { describe, it, expect } from 'vitest'
import type { CapturedForm, DomInteractiveElement } from '@treeline/acquire'
import type { ContentPresenceAssertion, FormFillAssertion, ProposedAssertion, StoredInterpretation } from '@treeline/core'
import type { CrawledPage } from './input.js'
import { generateProposedAssertionSpecs, renderProposedAssertionSpec } from './proposed-assertions.js'
import { assertGeneratedArtifactParses } from './syntax-gate.js'

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
    colorPalette: [],
    status: 'ok',
    ...overrides,
  }
}

function makeAssertion(overrides: Partial<FormFillAssertion> = {}): FormFillAssertion {
  return {
    kind: 'form-fill',
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

function makeContentAssertion(overrides: Partial<ContentPresenceAssertion> = {}): ContentPresenceAssertion {
  return {
    kind: 'content-presence',
    scenario: 'Confirm the article headline and author link are present',
    elementIndices: [0, 1],
    assertion: 'The headline link and author link evidence this is the article page',
    assertionCaveat: 'This checks that an element treeline observed during the crawl is still present.',
    ...overrides,
  }
}

function makeElement(overrides: Partial<DomInteractiveElement> = {}): DomInteractiveElement {
  return {
    role: 'link',
    accessibleName: 'How Treeline Works',
    testId: null,
    tagName: 'a',
    elementId: null,
    classList: [],
    cssPath: 'body > article > a',
    xpath: '/html/body/article/a',
    appearedAtMs: null,
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

  it('clicks a submit-shaped button found in the captured interactiveElements when the form itself has no button field', () => {
    const buttonlessForm = makeForm({ fields: makeForm().fields.filter((f) => f.role !== 'button') })
    const page = makePage({
      forms: [buttonlessForm],
      interactiveElements: [makeElement({ role: 'button', tagName: 'button', accessibleName: 'Send Message', cssPath: 'body > button' })],
    })
    const code = renderProposedAssertionSpec(page, makeAssertion())
    expect(code).toContain(`page.getByRole("button", { name: "Send Message" }).click()`)
    expect(code).not.toContain('submit|create|save')
  })

  it('presses Enter on the last filled field, with an honest comment, when no submit button exists anywhere in the capture', () => {
    const buttonlessForm = makeForm({ fields: makeForm().fields.filter((f) => f.role !== 'button') })
    const page = makePage({ forms: [buttonlessForm], interactiveElements: [] })
    const code = renderProposedAssertionSpec(page, makeAssertion({
      fieldValues: [{ fieldIndex: 0, accessibleName: 'Email', value: 'test@example.com' }],
    }))
    expect(code).toContain(`await page.getByRole("textbox", { name: "Email" }).press('Enter')`)
    expect(code).toContain('// No submit button exists anywhere in the captured form or page snapshot')
    expect(code).not.toContain('submit|create|save')
    expect(code).not.toContain('.click()')
  })

  it('does not treat a non-submit-shaped captured button as the submit action', () => {
    const buttonlessForm = makeForm({ fields: makeForm().fields.filter((f) => f.role !== 'button') })
    const page = makePage({
      forms: [buttonlessForm],
      interactiveElements: [makeElement({ role: 'button', tagName: 'button', accessibleName: 'Open Menu', cssPath: 'body > nav > button' })],
    })
    const code = renderProposedAssertionSpec(page, makeAssertion({
      fieldValues: [{ fieldIndex: 0, accessibleName: 'Email', value: 'test@example.com' }],
    }))
    expect(code).not.toContain('Open Menu')
    expect(code).toContain(`.press('Enter')`)
  })

  it('emits a comment-only submit line that still parses when the form has no button and no fillable field', () => {
    const buttonlessForm = makeForm({ fields: makeForm().fields.filter((f) => f.role !== 'button') })
    const page = makePage({ forms: [buttonlessForm], interactiveElements: [] })
    const code = renderProposedAssertionSpec(page, makeAssertion({ fieldValues: [] }))
    expect(code).toContain('// No submit action generated')
    expect(code).not.toContain('.press(')
    expect(code).not.toContain('.click()')
    expect(() => assertGeneratedArtifactParses('edge.proposed.spec.ts', code)).not.toThrow()
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

  it('collapses an embedded newline in the success assertion so it stays a single commented line, not a bare injected statement', () => {
    const code = renderProposedAssertionSpec(makePage(), makeAssertion({
      successAssertionCaveat: 'Line one\nconsole.log("injected")',
    }))
    expect(code).toContain('// Line one console.log("injected")')
    expect(code).not.toMatch(/^console\.log\("injected"\)/m)
  })
})

describe('renderProposedAssertionSpec — content-presence', () => {
  function makeContentPage(overrides: Partial<CrawledPage> = {}): CrawledPage {
    return {
      url: 'https://example.com/article',
      title: 'Article',
      ariaSnapshot: '',
      links: [],
      networkLog: [],
      screenshotPath: null,
      capturedAt: new Date().toISOString(),
      pageLoadMs: null,
      interactiveElements: [
        makeElement({ role: 'link', accessibleName: 'How Treeline Works' }),
        makeElement({ role: 'link', accessibleName: 'By Jane Author', cssPath: 'body > article > .author a' }),
      ],
      axeViolations: [],
      axeIncomplete: [],
      forms: [],
      colorPalette: [],
      status: 'ok',
      ...overrides,
    }
  }

  it('wraps the generated test in test.skip', () => {
    const code = renderProposedAssertionSpec(makeContentPage(), makeContentAssertion())
    expect(code).toContain('test.skip(')
    expect(code).not.toMatch(/\btest\(/)
  })

  it('includes an AI-proposed / unverified header comment', () => {
    const code = renderProposedAssertionSpec(makeContentPage(), makeContentAssertion())
    expect(code).toContain('AI-PROPOSED TEST')
    expect(code).toContain('UNVERIFIED')
  })

  it('produces one toBeVisible() line per referenced element, using the accessibleName locator', () => {
    const code = renderProposedAssertionSpec(makeContentPage(), makeContentAssertion())
    expect(code).toContain(`await expect(page.getByRole("link", { name: "How Treeline Works" })).toBeVisible()`)
    expect(code).toContain(`await expect(page.getByRole("link", { name: "By Jane Author" })).toBeVisible()`)
  })

  it('falls back to testId then cssPath when an element has no accessibleName', () => {
    const page = makeContentPage({
      interactiveElements: [
        makeElement({ accessibleName: '', testId: 'headline', cssPath: 'body > h1' }),
        makeElement({ accessibleName: '', testId: null, cssPath: 'body > article > p:first-child' }),
      ],
    })
    const code = renderProposedAssertionSpec(page, makeContentAssertion({ elementIndices: [0, 1] }))
    expect(code).toContain(`await expect(page.getByTestId("headline")).toBeVisible()`)
    expect(code).toContain(`await expect(page.locator("body > article > p:first-child")).toBeVisible()`)
  })

  it('skips an elementIndex that is out of range against the page interactiveElements array rather than crashing', () => {
    const code = renderProposedAssertionSpec(makeContentPage(), makeContentAssertion({ elementIndices: [0, 99] }))
    const visibleLines = code.split('\n').filter((line) => line.includes('toBeVisible()'))
    expect(visibleLines).toHaveLength(1)
  })

  it('includes the assertion and its observed-element caveat as comments', () => {
    const code = renderProposedAssertionSpec(makeContentPage(), makeContentAssertion())
    expect(code).toContain('// The headline link and author link evidence this is the article page')
    expect(code).toContain('// This checks that an element treeline observed during the crawl is still present.')
  })

  it('collapses an embedded newline in the assertion caveat so it stays a single commented line, not a bare injected statement', () => {
    const code = renderProposedAssertionSpec(makeContentPage(), makeContentAssertion({
      assertionCaveat: 'Line one\nconsole.log("injected")',
    }))
    expect(code).toContain('// Line one console.log("injected")')
    expect(code).not.toMatch(/^console\.log\("injected"\)/m)
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

  it('dispatches both proposedAssertion kinds correctly across a fixture set of pages, one spec per applicable page', () => {
    const formPage = makePage({ url: 'https://example.com/signup', title: 'Signup' })
    const contentPage = makePage({
      url: 'https://example.com/article',
      title: 'Article',
      forms: [],
      colorPalette: [],
      interactiveElements: [makeElement()],
    })
    const pages = [formPage, contentPage]
    const interpretations = [
      makeInterpretation({ url: 'https://example.com/signup', proposedAssertion: makeAssertion() }),
      makeInterpretation({ url: 'https://example.com/article', proposedAssertion: makeContentAssertion({ elementIndices: [0] }) }),
    ]
    const specs = generateProposedAssertionSpecs(pages, interpretations)
    expect(specs).toHaveLength(2)
    const formSpec = specs.find((s) => s.fileName === 'signup.proposed.spec.ts')!
    const contentSpec = specs.find((s) => s.fileName === 'article.proposed.spec.ts')!
    expect(formSpec.code).toContain('.fill(')
    expect(contentSpec.code).toContain('.toBeVisible()')
  })
})
