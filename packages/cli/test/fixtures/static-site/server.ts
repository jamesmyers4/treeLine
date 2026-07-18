import { createServer } from 'node:http'
import type { Server } from 'node:http'

const nav = '<nav><a href="/">Home</a><a href="/about">About</a><a href="/contact">Contact</a></nav>'
const footerNav = '<footer><a href="/">Home</a><a href="/about">About</a><a href="/contact">Contact</a></footer>'

const pages: Record<string, string> = {
  '/': `<html><head><title>Home</title></head><body>${nav}<main><h1>Welcome</h1><p>This is the home page of a small static site.</p></main>${footerNav}</body></html>`,
  '/about': `<html><head><title>About</title></head><body>${nav}<main><h1>About Us</h1><p>A short description of who we are.</p></main>${footerNav}</body></html>`,
  '/contact': `<html><head><title>Contact</title></head><body>${nav}<main><h1>Contact</h1><p>Reach us at hello@example.com.</p></main>${footerNav}</body></html>`,
}

export function createStaticSiteServer(): Server {
  return createServer((req, res) => {
    const html = pages[req.url ?? '/'] ?? '<html><body>not found</body></html>'
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html)
  })
}

export const staticSitePagePaths = Object.keys(pages)
