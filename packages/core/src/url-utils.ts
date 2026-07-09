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
