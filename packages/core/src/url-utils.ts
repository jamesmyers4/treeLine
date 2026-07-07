export function normalizeUrl(url: string): string {
  const parsed = new URL(url)
  parsed.hash = ''
  parsed.searchParams.sort()
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1)
  }
  return parsed.toString()
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
