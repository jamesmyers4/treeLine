import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { capturePage } from './capture.js'
import type { AcquireOptions } from './types.js'

type CaptureBody = {
  url?: unknown
  options?: AcquireOptions
}

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: false })
  app.addHook('preHandler', async (request, reply) => {
    if (request.url === '/health') return
    const apiKey = process.env.TREELINE_API_KEY
    const header = request.headers['x-api-key']
    if (!apiKey || header !== apiKey) {
      return reply.status(401).send({ error: 'unauthorized' })
    }
  })
  app.get('/health', async () => {
    return { status: 'ok' }
  })
  app.post<{ Body: CaptureBody }>('/capture', async (request, reply) => {
    const { url, options } = request.body
    if (!url || typeof url !== 'string') {
      return reply.status(400).send({ error: 'invalid request' })
    }
    try {
      const result = await capturePage(url, options)
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: message })
    }
  })
  return app
}
