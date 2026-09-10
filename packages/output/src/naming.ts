import type { DomInteractiveElement } from '@treeline/acquire'
import { normalizeUrl } from '@treeline/core'
import type { PomFileNameCollision } from './types.js'

export function capitalize(word: string): string {
  if (word.length === 0) return word
  return word[0]!.toUpperCase() + word.slice(1)
}

function lowerFirst(word: string): string {
  if (word.length === 0) return word
  return word[0]!.toLowerCase() + word.slice(1)
}

export function sanitizeIdentifier(name: string): string {
  return /^[0-9]/.test(name) ? `_${name}` : name
}

function getPathname(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

// Strips any trailing file-extension-shaped suffix (.html, .php, .aspx, ...), not just .html —
// a real crawl target can serve any server-side extension, and leaving one in place either
// glues onto the next word unreadably or, worse, survives as a literal "." in a generated class
// name, which is not valid TypeScript identifier syntax (caught by the syntax gate, not by any
// type check, since generated code isn't type-checked against this repo's own tsconfig).
function stripTrailingExtension(pathname: string): string {
  return pathname.replace(/\.[a-zA-Z0-9]+$/, '')
}

function pathSegments(url: string): string[] {
  const pathname = getPathname(url)
  const trimmed = stripTrailingExtension(pathname.replace(/^\//, ''))
  return trimmed
    .split(/[/-]/)
    .map((segment) => segment.replace(/[^a-zA-Z0-9_]/g, ''))
    .filter((segment) => segment.length > 0)
}

export function urlToClassName(url: string): string {
  const pathname = getPathname(url)
  if (pathname === '/' || pathname === '') return 'HomePage'
  const words = pathSegments(url).map(capitalize)
  return sanitizeIdentifier(`${words.join('')}Page`)
}

export function urlToFileBaseName(url: string): string {
  const pathname = getPathname(url)
  if (pathname === '/' || pathname === '') return 'home'
  const trimmed = stripTrailingExtension(pathname.replace(/^\//, ''))
  return trimmed
    .split('/')
    .map((segment) => segment.replace(/[^a-zA-Z0-9_-]/g, ''))
    .filter((segment) => segment.length > 0)
    .join('-')
    .toLowerCase()
}

export function elementToPropertyName(element: DomInteractiveElement): string {
  const name = element.accessibleName.trim()
  if (name !== '') {
    const cleaned = name.replace(/[^a-zA-Z0-9]+/g, ' ').trim()
    const words = cleaned.split(/\s+/).filter((word) => word.length > 0)
    const camelName = words.map((word, i) => (i === 0 ? lowerFirst(word) : capitalize(word))).join('')
    return sanitizeIdentifier(`${camelName}${capitalize(element.role)}`)
  }
  return `${lowerFirst(element.role)}${capitalize(element.tagName)}`
}

export interface AssignedPageName {
  url: string
  className: string
  fileBaseName: string
}

export function assignUniqueNames(urls: string[]): { assignments: Map<string, AssignedPageName>; collisions: PomFileNameCollision[] } {
  const groups = new Map<string, string[]>()
  for (const url of urls) {
    const base = urlToFileBaseName(url)
    const group = groups.get(base)
    if (group) group.push(url)
    else groups.set(base, [url])
  }
  const collisions: PomFileNameCollision[] = []
  const assignments = new Map<string, AssignedPageName>()
  for (const [base, groupUrls] of groups) {
    if (groupUrls.length === 1) {
      const url = groupUrls[0]!
      assignments.set(url, { url, className: urlToClassName(url), fileBaseName: base })
      continue
    }
    const sortedUrls = [...groupUrls].sort((a, b) => normalizeUrl(a).localeCompare(normalizeUrl(b)))
    collisions.push({ baseFileName: base, urls: sortedUrls })
    sortedUrls.forEach((url, index) => {
      const suffix = index + 1
      assignments.set(url, { url, className: `${urlToClassName(url)}${suffix}`, fileBaseName: `${base}${suffix}` })
    })
  }
  return { assignments, collisions }
}

export function deduplicatePropertyNames(names: string[]): string[] {
  const counts = new Map<string, number>()
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1)
  const seen = new Map<string, number>()
  return names.map((name) => {
    const total = counts.get(name)!
    if (total === 1) return name
    const next = (seen.get(name) ?? 0) + 1
    seen.set(name, next)
    return `${name}${next}`
  })
}

function hrefSuffixWords(href: string): string[] {
  return pathSegments(href).map(capitalize)
}

export interface PropertyNameCandidate {
  propertyName: string
  href: string | null
}

// Disambiguates same-text/different-destination links (e.g. two "Read more" links on a blog
// index, each pointing at a different article) by the real destination instead of a blind
// occurrence-order number — readMoreLinkArticle1/readMoreLinkArticle2 rather than
// readMoreLink1/readMoreLink2. Falls back to the plain numeric suffix whenever destination-based
// naming genuinely can't help: any element in the colliding group has no href (not a link, or an
// href-less anchor never matched by the capture selector), every href in the group normalizes to
// the same real destination (nothing to disambiguate by), or two different hrefs happen to
// produce the same derived words (e.g. both resolve to "/") — that residual collision still gets
// a numeric suffix on top, so uniqueness is always guaranteed regardless of URL shape.
export function deduplicatePropertyNamesWithHref(entries: PropertyNameCandidate[]): string[] {
  const groups = new Map<string, number[]>()
  entries.forEach((entry, index) => {
    const indices = groups.get(entry.propertyName)
    if (indices) indices.push(index)
    else groups.set(entry.propertyName, [index])
  })
  const result = new Array<string>(entries.length)
  for (const indices of groups.values()) {
    if (indices.length === 1) {
      result[indices[0]!] = entries[indices[0]!]!.propertyName
      continue
    }
    const allHaveHref = indices.every((i) => entries[i]!.href !== null)
    const distinctHrefs = allHaveHref ? new Set(indices.map((i) => normalizeUrl(entries[i]!.href!))) : null
    if (!allHaveHref || distinctHrefs!.size === 1) {
      indices.forEach((i, order) => {
        result[i] = `${entries[i]!.propertyName}${order + 1}`
      })
      continue
    }
    const usedCounts = new Map<string, number>()
    for (const i of indices) {
      const baseName = entries[i]!.propertyName
      const words = hrefSuffixWords(entries[i]!.href!)
      const candidate = words.length > 0 ? sanitizeIdentifier(`${baseName}${words.join('')}`) : baseName
      const priorCount = usedCounts.get(candidate) ?? 0
      usedCounts.set(candidate, priorCount + 1)
      result[i] = priorCount === 0 ? candidate : `${candidate}${priorCount + 1}`
    }
  }
  return result
}
