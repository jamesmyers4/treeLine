import { describe, it, expect } from 'vitest'
import { normalizeApiPath, normalizeApiSurfaceUrl } from './url-normalize.js'

describe('normalizeApiPath', () => {
  it('collapses a 4+ digit run path segment to a placeholder', () => {
    expect(normalizeApiPath('/orders/12345/items')).toBe('/orders/{id}/items')
  })

  it('leaves a short numeric segment (under 4 digits) alone, e.g. a page number', () => {
    expect(normalizeApiPath('/products?page=2')).toBe('/products?page=2')
    expect(normalizeApiPath('/orders/12/items')).toBe('/orders/12/items')
  })

  it('collapses a real UUID path segment', () => {
    expect(normalizeApiPath('/users/550e8400-e29b-41d4-a716-446655440000/profile')).toBe('/users/{id}/profile')
  })

  it('collapses a Cloudflare-style hex hash segment (real crawl shape from goldenpetbrands.com)', () => {
    expect(normalizeApiPath('/cdn-cgi/challenge-platform/h/g/orchestrate/jsch/v1/8f3a2b1c9d4e5f6a')).toBe(
      '/cdn-cgi/challenge-platform/h/g/orchestrate/jsch/v1/{id}',
    )
  })

  it('leaves an ordinary hyphenated business term alone, even when 6+ characters', () => {
    expect(normalizeApiPath('/api/user-settings')).toBe('/api/user-settings')
    expect(normalizeApiPath('/api/pizza_flavor')).toBe('/api/pizza_flavor')
  })

  it('leaves a plain short word alone', () => {
    expect(normalizeApiPath('/api/track')).toBe('/api/track')
  })

  it('collapses multiple distinct token segments in the same path independently', () => {
    expect(normalizeApiPath('/orders/12345/items/67890')).toBe('/orders/{id}/items/{id}')
  })
})

describe('normalizeApiSurfaceUrl', () => {
  it('normalizes the pathname and preserves origin, query keys, and non-token query values', () => {
    expect(normalizeApiSurfaceUrl('https://example.com/orders/12345/items?category=electronics')).toBe(
      'https://example.com/orders/{id}/items?category=electronics',
    )
  })

  it('collapses a token-like query param value, e.g. a Cloudflare ray id', () => {
    expect(normalizeApiSurfaceUrl('https://example.com/cdn-cgi/challenge?ray=8f3a2b1c9d4e5f6a')).toBe(
      'https://example.com/cdn-cgi/challenge?ray={id}',
    )
  })

  it('produces the same normalized URL for two real requests that only differ by an embedded per-request hash', () => {
    const first = normalizeApiSurfaceUrl('https://example.com/cdn-cgi/challenge-platform/h/g/cv/result/8f3a2b1c9d4e5f6a')
    const second = normalizeApiSurfaceUrl('https://example.com/cdn-cgi/challenge-platform/h/g/cv/result/1a2b3c4d5e6f7a8b')
    expect(first).toBe(second)
  })

  it('returns the raw input unchanged when the URL cannot be parsed, rather than throwing', () => {
    expect(normalizeApiSurfaceUrl('not a url')).toBe('not a url')
  })
})
