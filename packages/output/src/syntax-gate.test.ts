import { describe, it, expect } from 'vitest'
import { assertGeneratedArtifactParses, collectSyntaxDiagnostics, GeneratedArtifactSyntaxError } from './syntax-gate.js'

const VALID_POM = `import { Page, Locator } from '@playwright/test'

export class HomePage {
  readonly page: Page
  readonly submitButton: Locator

  constructor(page: Page) {
    this.page = page
    this.submitButton = page.getByRole("button", { name: "Submit" })
  }

  async goto(): Promise<void> {
    await this.page.goto("https://example.com/")
  }
}
`

const VALID_PROPOSED_SPEC = `// AI-PROPOSED TEST — UNVERIFIED, NOT RUN AGAINST THE REAL PAGE.

import { test, expect } from '@playwright/test'

test.skip("submits the contact form", async ({ page }) => {
  await page.goto("https://example.com/contact")
  await page.getByRole("textbox", { name: "Email" }).fill("test@example.com")
  await page.getByRole("button", { name: "Send" }).click()

  // Unverified guess — treeline has not observed this page's real post-submission behavior:
  // a confirmation message appears
})
`

const DIGIT_IDENTIFIER_POM = `import { Page, Locator } from '@playwright/test'

export class HomePage {
  readonly page: Page
  readonly 3MinutesAgoLink1: Locator

  constructor(page: Page) {
    this.page = page
    this.3MinutesAgoLink1 = page.getByRole("link", { name: "3 minutes ago" })
  }
}
`

const DIGIT_CLASS_NAME_POM = `import { Page, Locator } from '@playwright/test'

export class 3dPrintersPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }
}
`

const COMMENT_BREAKOUT_SPEC = `import { test, expect } from '@playwright/test'

test.skip("fills the form", async ({ page }) => {
  await page.goto("https://example.com/")

  // Unverified guess:
  the page shows a confirmation banner after submitting
})
`

const UNBALANCED_TOKENS_SPEC = `import { test, expect } from '@playwright/test'

test.skip("loads", async ({ page }) => {
  await page.goto("https://example.com/"
})
`

describe('collectSyntaxDiagnostics', () => {
  it('returns no diagnostics for a valid generated POM', () => {
    expect(collectSyntaxDiagnostics('home.page.ts', VALID_POM)).toEqual([])
  })

  it('returns no diagnostics for a valid proposed spec', () => {
    expect(collectSyntaxDiagnostics('contact.proposed.spec.ts', VALID_PROPOSED_SPEC)).toEqual([])
  })

  it('reports a digit-leading property name as a syntax error', () => {
    expect(collectSyntaxDiagnostics('home.page.ts', DIGIT_IDENTIFIER_POM).length).toBeGreaterThan(0)
  })

  it('reports a digit-leading class name as a syntax error', () => {
    expect(collectSyntaxDiagnostics('3d-printers.page.ts', DIGIT_CLASS_NAME_POM).length).toBeGreaterThan(0)
  })

  it('reports comment-breakout freeform text as a syntax error', () => {
    expect(collectSyntaxDiagnostics('home.proposed.spec.ts', COMMENT_BREAKOUT_SPEC).length).toBeGreaterThan(0)
  })

  it('reports unbalanced tokens as a syntax error', () => {
    expect(collectSyntaxDiagnostics('home.spec.ts', UNBALANCED_TOKENS_SPEC).length).toBeGreaterThan(0)
  })
})

describe('assertGeneratedArtifactParses', () => {
  it('returns normally for valid generated code', () => {
    expect(() => assertGeneratedArtifactParses('home.page.ts', VALID_POM)).not.toThrow()
  })

  it('throws GeneratedArtifactSyntaxError naming the file and including a diagnostic', () => {
    let caught: unknown
    try {
      assertGeneratedArtifactParses('home.page.ts', DIGIT_IDENTIFIER_POM)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(GeneratedArtifactSyntaxError)
    const error = caught as GeneratedArtifactSyntaxError
    expect(error.fileName).toBe('home.page.ts')
    expect(error.diagnostics.length).toBeGreaterThan(0)
    expect(error.message).toContain('home.page.ts')
    expect(error.message).toContain('treeline bug')
    expect(error.message).toMatch(/line \d+, column \d+/)
  })
})
