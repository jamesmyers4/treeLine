export type { LocatorStrategy, SelectorCandidate } from '@treeline/core'
import type { SelectorCandidate } from '@treeline/core'

export interface SelectorReportEntry {
  url: string
  elementDescription: string
  candidates: SelectorCandidate[]
}

export interface PageSelectorReport {
  url: string
  entries: SelectorReportEntry[]
}

export interface SelectorReport {
  generatedAt: string
  pages: PageSelectorReport[]
}

export interface TestIdGapEntry {
  url: string
  role: string
  accessibleName: string
}

export interface PageTestIdCoverage {
  url: string
  totalInteractive: number
  withTestId: number
  coveragePercent: number
  gaps: TestIdGapEntry[]
}

export interface TestIdAuditReport {
  generatedAt: string
  pages: PageTestIdCoverage[]
  overallCoveragePercent: number
}

export interface PageAtlasEntry {
  url: string
  title: string
  pageType: string | null
  purpose: string | null
  keyDataEntities: string[]
  confidence: number | null
  interactiveElementCount: number
  testIdCount: number
  interpreted: boolean
}

export interface SiteAtlas {
  generatedAt: string
  pages: PageAtlasEntry[]
  totalPagesCaptured: number
  totalPagesInterpreted: number
}

export interface SkippedElement {
  url: string
  elementDescription: string
  reason: string
}

export interface GeneratedPOM {
  className: string
  fileName: string
  code: string
}

export interface GeneratedSpec {
  fileName: string
  code: string
}

export interface POMGenerationResult {
  poms: GeneratedPOM[]
  specs: GeneratedSpec[]
  skipped: SkippedElement[]
}

export interface AxeFindingSummary {
  id: string
  impact: string | null
  help: string
  helpUrl: string
  affectedElementCount: number
  exampleSelector: string
}

export interface PageAxeReport {
  url: string
  violations: AxeFindingSummary[]
  needsReview: AxeFindingSummary[]
}

export interface AxeReport {
  generatedAt: string
  pages: PageAxeReport[]
  totalViolations: number
  totalNeedsReview: number
}
