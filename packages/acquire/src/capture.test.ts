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
    expect(Array.isArray(result.interactiveElements)).toBe(true)
    expect(result.interactiveElements.length).toBeGreaterThan(0)
    for (const el of result.interactiveElements) {
      expect(typeof el.role).toBe('string')
      expect(typeof el.accessibleName).toBe('string')
      expect(typeof el.tagName).toBe('string')
      expect(el.testId === null || typeof el.testId === 'string').toBe(true)
      expect(el.elementId === null || typeof el.elementId === 'string').toBe(true)
      expect(Array.isArray(el.classList)).toBe(true)
      for (const className of el.classList) {
        expect(typeof className).toBe('string')
      }
      expect(typeof el.cssPath).toBe('string')
      expect(el.cssPath.length).toBeGreaterThan(0)
      expect(typeof el.xpath).toBe('string')
      expect(el.xpath.startsWith('/html')).toBe(true)
    }
    const plainPage = result.interactiveElements.every((el) => el.testId === null)
    expect(plainPage).toBe(true)
  }, 30000)
})
