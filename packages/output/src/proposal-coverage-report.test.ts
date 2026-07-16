import { describe, it, expect } from 'vitest'
import type { DomInteractiveElement, CapturedForm } from '@treeline/acquire'
import type { StoredInterpretation } from '@treeline/core'
import type { CrawledPage } from './input.js'
import { generateProposalCoverageReport, renderProposalCoverageReportMarkdown } from './proposal-coverage-report.js'

function makeElement(overrides: Partial<DomInteractiveElement>): DomInteractiveElement {
  return {
    role: 'button',
    accessibleName: 'Submit',
    testId: null,
    tagName: 'button',
    elementId: null,
    classList: [],
    cssPath: 'body > button',
    xpath: '/html/body/button',
    appearedAtMs: null,
    ...overrides,
  }
}

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
    status: 'ok',
    ...overrides,
  }
}

function makeInterpretation(overrides: Partial<StoredInterpretation>): StoredInterpretation {
  return {
    url: 'https://example.com',
    tierUsed: 'haiku',
    pageType: 'content',
    purpose: 'Test purpose',
    keyDataEntities: [],
    confidence: 0.9,
    interpretedAt: new Date().toISOString(),
    proposedAssertion: null,
    ...overrides,
  }
}

describe('generateProposalCoverageReport', () => {
  it('buckets a page with a form-fill proposal into formFillProposals', () => {
    const page = makePage({ url: 'https://example.com/signup', forms: [makeForm({})] })
    const interpretation = makeInterpretation({
      url: 'https://example.com/signup',
      proposedAssertion: {
        kind: 'form-fill',
        scenario: 'Fill out and submit the signup form',
        formIndex: 0,
        fieldValues: [],
        successAssertion: 'A confirmation appears',
        successAssertionCaveat: 'unverified guess',
      },
    })
    const report = generateProposalCoverageReport([page], [interpretation])
    expect(report.formFillProposals).toEqual([{ url: 'https://example.com/signup', scenario: 'Fill out and submit the signup form' }])
    expect(report.contentPresenceProposals).toHaveLength(0)
    expect(report.formsWithoutProposal).toHaveLength(0)
    expect(report.contentEligibleWithoutProposal).toHaveLength(0)
    expect(report.noEligibleElements).toHaveLength(0)
  })

  it('buckets a page with a content-presence proposal into contentPresenceProposals', () => {
    const page = makePage({ url: 'https://example.com/about', interactiveElements: [makeElement({})] })
    const interpretation = makeInterpretation({
      url: 'https://example.com/about',
      proposedAssertion: {
        kind: 'content-presence',
        scenario: 'Confirm the nav link is present',
        elementIndices: [0],
        assertion: 'The link evidences navigation',
        assertionCaveat: 'observed at capture time',
      },
    })
    const report = generateProposalCoverageReport([page], [interpretation])
    expect(report.contentPresenceProposals).toEqual([{ url: 'https://example.com/about', scenario: 'Confirm the nav link is present' }])
    expect(report.formFillProposals).toHaveLength(0)
  })

  it('buckets a page with a form and no proposal into formsWithoutProposal', () => {
    const page = makePage({ url: 'https://example.com/search', forms: [makeForm({}), makeForm({ formIndex: 1 })] })
    const report = generateProposalCoverageReport([page], [])
    expect(report.formsWithoutProposal).toEqual([{ url: 'https://example.com/search', formCount: 2 }])
  })

  it('buckets a form-less page with interactive elements and no proposal into contentEligibleWithoutProposal', () => {
    const page = makePage({ url: 'https://example.com/nav', interactiveElements: [makeElement({}), makeElement({})] })
    const report = generateProposalCoverageReport([page], [])
    expect(report.contentEligibleWithoutProposal).toEqual([{ url: 'https://example.com/nav', interactiveElementCount: 2 }])
  })

  it('buckets a page with no forms, no interactive elements, and no proposal into noEligibleElements rather than dropping it', () => {
    const page = makePage({ url: 'https://example.com/static' })
    const report = generateProposalCoverageReport([page], [])
    expect(report.noEligibleElements).toEqual(['https://example.com/static'])
    expect(report.formsWithoutProposal).toHaveLength(0)
    expect(report.contentEligibleWithoutProposal).toHaveLength(0)
  })

  it('excludes pages that never completed capture from every category', () => {
    const failedPage = makePage({ url: 'https://example.com/broken', title: null, ariaSnapshot: null, capturedAt: null })
    const report = generateProposalCoverageReport([failedPage], [])
    expect(report.formFillProposals).toHaveLength(0)
    expect(report.contentPresenceProposals).toHaveLength(0)
    expect(report.formsWithoutProposal).toHaveLength(0)
    expect(report.contentEligibleWithoutProposal).toHaveLength(0)
    expect(report.noEligibleElements).toHaveLength(0)
  })

  it('places every captured page into exactly one category across a mixed fixture set', () => {
    const formFillPage = makePage({ url: 'https://example.com/signup', forms: [makeForm({})] })
    const contentPresencePage = makePage({ url: 'https://example.com/about', interactiveElements: [makeElement({})] })
    const formGapPage = makePage({ url: 'https://example.com/search', forms: [makeForm({})] })
    const contentGapPage = makePage({ url: 'https://example.com/nav', interactiveElements: [makeElement({})] })
    const staticPage = makePage({ url: 'https://example.com/static' })
    const interpretations = [
      makeInterpretation({
        url: 'https://example.com/signup',
        proposedAssertion: {
          kind: 'form-fill',
          scenario: 'Fill out and submit',
          formIndex: 0,
          fieldValues: [],
          successAssertion: 'ok',
          successAssertionCaveat: 'unverified',
        },
      }),
      makeInterpretation({
        url: 'https://example.com/about',
        proposedAssertion: {
          kind: 'content-presence',
          scenario: 'Confirm content',
          elementIndices: [0],
          assertion: 'ok',
          assertionCaveat: 'observed',
        },
      }),
    ]
    const report = generateProposalCoverageReport(
      [formFillPage, contentPresencePage, formGapPage, contentGapPage, staticPage],
      interpretations,
    )
    expect(report.formFillProposals).toHaveLength(1)
    expect(report.contentPresenceProposals).toHaveLength(1)
    expect(report.formsWithoutProposal).toHaveLength(1)
    expect(report.contentEligibleWithoutProposal).toHaveLength(1)
    expect(report.noEligibleElements).toHaveLength(1)
  })
})

describe('renderProposalCoverageReportMarkdown', () => {
  it('renders headings and a summary count line', () => {
    const page = makePage({ url: 'https://example.com/static' })
    const report = generateProposalCoverageReport([page], [])
    const markdown = renderProposalCoverageReportMarkdown(report)
    expect(markdown).toContain('# Proposal Coverage Report')
    expect(markdown).toContain('## Pages with a proposed assertion')
    expect(markdown).toContain('## Forms without a proposal')
    expect(markdown).toContain('## Content-eligible pages without a proposal')
    expect(markdown).toContain('## Pages with no eligible elements')
    expect(markdown).toContain('1 pages total')
    expect(markdown).toContain('https://example.com/static')
  })

  it('renders a valid report with populated gap tables even when nothing generated any proposal', () => {
    const formGapPage = makePage({ url: 'https://example.com/search', forms: [makeForm({})] })
    const contentGapPage = makePage({ url: 'https://example.com/nav', interactiveElements: [makeElement({})] })
    const report = generateProposalCoverageReport([formGapPage, contentGapPage], [])
    const markdown = renderProposalCoverageReportMarkdown(report)
    expect(markdown).toContain('None found.')
    expect(markdown).toContain('https://example.com/search')
    expect(markdown).toContain('https://example.com/nav')
    expect(markdown).not.toContain('undefined')
  })

  it('escapes a pipe and strips a newline in a URL or scenario so a table row is not corrupted', () => {
    const page = makePage({ url: 'https://example.com/a|b', forms: [makeForm({})] })
    const interpretation = makeInterpretation({
      url: 'https://example.com/a|b',
      proposedAssertion: {
        kind: 'form-fill',
        scenario: 'Fill out the form\nthen submit | confirm',
        formIndex: 0,
        fieldValues: [],
        successAssertion: 'ok',
        successAssertionCaveat: 'unverified',
      },
    })
    const report = generateProposalCoverageReport([page], [interpretation])
    const markdown = renderProposalCoverageReportMarkdown(report)
    const tableLine = markdown.split('\n').find((line) => line.includes('Form Fill'))!
    expect(tableLine).toContain('https://example.com/a\\|b')
    expect(tableLine).not.toMatch(/\n/)
    expect(tableLine).toContain('Fill out the form then submit \\| confirm')
  })

  it('truncates a very long scenario string in the proposals table', () => {
    const longScenario = 'x'.repeat(300)
    const page = makePage({ url: 'https://example.com/long', forms: [makeForm({})] })
    const interpretation = makeInterpretation({
      url: 'https://example.com/long',
      proposedAssertion: {
        kind: 'form-fill',
        scenario: longScenario,
        formIndex: 0,
        fieldValues: [],
        successAssertion: 'ok',
        successAssertionCaveat: 'unverified',
      },
    })
    const report = generateProposalCoverageReport([page], [interpretation])
    const markdown = renderProposalCoverageReportMarkdown(report)
    expect(markdown).not.toContain(longScenario)
    expect(markdown).toContain('…')
  })
})
