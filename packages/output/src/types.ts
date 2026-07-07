export type LocatorStrategy = 'role' | 'testid' | 'css' | 'xpath'

export interface SelectorCandidate {
  strategy: LocatorStrategy
  value: string
  stable: boolean
}

export interface SelectorReportEntry {
  url: string
  elementDescription: string
  candidates: SelectorCandidate[]
}
