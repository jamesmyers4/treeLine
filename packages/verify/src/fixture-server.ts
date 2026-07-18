import { createServer } from 'node:http'
import type { Server } from 'node:http'

export const FIXTURE_USERNAME = 'testuser'
export const FIXTURE_PASSWORD = 'testpass123'

function page(body: string): string {
  return `<!doctype html><html><body>${body}</body></html>`
}

function parseCookie(header: string | undefined): string | undefined {
  if (!header) return undefined
  const match = header.split(';').map(p => p.trim()).find(p => p.startsWith('session='))
  return match?.split('=')[1]
}

export function startFixtureServer(): Promise<{ server: Server; port: number }> {
  const sessions = new Set<string>()
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const authed = sessions.has(parseCookie(req.headers.cookie) ?? '')
    if (url.pathname === '/login' && req.method === 'GET') {
      res.setHeader('content-type', 'text/html')
      res.end(page('<form method="post" action="/login"><input type="text" name="username" aria-label="Username" /><input type="password" name="password" aria-label="Password" /><button type="submit">Log in</button></form>'))
      return
    }
    if (url.pathname === '/login' && req.method === 'POST') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        const params = new URLSearchParams(body)
        if (params.get('username') === FIXTURE_USERNAME && params.get('password') === FIXTURE_PASSWORD) {
          const sessionId = `sess-${Math.random().toString(36).slice(2)}`
          sessions.add(sessionId)
          res.setHeader('set-cookie', `session=${sessionId}; Path=/`)
          res.writeHead(302, { location: '/dashboard' })
          res.end()
          return
        }
        res.writeHead(302, { location: '/login' })
        res.end()
      })
      return
    }
    if (!authed) {
      res.writeHead(302, { location: '/login' })
      res.end()
      return
    }
    const nav = '<nav><a href="/reports">Reports</a><a href="/settings-legacy">Settings</a><div onclick="location.href=\'/audit-log\'">Audit Log</div></nav><a id="logout-link" href="/logout">Logout</a>'
    if (url.pathname === '/dashboard') {
      res.setHeader('content-type', 'text/html')
      res.end(page(`<h1>Dashboard</h1>${nav}`))
      return
    }
    if (url.pathname === '/reports') {
      res.setHeader('content-type', 'text/html')
      res.end(page(`<h1>Reports</h1>${nav}`))
      return
    }
    if (url.pathname === '/settings-legacy') {
      res.setHeader('content-type', 'text/html')
      res.end(page(`<h1>Settings</h1>${nav}`))
      return
    }
    if (url.pathname === '/audit-log') {
      res.setHeader('content-type', 'text/html')
      res.end(page(`<h1>Audit Log</h1>${nav}`))
      return
    }
    res.writeHead(404)
    res.end()
  })
  return new Promise((resolve) => {
    server.listen(0, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({ server, port })
    })
  })
}
