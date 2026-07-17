import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

export const FIXTURE_USERNAME = 'testuser'
export const FIXTURE_PASSWORD = 'testpass123'
export const SESSION_COOKIE_NAME = 'treeline_session'

function parseCookies(header: string | undefined): Record<string, string> {
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

export function buildAuthFixtureServer(): FastifyInstance {
  const sessions = new Set<string>()
  const app = Fastify({ logger: false })

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    try {
      done(null, Object.fromEntries(new URLSearchParams(body as string)))
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  function requireSession(request: { headers: { cookie?: string } }): boolean {
    const sessionId = parseCookies(request.headers.cookie)[SESSION_COOKIE_NAME]
    return sessionId !== undefined && sessions.has(sessionId)
  }

  app.get('/login', async (_request, reply) => {
    reply.type('text/html')
    return `<!doctype html>
<html><body>
<form method="post" action="/login">
  <input type="text" name="username" aria-label="Username" />
  <input type="password" name="password" aria-label="Password" />
  <button type="submit">Log in</button>
</form>
</body></html>`
  })

  app.post('/login', async (request, reply) => {
    const body = request.body as { username?: string; password?: string } | undefined
    if (body?.username === FIXTURE_USERNAME && body?.password === FIXTURE_PASSWORD) {
      const sessionId = randomUUID()
      sessions.add(sessionId)
      reply.header('set-cookie', `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly`)
      return reply.redirect('/dashboard', 302)
    }
    return reply.redirect('/login', 302)
  })

  app.get('/dashboard', async (request, reply) => {
    if (!requireSession(request)) return reply.redirect('/login', 302)
    reply.type('text/html')
    return `<!doctype html>
<html><body>
<h1>Dashboard</h1>
<a id="logout-link" href="/logout">Logout</a>
</body></html>`
  })

  app.get('/change-password', async (request, reply) => {
    if (!requireSession(request)) return reply.redirect('/login', 302)
    reply.type('text/html')
    return `<!doctype html>
<html><body>
<h1>Change password</h1>
<a id="logout-link" href="/logout">Logout</a>
<form method="post" action="/change-password">
  <input type="password" name="newPassword" aria-label="New password" />
  <button type="submit">Change</button>
</form>
</body></html>`
  })

  app.get('/logout', async (request, reply) => {
    const sessionId = parseCookies(request.headers.cookie)[SESSION_COOKIE_NAME]
    if (sessionId) sessions.delete(sessionId)
    reply.header('set-cookie', `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0`)
    return reply.redirect('/login', 302)
  })

  return app
}
