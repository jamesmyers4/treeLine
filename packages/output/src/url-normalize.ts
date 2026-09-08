const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DIGIT_RUN = /\d{4,}/

function isTokenLikeSegment(segment: string): boolean {
  if (segment.length === 0) return false
  if (UUID_SEGMENT.test(segment)) return true
  if (DIGIT_RUN.test(segment)) return true
  if (!/^[a-z0-9_-]{6,}$/i.test(segment)) return false
  const subSegments = segment.split(/[-_]/).filter((s) => s.length > 0)
  return !subSegments.every((s) => /^[a-z]+$/i.test(s))
}

export function normalizeApiPath(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => (isTokenLikeSegment(segment) ? '{id}' : segment))
    .join('/')
}

export function normalizeApiSurfaceUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl)
    parsed.pathname = normalizeApiPath(parsed.pathname)
    for (const key of Array.from(parsed.searchParams.keys())) {
      const value = parsed.searchParams.get(key)
      if (value !== null && isTokenLikeSegment(value)) parsed.searchParams.set(key, '{id}')
    }
    parsed.searchParams.sort()
    return parsed.toString().replace(/%7Bid%7D/g, '{id}')
  } catch {
    return rawUrl
  }
}
