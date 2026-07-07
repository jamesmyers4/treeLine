# @treeline/acquire

Hardened Playwright capture layer with a Fastify HTTP API.

## Local setup

Copy `.env.example` to `.env` and set the values:

```
TREELINE_API_KEY=your-secret-key
PORT=3000
```

Load the `.env` file before starting (e.g. with `dotenv-cli` or your shell's
`export` command), then run:

```
pnpm dev
```

All routes except `GET /health` require the `x-api-key` header to match
`TREELINE_API_KEY`.
