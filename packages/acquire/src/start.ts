import { buildServer } from './server.js'

const app = buildServer()
const address = await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
console.log(address)
