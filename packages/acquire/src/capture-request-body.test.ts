import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { capturePage } from './capture.js'

describe('request body / header / query-param capture', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/page') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<!doctype html>
<html><body>
<script>
fetch('/api/json-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'alice', password: 'secret123' }) }).catch(() => {})
fetch('/api/form-post', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'patientDOB=1990-01-01&ssn=123-45-6789' }).catch(() => {})
fetch('/api/query?token=abc123&page=2').catch(() => {})
fetch('/api/big-json-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes: 'x'.repeat(200000) }) }).catch(() => {})
fetch('/api/multipart-post', { method: 'POST', body: (() => { const fd = new FormData(); fd.append('file', new Blob(['hello'], { type: 'text/plain' }), 'note.txt'); return fd })() }).catch(() => {})
fetch('/api/other-post', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'raw text body' }).catch(() => {})
</script>
</body></html>`)
        return
      }
      if (req.url === '/dedup-page') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<!doctype html>
<html><body>
<script>fetch('/api/dedup-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ field: 'value' }) }).catch(() => {})</script>
</body></html>`)
        return
      }
      if (
        req.url === '/api/json-post' ||
        req.url === '/api/form-post' ||
        req.url === '/api/dedup-post' ||
        req.url === '/api/big-json-post' ||
        req.url === '/api/multipart-post' ||
        req.url === '/api/other-post'
      ) {
        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ received: body.length }))
        })
        return
      }
      if (req.url?.startsWith('/api/query')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
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

  it('leaves requestBody null when captureRequestBodies is unset, but still captures requestHeaderNames and queryParams unconditionally', async () => {
    const result = await capturePage(`${baseUrl}/page`)
    const jsonEntry = result.networkLog.find((e) => e.url === `${baseUrl}/api/json-post`)
    expect(jsonEntry).toBeDefined()
    expect(jsonEntry!.requestBody).toBeNull()
    expect(jsonEntry!.requestHeaderNames.length).toBeGreaterThan(0)
    expect(jsonEntry!.requestHeaderNames.map((h) => h.toLowerCase())).toContain('content-type')
    const queryEntry = result.networkLog.find((e) => e.url.startsWith(`${baseUrl}/api/query`))
    expect(queryEntry).toBeDefined()
    expect(queryEntry!.queryParams).toEqual({ token: 'abc123', page: '2' })
  }, 30000)

  it('captures request body field names only, never values, for a JSON POST when captureRequestBodies is true', async () => {
    const result = await capturePage(`${baseUrl}/page`, { captureRequestBodies: true })
    const jsonEntry = result.networkLog.find((e) => e.url === `${baseUrl}/api/json-post`)
    expect(jsonEntry).toBeDefined()
    expect(jsonEntry!.requestBody).toEqual(['username', 'password'])
    const serialized = JSON.stringify(jsonEntry!.requestBody)
    expect(serialized).not.toContain('alice')
    expect(serialized).not.toContain('secret123')
  }, 30000)

  it('captures request body field names for a form-urlencoded POST via URLSearchParams parsing', async () => {
    const result = await capturePage(`${baseUrl}/page`, { captureRequestBodies: true })
    const formEntry = result.networkLog.find((e) => e.url === `${baseUrl}/api/form-post`)
    expect(formEntry).toBeDefined()
    expect(formEntry!.requestBody).toEqual(['patientDOB', 'ssn'])
    const serialized = JSON.stringify(formEntry!.requestBody)
    expect(serialized).not.toContain('1990-01-01')
    expect(serialized).not.toContain('123-45-6789')
  }, 30000)

  it('matches a content-type with a charset parameter, e.g. "application/x-www-form-urlencoded; charset=UTF-8" (real OpenEMR traffic shape)', async () => {
    const html = `<!doctype html>
<html><body>
<script>fetch('/api/charset-form-post', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: 'csrf_token_form=abc123' }).catch(() => {})</script>
</body></html>`
    const charsetServer = createServer((req, res) => {
      if (req.url === '/charset-page') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(html)
        return
      }
      if (req.url === '/api/charset-form-post') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => charsetServer.listen(0, '127.0.0.1', resolve))
    const addr = charsetServer.address() as { port: number }
    const charsetBaseUrl = `http://127.0.0.1:${addr.port}`
    try {
      const result = await capturePage(`${charsetBaseUrl}/charset-page`, { captureRequestBodies: true })
      const entry = result.networkLog.find((e) => e.url === `${charsetBaseUrl}/api/charset-form-post`)
      expect(entry).toBeDefined()
      expect(entry!.requestBody).toEqual(['csrf_token_form'])
    } finally {
      charsetServer.close()
    }
  }, 30000)

  it('leaves requestBody null when the body exceeds maxRequestBodyBytes, but still categorizes the content type and flags the size cap', async () => {
    const result = await capturePage(`${baseUrl}/page`, { captureRequestBodies: true, maxRequestBodyBytes: 1000 })
    const bigEntry = result.networkLog.find((e) => e.url === `${baseUrl}/api/big-json-post`)
    expect(bigEntry).toBeDefined()
    expect(bigEntry!.requestBody).toBeNull()
    expect(bigEntry!.requestBodyContentTypeCategory).toBe('json')
    expect(bigEntry!.requestBodyExceededSizeCap).toBe(true)
  }, 30000)

  it('categorizes a JSON POST under the size cap as json with requestBodyExceededSizeCap false', async () => {
    const result = await capturePage(`${baseUrl}/page`, { captureRequestBodies: true })
    const jsonEntry = result.networkLog.find((e) => e.url === `${baseUrl}/api/json-post`)
    expect(jsonEntry).toBeDefined()
    expect(jsonEntry!.requestBodyContentTypeCategory).toBe('json')
    expect(jsonEntry!.requestBodyExceededSizeCap).toBe(false)
  }, 30000)

  it('categorizes a form-urlencoded POST as form-urlencoded', async () => {
    const result = await capturePage(`${baseUrl}/page`, { captureRequestBodies: true })
    const formEntry = result.networkLog.find((e) => e.url === `${baseUrl}/api/form-post`)
    expect(formEntry).toBeDefined()
    expect(formEntry!.requestBodyContentTypeCategory).toBe('form-urlencoded')
    expect(formEntry!.requestBodyExceededSizeCap).toBe(false)
  }, 30000)

  it('categorizes a real multipart/form-data POST as multipart, with requestBody still null (out of scope for field extraction)', async () => {
    const result = await capturePage(`${baseUrl}/page`, { captureRequestBodies: true })
    const multipartEntry = result.networkLog.find((e) => e.url === `${baseUrl}/api/multipart-post`)
    expect(multipartEntry).toBeDefined()
    expect(multipartEntry!.requestBody).toBeNull()
    expect(multipartEntry!.requestBodyContentTypeCategory).toBe('multipart')
    expect(multipartEntry!.requestBodyExceededSizeCap).toBe(false)
  }, 30000)

  it('categorizes an unrecognized content type as other, with requestBody still null', async () => {
    const result = await capturePage(`${baseUrl}/page`, { captureRequestBodies: true })
    const otherEntry = result.networkLog.find((e) => e.url === `${baseUrl}/api/other-post`)
    expect(otherEntry).toBeDefined()
    expect(otherEntry!.requestBody).toBeNull()
    expect(otherEntry!.requestBodyContentTypeCategory).toBe('other')
    expect(otherEntry!.requestBodyExceededSizeCap).toBe(false)
  }, 30000)

  it('leaves requestBodyContentTypeCategory null and requestBodyExceededSizeCap false when captureRequestBodies is unset', async () => {
    const result = await capturePage(`${baseUrl}/page`)
    const jsonEntry = result.networkLog.find((e) => e.url === `${baseUrl}/api/json-post`)
    expect(jsonEntry).toBeDefined()
    expect(jsonEntry!.requestBodyContentTypeCategory).toBeNull()
    expect(jsonEntry!.requestBodyExceededSizeCap).toBe(false)
  }, 30000)

  it('does not sample the same endpoint request body twice when the same sampledEndpoints Set is reused, but still categorizes the deduped occurrence', async () => {
    const sampledEndpoints = new Set<string>()
    const first = await capturePage(`${baseUrl}/dedup-page`, { captureRequestBodies: true, sampledEndpoints })
    const second = await capturePage(`${baseUrl}/dedup-page`, { captureRequestBodies: true, sampledEndpoints })
    const firstEntry = first.networkLog.find((e) => e.url === `${baseUrl}/api/dedup-post`)
    const secondEntry = second.networkLog.find((e) => e.url === `${baseUrl}/api/dedup-post`)
    expect(firstEntry!.requestBody).toEqual(['field'])
    expect(secondEntry!.requestBody).toBeNull()
    expect(secondEntry!.requestBodyContentTypeCategory).toBe('json')
    expect(secondEntry!.requestBodyExceededSizeCap).toBe(false)
  }, 30000)

  it('reports requiresAuth false when no authSession is configured', async () => {
    const result = await capturePage(`${baseUrl}/page`)
    for (const entry of result.networkLog) {
      expect(entry.requiresAuth).toBe(false)
    }
  }, 30000)
})

describe('response body schema summary', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/schema-page') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<!doctype html>
<html><body>
<script>
fetch('/api/object-response').catch(() => {})
fetch('/api/array-response').catch(() => {})
</script>
</body></html>`)
        return
      }
      if (req.url === '/api/object-response') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 1, name: 'test', active: true, tags: ['a', 'b'], meta: null }))
        return
      }
      if (req.url === '/api/array-response') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify([1, 2, 3]))
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as { port: number }
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterAll(() => {
    server.close()
  })

  it('infers a shallow {field: type} schema for a JSON object response body', async () => {
    const result = await capturePage(`${baseUrl}/schema-page`, { captureResponseBodies: true })
    const entry = result.networkLog.find((e) => e.url === `${baseUrl}/api/object-response`)
    expect(entry).toBeDefined()
    expect(entry!.responseBodySchema).toEqual({ id: 'number', name: 'string', active: 'boolean', tags: 'array', meta: 'null' })
  }, 30000)

  it('leaves responseBodySchema null for a top-level JSON array response body', async () => {
    const result = await capturePage(`${baseUrl}/schema-page`, { captureResponseBodies: true })
    const entry = result.networkLog.find((e) => e.url === `${baseUrl}/api/array-response`)
    expect(entry).toBeDefined()
    expect(entry!.responseBodySample).toBe(JSON.stringify([1, 2, 3]))
    expect(entry!.responseBodySchema).toBeNull()
  }, 30000)

  it('leaves responseBodySchema null when captureResponseBodies is unset', async () => {
    const result = await capturePage(`${baseUrl}/schema-page`)
    const entry = result.networkLog.find((e) => e.url === `${baseUrl}/api/object-response`)
    expect(entry).toBeDefined()
    expect(entry!.responseBodySample).toBeNull()
    expect(entry!.responseBodySchema).toBeNull()
  }, 30000)
})
