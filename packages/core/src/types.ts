export interface CrawlConfig {
  seedUrl: string
  sameOriginOnly: boolean
  maxDepth: number
  maxPages: number
  stealth: boolean
  respectRobotsTxt: boolean
  throttleMs?: number
  captureResponseBodies?: boolean
  maxResponseBodyBytes?: number
  detectAuthWall?: boolean
  insecureCerts?: boolean
}

export type HardPageReasonCode =
  | 'empty-snapshot'
  | 'timeout'
  | 'auth-wall'
  | 'auth-expired'
  | 'low-confidence'
  | 'parse-error'

export interface HardPageEntry {
  url: string
  reasonCode: HardPageReasonCode
  attemptedAt: string
  captureSnapshot: string | null
}

export interface HostnameMismatch {
  source: 'sitemap' | 'canonical'
  hostname: string
  url: string
}

export interface CrawlResult {
  hostnameMismatches: HostnameMismatch[]
  abortedAt?: { url: string; reason: 'auth-expired' }
}

export interface ProposedFormFieldValue {
  fieldIndex: number
  accessibleName: string
  value: string
}

export interface FormFillAssertion {
  kind: 'form-fill'
  scenario: string
  formIndex: number
  fieldValues: ProposedFormFieldValue[]
  successAssertion: string
  successAssertionCaveat: string
}

export interface ContentPresenceAssertion {
  kind: 'content-presence'
  scenario: string
  elementIndices: number[]
  assertion: string
  assertionCaveat: string
}

export type ProposedAssertion = FormFillAssertion | ContentPresenceAssertion

export interface StoredInterpretation {
  url: string
  tierUsed: string
  pageType: string
  purpose: string
  keyDataEntities: string[]
  confidence: number
  interpretedAt: string
  proposedAssertion: ProposedAssertion | null
}
