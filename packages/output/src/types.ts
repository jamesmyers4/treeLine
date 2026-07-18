export type { LocatorStrategy, SelectorCandidate } from '@treeline/core'
import type { HardPageEntry, SelectorCandidate } from '@treeline/core'
import type { CapturedForm, ColorSwatch } from '@treeline/acquire'

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
  responseBodySample: string | null
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

export interface SlowPageEntry {
  url: string
  pageLoadMs: number
  overThreshold: boolean
}

export interface SlowNetworkRequestEntry {
  pageUrl: string
  requestUrl: string
  method: string
  durationMs: number
  overThreshold: boolean
}

export interface LateAppearingElementEntry {
  pageUrl: string
  role: string
  accessibleName: string
  appearedAtMs: number
  overThreshold: boolean
}

export interface TimingReport {
  generatedAt: string
  pagesAnalyzed: number
  pageLoadThresholdMs: number
  networkRequestThresholdMs: number
  appearanceThresholdMs: number
  flaggedPageCount: number
  flaggedNetworkRequestCount: number
  flaggedElementCount: number
  slowestPages: SlowPageEntry[]
  slowestNetworkRequests: SlowNetworkRequestEntry[]
  slowestAppearingElements: LateAppearingElementEntry[]
}

export interface ProposalEntry {
  url: string
  scenario: string
}

export interface FormsWithoutProposalEntry {
  url: string
  formCount: number
}

export interface ContentEligibleWithoutProposalEntry {
  url: string
  interactiveElementCount: number
}

export interface ProposalCoverageReport {
  generatedAt: string
  formFillProposals: ProposalEntry[]
  contentPresenceProposals: ProposalEntry[]
  formsWithoutProposal: FormsWithoutProposalEntry[]
  contentEligibleWithoutProposal: ContentEligibleWithoutProposalEntry[]
  noEligibleElements: string[]
}

export interface PageColorEntry {
  url: string
  swatches: ColorSwatch[]
}

export interface AggregatedColorEntry {
  hex: string
  property: 'color' | 'background-color'
  totalUsageCount: number
  pageCount: number
}

export interface ColorReport {
  generatedAt: string
  pages: PageColorEntry[]
  siteWideScheme: AggregatedColorEntry[]
}

export type CaptureFieldStatus = 'captured' | 'not-applicable' | 'not-captured'

export interface ApiTestScaffoldRequestFields {
  status: CaptureFieldStatus
  fields: string[]
  note: string | null
}

export interface ApiTestScaffoldResponseSchema {
  status: CaptureFieldStatus
  schema: Record<string, string> | null
  note: string | null
}

export interface ApiTestScaffoldEntry {
  method: string
  endpoint: string
  queryParams: Record<string, string>
  requiresAuth: boolean
  requestFields: ApiTestScaffoldRequestFields
  responseSchema: ApiTestScaffoldResponseSchema
  schemaHints: string[]
}

export interface ApiTestScaffoldReport {
  generatedAt: string
  captureRequestBodies: boolean
  captureResponseBodies: boolean
  entries: ApiTestScaffoldEntry[]
}
