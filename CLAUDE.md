# CLAUDE.md — treeline

Full design rationale lives in `CONTEXT.md`. This file is the operational
guide for working in this repo.

## What this repo is

AI-powered site comprehension engine. Crawls a site, captures aria-tree page
state via a hardened Playwright layer, runs tiered AI interpretation, and
emits test artifacts (POMs, selector reports) plus docs and structured data.
Claude Code's role in this repo is escalation, not the crawl runtime — see
"Escalation workflow" below.

## Monorepo layout

- `packages/cli` — `treeline` CLI entrypoint
- `packages/core` — crawler, capture orchestration, SQLite persistence
- `packages/acquire` — Patchright-hardened Playwright layer + Fastify API
- `packages/interpret` — AI interpretation, 2-tier model routing (Haiku 4.5
  / Sonnet 5)
- `packages/output` — atlas generator, POM generator, selector/testid/axe/
  diff/flow-map reports

## Conventions

- TypeScript, strict mode.
- Playwright/TypeScript for any test automation in this repo.
- No comments in code.
- One line break after a function or major code block ends; no line breaks
  between statements within a function body.
- Locator ranking for anything selector-related: `getByRole` → `data-testid`
  → CSS → XPath, in that order of preference.
- Same-origin crawl scope is the default and should not be silently widened.
- Stealth mode is opt-in (`--stealth` flag) — never the default posture.

## Commands

```
pnpm install
pnpm --filter cli dev -- crawl <url>
pnpm --filter acquire dev
pnpm test
```

## Model routing (packages/interpret)

- **Haiku 4.5** — default tier for simple/structured pages.
- **Sonnet 5** — complex/ambiguous pages, or anything Haiku flags
  low-confidence.
- No Opus tier. If a page fails both tiers, it goes to `hard-pages/`, not to
  a third model.

## Escalation workflow — `hard-pages/`

This is a manual workflow. Nothing shells out to Claude Code automatically.

Each failed page produces a manifest entry:

```
{
"url": "",
"reasonCode": "",
"attemptedAt": "",
"captureSnapshot": null
}
```

`reasonCode` values: `empty-snapshot`, `timeout`, `auth-wall`,
`low-confidence`, `parse-error`.

When invoked against `hard-pages/`, Claude Code should:

1. Read each manifest entry and the associated raw capture (if any).
2. Write a handler matching the `CaptureHandler` interface in
   `packages/acquire` that resolves the specific failure pattern.
3. Add a test proving the handler resolves the case.
4. Commit the handler into the pipeline (not a one-off script) so the next
   crawl handles that pattern deterministically.
5. Remove or mark the manifest entry resolved.

`CaptureHandler` interface shape (implement, don't redesign, unless the
pattern genuinely doesn't fit it):

```
interface CaptureHandler {
matches(page: Page, url: string): Promise<boolean>
capture(page: Page, url: string): Promise<PageState>
}
```

## Do not

- Do not make stealth the default crawl posture.
- Do not build Phase 2 interaction-reachable discovery yet — the capture
  schema should stay forward-compatible with it, but it is not v1 scope.
- Do not add a third model tier without updating `CONTEXT.md` first.
- Do not have the crawler pipeline invoke Claude Code automatically — the
  escalation trigger is manual by design.
