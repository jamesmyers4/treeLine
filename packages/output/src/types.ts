export type { LocatorStrategy, SelectorCandidate } from '@treeline/core'
import type { HardPageEntry, SelectorCandidate } from '@treeline/core'
import type { CapturedForm } from '@treeline/acquire'

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

export interface PomFileNameCollision {
  baseFileName: string
  urls: string[]
}

export interface POMGenerationResult {
  poms: GeneratedPOM[]
  specs: GeneratedSpec[]
  skipped: SkippedElement[]
  collisions: PomFileNameCollision[]
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

export interface PageFormsEntry {
  url: string
  forms: CapturedForm[]
}

export interface ApiSurfaceEntry {
  method: string
  url: string
  occurrenceCount: number
  samplePages: string[]
  totalPageCount: number
}

export interface FlowMap {
  generatedAt: string
  pagesWithForms: number
  totalForms: number
  distinctApiEndpoints: number
  forms: PageFormsEntry[]
  apiSurface: ApiSurfaceEntry[]
}

export interface PageCoverageEntry {
  url: string
  totalInteractive: number
  skippedCount: number
  skipPercent: number
}

export interface FormTestGap {
  url: string
  formIndex: number
  action: string
  method: string
  fieldCount: number
}

export interface CoverageReport {
  generatedAt: string
  zeroCoveragePages: PageCoverageEntry[]
  highSkipPages: PageCoverageEntry[]
  formsWithoutTest: FormTestGap[]
  unresolvedHardPages: HardPageEntry[]
  pagesExcludedFromCoverage: string[]
}
