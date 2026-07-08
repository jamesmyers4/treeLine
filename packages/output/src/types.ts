export type LocatorStrategy = 'role' | 'testid' | 'css' | 'xpath'

export interface SelectorCandidate {
  strategy: LocatorStrategy
  value: string
  stable: boolean
  uniqueOnPage: boolean
}

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
