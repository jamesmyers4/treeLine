import type { DomInteractiveElement } from '@treeline/acquire'
import { normalizeUrl } from '@treeline/core'
import type { PomFileNameCollision } from './types.js'

function capitalize(word: string): string {
  if (word.length === 0) return word
  return word[0]!.toUpperCase() + word.slice(1)
}

function lowerFirst(word: string): string {
  if (word.length === 0) return word
  return word[0]!.toLowerCase() + word.slice(1)
}

function sanitizeIdentifier(name: string): string {
  return /^[0-9]/.test(name) ? `_${name}` : name
}

function getPathname(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

function pathSegments(url: string): string[] {
  const pathname = getPathname(url)
  const trimmed = pathname.replace(/^\//, '').replace(/\.html$/, '')
  return trimmed.split(/[/-]/).filter((segment) => segment.length > 0)
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
  const trimmed = pathname.replace(/^\//, '').replace(/\.html$/, '')
  return trimmed.split('/').filter((segment) => segment.length > 0).join('-').toLowerCase()
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
