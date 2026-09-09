import { createHash } from 'node:crypto'

export function normalizeUrl(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ''
  parsed.searchParams.sort()
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1)
  }
  return parsed.toString()
}

export function urlHash(url: string): string {
  return createHash('sha1').update(normalizeUrl(url)).digest('hex').slice(0, 12)
}

export function isSameOrigin(seedUrl: string, candidateUrl: string): boolean {
  try {
    const seed = new URL(seedUrl)
    const candidate = new URL(candidateUrl)
    return seed.origin === candidate.origin
  } catch {
    return false
  }
}

export function isUrlDenied(url: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false
  return patterns.some((pattern) => url.includes(pattern))
}

// Heuristic only, not a block — a warning surface for the real GET-mutation risk (CLAUDE.md's
// "Operational gotchas"). --deny-url-pattern remains the only thing that actually stops a
// crawl from reaching a URL; this just flags a query string that *looks* state-changing so an
// operator who didn't already know to write a deny pattern still gets a signal.
const SUSPICIOUS_ACTION_VERBS = ['delete', 'disable', 'remove', 'deactivate']

export function detectSuspiciousActionVerb(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  for (const [key, value] of parsed.searchParams) {
    const lowerKey = key.toLowerCase()
    const lowerValue = value.toLowerCase()
    for (const verb of SUSPICIOUS_ACTION_VERBS) {
      if (lowerKey.includes(verb) || lowerValue.includes(verb)) return verb
    }
  }
  return null
}
