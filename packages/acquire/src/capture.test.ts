import { describe, expect, it } from 'vitest'
import { capturePage } from './capture.js'

describe('capturePage', () => {
  it('returns a valid PageState for example.com', async () => {
    const result = await capturePage('https://example.com')
    expect(result.url).toBe('https://example.com')
    expect(result.title).toBeTruthy()
    expect(result.ariaSnapshot).toBeTruthy()
    expect(Array.isArray(result.links)).toBe(true)
    expect(Array.isArray(result.networkLog)).toBe(true)
    expect(result.screenshot).toBeNull()
    expect(typeof result.capturedAt).toBe('string')
  }, 30000)
})
