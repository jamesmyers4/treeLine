import { createServer } from 'node:http'
import type { Server } from 'node:http'

const nav = '<nav><a href="/">Home</a><a href="/dashboard">Dashboard</a></nav>'

const pages: Record<string, string> = {
  '/': `<html><head><title>Sign Up</title></head><body>${nav}<main><h1>Sign Up</h1><form action="/submit" method="post"><input aria-label="Email" type="email" required /><input aria-label="Full Name" type="text" required /><button type="submit">Create Account</button></form></main></body></html>`,
  '/dashboard': `<html><head><title>Dashboard</title></head><body>${nav}<main><h1>Dashboard</h1><p>Live status below.</p></main><script>fetch("/api/status")</script></body></html>`,
}

export function createFormAndApiServer(): Server {
  return createServer((req, res) => {
    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', uptimeSeconds: 12345 }))
      return
    }
    const html = pages[req.url ?? '/'] ?? '<html><body>not found</body></html>'
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html)
  })
}

export const formAndApiPagePaths = Object.keys(pages)
