import { resolveSeedUrl, resolveSeedUrlWithBrowser, SeedAuthenticationError } from '@treeline/acquire'
import type { AuthSession, Browser } from '@treeline/acquire'
import type { HostnameMismatch } from './types.js'

export interface SeedFetchOptions {
  insecureCerts?: boolean
  headless?: boolean
  stealth?: boolean
  getBrowser?: () => Promise<Browser>
}

export async function fetchSeedPage(seedUrl: string, authSession?: AuthSession, options: SeedFetchOptions = {}): Promise<{ resolvedUrl: string; html: string | null }> {
  if (authSession) {
    const acquireOptions = { authSession, insecureCerts: options.insecureCerts, headless: options.headless, stealth: options.stealth }
    try {
      return options.getBrowser
        ? await resolveSeedUrlWithBrowser(seedUrl, await options.getBrowser(), acquireOptions)
        : await resolveSeedUrl(seedUrl, acquireOptions)
    } catch (err) {
      if (err instanceof SeedAuthenticationError) throw err
      return { resolvedUrl: seedUrl, html: null }
    }
  }
  try {
    const res = await fetch(seedUrl, { redirect: 'follow' })
    const html = res.ok ? await res.text() : null
    return { resolvedUrl: res.url || seedUrl, html }
  } catch {
    return { resolvedUrl: seedUrl, html: null }
  }
}

export function findCanonicalHref(html: string): string | null {
  const tagMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)
  if (!tagMatch) return null
  const hrefMatch = tagMatch[0].match(/href=["']([^"']+)["']/i)
  return hrefMatch ? hrefMatch[1] : null
}

export function detectHostnameMismatches(
  resolvedSeedUrl: string,
  sitemapUrls: string[],
  canonicalUrl: string | null,
): HostnameMismatch[] {
  const seedHostname = new URL(resolvedSeedUrl).hostname
  const seenHostnames = new Set<string>()
  const mismatches: HostnameMismatch[] = []
  for (const sUrl of sitemapUrls) {
    try {
      const hostname = new URL(sUrl).hostname
      if (hostname !== seedHostname && !seenHostnames.has(hostname)) {
        seenHostnames.add(hostname)
        mismatches.push({ source: 'sitemap', hostname, url: sUrl })
      }
    } catch {
      // skip invalid
    }
  }
  if (canonicalUrl) {
    try {
      const hostname = new URL(canonicalUrl).hostname
      if (hostname !== seedHostname && !seenHostnames.has(hostname)) {
        seenHostnames.add(hostname)
        mismatches.push({ source: 'canonical', hostname, url: canonicalUrl })
      }
    } catch {
      // skip invalid
    }
  }
  return mismatches
}
