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

describe('response body capture', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/page') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<!doctype html>
<html><body>
<script>
fetch('/api/json').catch(() => {})
fetch('/api/html').catch(() => {})
fetch('/api/big').catch(() => {})
</script>
</body></html>`)
        return
      }
      if (req.url === '/api/json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ hello: 'world' }))
        return
      }
      if (req.url === '/api/html') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<p>not json</p>')
        return
      }
      if (req.url === '/api/big') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ data: 'x'.repeat(60000) }))
        return
      }
      if (req.url === '/dedup-page') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<!doctype html>
<html><body>
<script>fetch('/api/json').catch(() => {})</script>
</body></html>`)
        return
      }
      res.writeHead(404, { 'Content-Type': 'text/html' })
      res.end('not found')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as { port: number }
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterAll(() => {
    server.close()
  })

  it('captures a JSON xhr/fetch response body when captureResponseBodies is true', async () => {
    const result = await capturePage(`${baseUrl}/page`, { captureResponseBodies: true })
    const entry = result.networkLog.find((e) => e.url === `${baseUrl}/api/json`)
    expect(entry).toBeDefined()
    expect(entry!.responseBodySample).toBe(JSON.stringify({ hello: 'world' }))
  }, 30000)

  it('leaves responseBodySample null when captureResponseBodies is unset', async () => {
    const result = await capturePage(`${baseUrl}/page`)
    const entry = result.networkLog.find((e) => e.url === `${baseUrl}/api/json`)
    expect(entry).toBeDefined()
    expect(entry!.responseBodySample).toBeNull()
  }, 30000)

  it('leaves responseBodySample null for non-JSON content types even with the flag on', async () => {
    const result = await capturePage(`${baseUrl}/page`, { captureResponseBodies: true })
    const entry = result.networkLog.find((e) => e.url === `${baseUrl}/api/html`)
    expect(entry).toBeDefined()
    expect(entry!.responseBodySample).toBeNull()
  }, 30000)

  it('leaves responseBodySample null when the body exceeds maxResponseBodyBytes, without truncating', async () => {
    const result = await capturePage(`${baseUrl}/page`, { captureResponseBodies: true, maxResponseBodyBytes: 1000 })
    const entry = result.networkLog.find((e) => e.url === `${baseUrl}/api/big`)
    expect(entry).toBeDefined()
    expect(entry!.responseBodySample).toBeNull()
  }, 30000)

  it('captures a body under the default 512000-byte cap that would have exceeded the old 51200-byte cap', async () => {
    const result = await capturePage(`${baseUrl}/page`, { captureResponseBodies: true })
    const entry = result.networkLog.find((e) => e.url === `${baseUrl}/api/big`)
    expect(entry).toBeDefined()
    expect(entry!.responseBodySample).toBe(JSON.stringify({ data: 'x'.repeat(60000) }))
  }, 30000)

  it('respects a custom maxResponseBodyBytes override higher than the default', async () => {
    const result = await capturePage(`${baseUrl}/page`, { captureResponseBodies: true, maxResponseBodyBytes: 100000 })
    const entry = result.networkLog.find((e) => e.url === `${baseUrl}/api/big`)
    expect(entry).toBeDefined()
    expect(entry!.responseBodySample).toBe(JSON.stringify({ data: 'x'.repeat(60000) }))
  }, 30000)

  it('does not sample the same endpoint twice when the same sampledEndpoints Set is reused', async () => {
    const sampledEndpoints = new Set<string>()
    const first = await capturePage(`${baseUrl}/dedup-page`, { captureResponseBodies: true, sampledEndpoints })
    const second = await capturePage(`${baseUrl}/dedup-page`, { captureResponseBodies: true, sampledEndpoints })
    const firstEntry = first.networkLog.find((e) => e.url === `${baseUrl}/api/json`)
    const secondEntry = second.networkLog.find((e) => e.url === `${baseUrl}/api/json`)
    expect(firstEntry!.responseBodySample).toBe(JSON.stringify({ hello: 'world' }))
    expect(secondEntry!.responseBodySample).toBeNull()
  }, 30000)

  it('leaves responseBodySample null without crashing when the body read throws', async () => {
    const html = `<!doctype html>
<html><body>
<script>fetch('/api/broken-json').catch(() => {})</script>
</body></html>`
    const brokenServer = createServer((req, res) => {
      if (req.url === '/broken-page') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html)
        return
      }
      if (req.url === '/api/broken-json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write('{"partial":')
        req.socket.destroy()
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => brokenServer.listen(0, '127.0.0.1', resolve))
    const addr = brokenServer.address() as { port: number }
    const brokenBaseUrl = `http://127.0.0.1:${addr.port}`
    try {
      const result = await capturePage(`${brokenBaseUrl}/broken-page`, { captureResponseBodies: true })
      const entry = result.networkLog.find((e) => e.url === `${brokenBaseUrl}/api/broken-json`)
      if (entry) expect(entry.responseBodySample).toBeNull()
    } finally {
      brokenServer.close()
    }
  }, 30000)

  it('does not lock an endpoint out of sampling after a transient body-read failure, so a later successful read still populates the sample', async () => {
    let requestCount = 0
    const retryServer = createServer((req, res) => {
      if (req.url === '/retry-page') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<!doctype html>
<html><body>
<script>fetch('/api/retry-json').catch(() => {})</script>
</body></html>`)
        return
      }
      if (req.url === '/api/retry-json') {
        requestCount++
        if (requestCount === 1) {
          res.writeHead(302, { Location: '/api/retry-json-target', 'Content-Type': 'application/json' })
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ retried: true }))
        return
      }
      if (req.url === '/api/retry-json-target') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ignored: true }))
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => retryServer.listen(0, '127.0.0.1', resolve))
    const addr = retryServer.address() as { port: number }
    const retryBaseUrl = `http://127.0.0.1:${addr.port}`
    const sampledEndpoints = new Set<string>()
    try {
      const first = await capturePage(`${retryBaseUrl}/retry-page`, { captureResponseBodies: true, sampledEndpoints })
      const firstEntry = first.networkLog.find((e) => e.url === `${retryBaseUrl}/api/retry-json`)
      expect(firstEntry).toBeDefined()
      expect(firstEntry!.responseBodySample).toBeNull()
      const second = await capturePage(`${retryBaseUrl}/retry-page`, { captureResponseBodies: true, sampledEndpoints })
      const secondEntry = second.networkLog.find((e) => e.url === `${retryBaseUrl}/api/retry-json`)
      expect(secondEntry).toBeDefined()
      expect(secondEntry!.responseBodySample).toBe(JSON.stringify({ retried: true }))
    } finally {
      retryServer.close()
    }
  }, 30000)

  it('waits for a late-arriving body read before returning the PageState', async () => {
    const slowHtml = `<!doctype html>
<html><body>
<script>fetch('/api/slow-json').catch(() => {})</script>
</body></html>`
    const slowServer = createServer((req, res) => {
      if (req.url === '/slow-page') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(slowHtml)
        return
      }
      if (req.url === '/api/slow-json') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write('{"slow":')
        setTimeout(() => res.end('true}'), 500)
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => slowServer.listen(0, '127.0.0.1', resolve))
    const addr = slowServer.address() as { port: number }
    const slowBaseUrl = `http://127.0.0.1:${addr.port}`
    try {
      const result = await capturePage(`${slowBaseUrl}/slow-page`, { captureResponseBodies: true })
      const entry = result.networkLog.find((e) => e.url === `${slowBaseUrl}/api/slow-json`)
      expect(entry).toBeDefined()
      expect(entry!.responseBodySample).toBe('{"slow":true}')
    } finally {
      slowServer.close()
    }
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
