import { createServer } from 'node:http'
import type { Server } from 'node:http'

const pages: Record<string, string> = {
  '/': `<html><head><title>Blog</title></head><body><main><h1>Blog</h1><article><h2>First Post</h2><p>An intro paragraph.</p><a href="/article-1">Read more</a></article><article><h2>Second Post</h2><p>Another intro paragraph.</p><a href="/article-2">Read more</a></article></main></body></html>`,
  '/article-1': `<html><head><title>First Post</title></head><body><main><h1>First Post</h1><p>The full text of the first post.</p><a href="/">Back to Blog</a></main></body></html>`,
  '/article-2': `<html><head><title>Second Post</title></head><body><main><h1>Second Post</h1><p>The full text of the second post.</p><a href="/">Back to Blog</a></main></body></html>`,
}

export function createDuplicateDestinationsServer(): Server {
  return createServer((req, res) => {
    const html = pages[req.url ?? '/'] ?? '<html><body>not found</body></html>'
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(html)
  })
}

export const duplicateDestinationsPagePaths = Object.keys(pages)
