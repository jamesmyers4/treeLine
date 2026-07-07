export type InterpretationTier = 'haiku' | 'sonnet'

export interface TierRoutingDecision {
  tier: InterpretationTier
  reason: string
}

export interface InteractiveElement {
  role: string
  accessibleName: string
  purpose: string
  testIdPresent: boolean
}

export interface PageInterpretation {
  url: string
  tierUsed: InterpretationTier
  pageType: string
  purpose: string
  interactiveElements: InteractiveElement[]
  keyDataEntities: string[]
  confidence: number
}
