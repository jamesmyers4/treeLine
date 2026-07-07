export type InterpretationTier = 'haiku' | 'sonnet'

export interface TierRoutingDecision {
  tier: InterpretationTier
  reason: string
}

export interface PageInterpretation {
  url: string
  tierUsed: InterpretationTier
  pageType: string
  purpose: string
  confidence: number
}
