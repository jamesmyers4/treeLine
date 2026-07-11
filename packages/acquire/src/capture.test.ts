import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
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
      expect(el.appearedAtMs === null || typeof el.appearedAtMs === 'number').toBe(true)
    }
    const plainPage = result.interactiveElements.every((el) => el.testId === null)
    expect(plainPage).toBe(true)
    const allPresentAtLoad = result.interactiveElements.every((el) => el.appearedAtMs === null)
    expect(allPresentAtLoad).toBe(true)
  }, 30000)

  it('captures a valid, non-empty PNG screenshot', async () => {
    const result = await capturePage('https://example.com')
    expect(Buffer.isBuffer(result.screenshot)).toBe(true)
    const screenshot = result.screenshot as Buffer
    expect(screenshot.length).toBeGreaterThan(0)
    expect(screenshot.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
  }, 30000)
})

describe('appearedAtMs (per-element appearance latency)', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/data') {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end('ok')
        }, 700)
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<!doctype html>
<html><body>
<button id="immediate">Immediate</button>
<script>
fetch('/data').then(() => {
  const a = document.createElement('a')
  a.href = '#'
  a.id = 'delayed'
  a.textContent = 'Delayed'
  document.body.appendChild(a)
})
</script>
</body></html>`)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as { port: number }
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterAll(() => {
    server.close()
  })

  it('reports null for elements present at initial load and a real value for a deliberately delayed one', async () => {
    const result = await capturePage(baseUrl)
    const immediate = result.interactiveElements.find((el) => el.accessibleName === 'Immediate')
    const delayed = result.interactiveElements.find((el) => el.accessibleName === 'Delayed')
    expect(immediate).toBeDefined()
    expect(delayed).toBeDefined()
    expect(immediate!.appearedAtMs).toBeNull()
    expect(typeof delayed!.appearedAtMs).toBe('number')
    expect(delayed!.appearedAtMs).toBeGreaterThan(400)
    expect(delayed!.appearedAtMs).toBeLessThan(10000)
  }, 30000)
})
