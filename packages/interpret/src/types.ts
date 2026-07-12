import type { ProposedAssertion } from '@treeline/core'

export type { ProposedAssertion, ProposedFormFieldValue, FormFillAssertion, ContentPresenceAssertion } from '@treeline/core'

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
  keyDataEntities: string[]
  confidence: number
  proposedAssertion: ProposedAssertion | null
}
