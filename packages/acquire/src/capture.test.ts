import { describe, expect, it } from 'vitest'
import { capturePage } from './capture.js'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe('capturePage', () => {
  it('returns a valid PageState for example.com', async () => {
    const result = await capturePage('https://example.com')
    expect(result.url).toBe('https://example.com')
    expect(result.title).toBeTruthy()
    expect(result.ariaSnapshot).toBeTruthy()
    expect(Array.isArray(result.links)).toBe(true)
    expect(Array.isArray(result.networkLog)).toBe(true)
    expect(Buffer.isBuffer(result.screenshot)).toBe(true)
    expect(typeof result.capturedAt).toBe('string')
    expect(typeof result.pageLoadMs).toBe('number')
    expect(result.pageLoadMs).toBeGreaterThan(0)
    for (const entry of result.networkLog) {
      expect(typeof entry.durationMs).toBe('number')
      expect(entry.durationMs).toBeGreaterThanOrEqual(0)
    }
    expect(Array.isArray(result.interactiveElements)).toBe(true)
    expect(result.interactiveElements.length).toBeGreaterThan(0)
    expect(Array.isArray(result.axeViolations)).toBe(true)
    expect(Array.isArray(result.axeIncomplete)).toBe(true)
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

  it('captures a valid, non-empty PNG screenshot', async () => {
    const result = await capturePage('https://example.com')
    expect(Buffer.isBuffer(result.screenshot)).toBe(true)
    const screenshot = result.screenshot as Buffer
    expect(screenshot.length).toBeGreaterThan(0)
    expect(screenshot.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
  }, 30000)
})
