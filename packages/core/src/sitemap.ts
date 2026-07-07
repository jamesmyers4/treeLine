export async function fetchSitemapUrls(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/sitemap.xml`)
    if (!res.ok) return []
    const text = await res.text()
    const matches = text.matchAll(/<loc>\s*(.*?)\s*<\/loc>/g)
    return Array.from(matches, (m) => m[1])
  } catch {
    return []
  }
}
