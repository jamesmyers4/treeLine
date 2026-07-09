export interface CrawlConfig {
  seedUrl: string
  sameOriginOnly: boolean
  maxDepth: number
  maxPages: number
  stealth: boolean
  respectRobotsTxt: boolean
  throttleMs?: number
}

export type HardPageReasonCode =
  | 'empty-snapshot'
  | 'timeout'
  | 'auth-wall'
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
}

export interface StoredInterpretation {
  url: string
  tierUsed: string
  pageType: string
  purpose: string
  keyDataEntities: string[]
  confidence: number
  interpretedAt: string
}
