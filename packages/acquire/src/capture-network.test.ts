import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { capturePage } from './capture.js'

describe('networkLog request/response pairing', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/api/thing') {
        const delayMs = req.method === 'POST' ? 200 : 500
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ method: req.method }))
        }, delayMs)
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<!doctype html>
<html><body>
<script>
  fetch('/api/thing', { method: 'POST', body: 'x=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  fetch('/api/thing')
  fetch('http://127.0.0.1:1/unreachable').catch(() => undefined)
</script>
</body></html>`)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })

  afterAll(() => {
    server.close()
  })

  it('keeps each overlapping request to the same URL paired with its own method, not whichever was issued last', async () => {
    const result = await capturePage(baseUrl, { headless: true })
    const thingEntries = result.networkLog.filter((entry) => entry.url === `${baseUrl}/api/thing`)
    expect(thingEntries.map((entry) => entry.method).sort()).toEqual(['GET', 'POST'])
    for (const entry of thingEntries) {
      expect(entry.status).toBe(200)
      expect(entry.failureText).toBeNull()
    }
    const post = thingEntries.find((entry) => entry.method === 'POST')!
    const get = thingEntries.find((entry) => entry.method === 'GET')!
    expect(post.durationMs).toBeLessThan(get.durationMs)
  }, 30000)

  it('records a request that failed with no response, with a null status and the real failure text', async () => {
    const result = await capturePage(baseUrl, { headless: true })
    const failed = result.networkLog.find((entry) => entry.url === 'http://127.0.0.1:1/unreachable')
    expect(failed).toBeDefined()
    expect(failed!.status).toBeNull()
    expect(failed!.failureText).toMatch(/\S/)
  }, 30000)
})
