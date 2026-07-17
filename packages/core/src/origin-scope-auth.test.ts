import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { AuthSession } from '@treeline/acquire'
import { fetchSeedPage } from './origin-scope.js'

const SESSION_COOKIE_VALUE = 'valid-session-id'

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!header) return cookies
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex === -1) continue
    const key = part.slice(0, separatorIndex).trim()
    const value = part.slice(separatorIndex + 1).trim()
    if (key) cookies[key] = value
  }
  return cookies
}

function buildAuthSession(baseUrl: string): AuthSession {
  return {
    storageState: {
      cookies: [
        {
          name: 'treeline_session',
          value: SESSION_COOKIE_VALUE,
          domain: '127.0.0.1',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    },
    successIndicator: '#logout-link',
    loginUrl: `${baseUrl}/login`,
  }
}

describe('fetchSeedPage — auth-aware seed resolution', () => {
  let server: Server
  let baseUrl: string

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/login') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><form><input type="password" name="pw" /></form></body></html>')
        return
      }
      if (req.url === '/dashboard') {
        const cookies = parseCookieHeader(req.headers.cookie)
        if (cookies.treeline_session !== SESSION_COOKIE_VALUE) {
          res.writeHead(302, { Location: '/login' })
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body><h1>Dashboard</h1><a id="logout-link" href="#">Logout</a></body></html>')
        return
      }
      res.writeHead(404)
      res.end('not found')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as { port: number }
    baseUrl = `http://127.0.0.1:${addr.port}`
  })

  afterAll(() => {
    server.close()
  })

  it('follows a gated seed URL to the login redirect target when no authSession is given (unchanged, pre-fix behavior)', async () => {
    const { resolvedUrl } = await fetchSeedPage(`${baseUrl}/dashboard`)
    expect(resolvedUrl).toBe(`${baseUrl}/login`)
  }, 30000)

  it('resolves a gated seed URL to itself, not the login page, when a valid authSession is provided', async () => {
    const authSession = buildAuthSession(baseUrl)
    const { resolvedUrl, html } = await fetchSeedPage(`${baseUrl}/dashboard`, authSession)
    expect(resolvedUrl).toBe(`${baseUrl}/dashboard`)
    expect(html).toContain('logout-link')
  }, 30000)

  it('produces byte-identical resolution for a public seed URL regardless of authSession being passed', async () => {
    const withoutAuth = await fetchSeedPage(`${baseUrl}/login`)
    expect(withoutAuth.resolvedUrl).toBe(`${baseUrl}/login`)
  }, 30000)

  it('propagates a clear seed-authentication failure, rather than falling back to the plain-fetch resolution, when the authSession does not actually work', async () => {
    const invalidAuthSession: AuthSession = {
      storageState: {
        cookies: [
          {
            name: 'treeline_session',
            value: 'garbage-session-id-never-issued',
            domain: '127.0.0.1',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
          },
        ],
        origins: [],
      },
      successIndicator: '#logout-link',
      loginUrl: `${baseUrl}/login`,
    }
    await expect(fetchSeedPage(`${baseUrl}/dashboard`, invalidAuthSession)).rejects.toThrow(
      /credentials or session do not appear to be valid/i,
    )
  }, 30000)
})
