import type { CapturedForm, CapturedFormField, DomInteractiveElement } from '@treeline/acquire'
import type { ContentPresenceAssertion, FormFillAssertion, ProposedAssertion, StoredInterpretation } from '@treeline/core'
import type { CrawledPage } from './input.js'
import { assignUniqueNames } from './naming.js'
import type { GeneratedSpec } from './types.js'

const FORM_FILL_FILE_HEADER = `// AI-PROPOSED TEST — UNVERIFIED, NOT RUN AGAINST THE REAL PAGE.
// treeline never fills or submits real forms during generation; the scenario,
// fill values, and success assertion below are a model guess based only on
// the page's captured aria snapshot and form structure. Review every line
// against the real page before removing test.skip.`

const CONTENT_PRESENCE_FILE_HEADER = `// AI-PROPOSED TEST — UNVERIFIED, NOT RUN AGAINST THE REAL PAGE.
// This checks that elements treeline observed during the crawl are still
// present. It does not verify any interactive behavior. Review every line
// against the real page before removing test.skip.`

function toSafeComment(text: string): string {
  return text.replace(/\r\n|\r|\n/g, ' ')
}

function findSubmitField(form: CapturedForm | undefined): CapturedFormField | undefined {
  return form?.fields.find((field) => field.role === 'button')
}

function buildFieldLocator(field: CapturedFormField | undefined, accessibleName: string): string {
  if (!field) return `page.getByRole(${JSON.stringify('textbox')}, { name: ${JSON.stringify(accessibleName)} })`
  if (field.accessibleName.trim() !== '') {
    return `page.getByRole(${JSON.stringify(field.role)}, { name: ${JSON.stringify(field.accessibleName)} })`
  }
  if (field.testId) return `page.getByTestId(${JSON.stringify(field.testId)})`
  return `page.locator(${JSON.stringify(field.cssPath)})`
}

function buildFieldAction(field: CapturedFormField | undefined, locator: string, value: string): string {
  const role = field?.role ?? 'textbox'
  if (role === 'checkbox' || role === 'radio') return `  await ${locator}.check()`
  if (role === 'combobox' || role === 'listbox') return `  await ${locator}.selectOption(${JSON.stringify(value)})`
  return `  await ${locator}.fill(${JSON.stringify(value)})`
}

function buildSubmitLine(form: CapturedForm | undefined): string {
  const submitField = findSubmitField(form)
  if (submitField) {
    return `  await ${buildFieldLocator(submitField, submitField.accessibleName)}.click()`
  }
  return `  await page.getByRole(${JSON.stringify('button')}, { name: /submit|create|save|continue|send/i }).click()`
}

function buildContentElementLocator(element: DomInteractiveElement): string {
  if (element.accessibleName.trim() !== '') {
    return `page.getByRole(${JSON.stringify(element.role)}, { name: ${JSON.stringify(element.accessibleName)} })`
  }
  if (element.testId) return `page.getByTestId(${JSON.stringify(element.testId)})`
  return `page.locator(${JSON.stringify(element.cssPath)})`
}

function renderFormFillSpec(page: CrawledPage, assertion: FormFillAssertion): string {
  const form = page.forms[assertion.formIndex]
  const fieldLines = assertion.fieldValues
    .map((fieldValue) => ({ fieldValue, field: form?.fields[fieldValue.fieldIndex] }))
    .filter(({ field }) => field?.role !== 'button')
    .map(({ fieldValue, field }) => {
      const locator = buildFieldLocator(field, fieldValue.accessibleName)
      return buildFieldAction(field, locator, fieldValue.value)
    })
  return `${FORM_FILL_FILE_HEADER}

import { test, expect } from '@playwright/test'

test.skip(${JSON.stringify(assertion.scenario)}, async ({ page }) => {
  await page.goto(${JSON.stringify(page.url)})
${fieldLines.join('\n')}
${buildSubmitLine(form)}

  // Unverified guess — treeline has not observed this page's real post-submission behavior:
  // ${toSafeComment(assertion.successAssertion)}
  // ${toSafeComment(assertion.successAssertionCaveat)}
})
`
}

function renderContentPresenceSpec(page: CrawledPage, assertion: ContentPresenceAssertion): string {
  const elements = assertion.elementIndices
    .filter((index) => index >= 0 && index < page.interactiveElements.length)
    .map((index) => page.interactiveElements[index]!)
  const assertionLines = elements.map(
    (element) => `  await expect(${buildContentElementLocator(element)}).toBeVisible()`,
  )
  return `${CONTENT_PRESENCE_FILE_HEADER}

import { test, expect } from '@playwright/test'

test.skip(${JSON.stringify(assertion.scenario)}, async ({ page }) => {
  await page.goto(${JSON.stringify(page.url)})
${assertionLines.join('\n')}

  // Observed-at-capture-time check — not a behavioral verification:
  // ${toSafeComment(assertion.assertion)}
  // ${toSafeComment(assertion.assertionCaveat)}
})
`
}

export function renderProposedAssertionSpec(page: CrawledPage, assertion: ProposedAssertion): string {
  if (assertion.kind === 'content-presence') return renderContentPresenceSpec(page, assertion)
  return renderFormFillSpec(page, assertion)
}

export function generateProposedAssertionSpecs(pages: CrawledPage[], interpretations: StoredInterpretation[]): GeneratedSpec[] {
  const capturedPages = pages.filter((p) => p.title !== null && p.ariaSnapshot !== null && p.capturedAt !== null)
  const interpretationsByUrl = new Map(interpretations.map((interpretation) => [interpretation.url, interpretation]))
  const { assignments } = assignUniqueNames(capturedPages.map((p) => p.url))
  const specs: GeneratedSpec[] = []
  for (const page of capturedPages) {
    const proposedAssertion = interpretationsByUrl.get(page.url)?.proposedAssertion
    if (!proposedAssertion) continue
    const assigned = assignments.get(page.url)!
    specs.push({
      fileName: `${assigned.fileBaseName}.proposed.spec.ts`,
      code: renderProposedAssertionSpec(page, proposedAssertion),
    })
  }
  return specs
}
