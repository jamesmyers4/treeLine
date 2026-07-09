import { describe, it, expect } from 'vitest'
import { findCanonicalHref, detectHostnameMismatches } from './origin-scope.js'

describe('findCanonicalHref', () => {
  it('extracts an href from a canonical link tag', () => {
    const html = '<html><head><link rel="canonical" href="https://example.com/page" /></head></html>'
    expect(findCanonicalHref(html)).toBe('https://example.com/page')
  })

  it('returns null when no canonical tag is present', () => {
    const html = '<html><head><title>no canonical here</title></head></html>'
    expect(findCanonicalHref(html)).toBeNull()
  })

  it('matches attribute order with href before rel', () => {
    const html = '<link href="https://example.com/other" rel="canonical">'
    expect(findCanonicalHref(html)).toBe('https://example.com/other')
  })
})

describe('detectHostnameMismatches', () => {
  it('returns empty when sitemap and canonical match the seed hostname', () => {
    const mismatches = detectHostnameMismatches(
      'https://example.com/',
      ['https://example.com/a', 'https://example.com/b'],
      'https://example.com/',
    )
    expect(mismatches).toEqual([])
  })

  it('flags a sitemap entry on a different hostname', () => {
    const mismatches = detectHostnameMismatches(
      'https://example.com/',
      ['https://example.com/a', 'https://other.example/b'],
      null,
    )
    expect(mismatches).toEqual([{ source: 'sitemap', hostname: 'other.example', url: 'https://other.example/b' }])
  })

  it('flags a canonical tag pointing to a different hostname', () => {
    const mismatches = detectHostnameMismatches('https://example.com/', [], 'https://other.example/')
    expect(mismatches).toEqual([{ source: 'canonical', hostname: 'other.example', url: 'https://other.example/' }])
  })

  it('dedupes when sitemap and canonical both point to the same alternate hostname', () => {
    const mismatches = detectHostnameMismatches(
      'https://example.com/',
      ['https://other.example/a'],
      'https://other.example/',
    )
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0].hostname).toBe('other.example')
  })

  it('ignores invalid URLs without throwing', () => {
    const mismatches = detectHostnameMismatches('https://example.com/', ['not a url'], 'also not a url')
    expect(mismatches).toEqual([])
  })
})
