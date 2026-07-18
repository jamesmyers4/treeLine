export interface NavMapEntry {
  label: string
  expectedUrl: string
  clickPath: string[]
  precondition?: string
}

export interface NavMapAuditResult {
  label: string
  expectedUrl: string
  observedUrl: string | null
  status: 'match' | 'mismatch' | 'skipped' | 'error'
  precondition?: string
  errorMessage?: string
  screenshotPath?: string
}

export interface VerifyRunOptions {
  navMapPath: string
  baseUrl: string
  loginUrl: string
  username: string
  password: string
  successIndicator: string
  outputDir: string
  insecureCerts?: boolean
  dismissSelector?: string
  findings?: string[]
}

export interface VerifyRunSummary {
  outputDir: string
  reportPath: string
  totalEntries: number
  matches: number
  mismatches: number
  skipped: number
  errors: number
}
