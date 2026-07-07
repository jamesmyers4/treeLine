import type { PageState } from '@treeline/acquire'
import type { TierRoutingDecision } from './types.js'

const INTERACTIVE_ROLE_THRESHOLD = 8
const SNAPSHOT_LENGTH_THRESHOLD = 4000
const INTERACTIVE_ROLES = ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'menuitem']

export function decideTier(pageState: PageState): TierRoutingDecision {
  const snapshot = pageState.ariaSnapshot.toLowerCase()
  const count = INTERACTIVE_ROLES.reduce((acc, role) => {
    const matches = snapshot.match(new RegExp(role, 'g'))
    return acc + (matches ? matches.length : 0)
  }, 0)
  if (count < INTERACTIVE_ROLE_THRESHOLD && pageState.ariaSnapshot.length < SNAPSHOT_LENGTH_THRESHOLD) {
    return { tier: 'haiku', reason: `${count} interactive roles, snapshot ${pageState.ariaSnapshot.length} chars` }
  }
  return { tier: 'sonnet', reason: `${count} interactive roles, snapshot ${pageState.ariaSnapshot.length} chars` }
}
