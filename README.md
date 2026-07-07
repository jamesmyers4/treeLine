# treeline

AI-powered site comprehension engine. Crawls a site with a hardened
Playwright browser, captures accessibility-tree page state, and runs tiered
AI interpretation to produce test artifacts (POMs, selector reports), site
documentation, and structured data.

See `CONTEXT.md` for full design rationale and `CLAUDE.md` for the
operational guide when working in this repo with Claude Code.

## Packages
- `packages/cli` — the `treeline` CLI
- `packages/core` — crawler, capture orchestration, SQLite persistence
- `packages/acquire` — hardened Playwright/Patchright layer + Fastify API
- `packages/interpret` — AI interpretation, 2-tier model routing
- `packages/output` — atlas, POM, selector/testid/axe/diff/flow-map reports

## Setup
```
pnpm install
pnpm build
```
