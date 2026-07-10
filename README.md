# treeline

AI-powered site comprehension engine that turns a live website into
executable QA tooling. Point it at a URL and treeline crawls the site with
a hardened Playwright browser, captures real DOM and accessibility-tree
state on every page, and runs that state through tiered AI interpretation
to produce Page Object Models, selector stability reports, accessibility
findings, and structured data — not just a written summary of the site.

## What you get

Each crawl produces five reports plus generated test code:

- **Page Object Models + Playwright specs** — one class per page, one
  locator per interactive element with a selector safe to bake into
  generated code
- **Selector stability report** — every candidate selector ranked (role →
  testid → CSS → XPath), flagged for whether it's stable _and_ unique on
  the page
- **testid coverage audit** — where `data-testid` is present, missing, or
  unreliable
- **Markdown site atlas** — human-readable documentation of every page's
  purpose and structure
- **axe-core accessibility findings** — confirmed violations and items
  needing human review
- **Flow map** — every form's fields and validation, plus the site's
  informal API surface (XHR/fetch activity worth knowing about)

And **diff mode**: crawl a site twice and treeline tells you exactly which
selectors regressed between runs — "did this deploy break my locators" as
an actual command, with `--fail-on-regression` for CI.

This isn't just a CI capability in theory: a `workflow_dispatch` GitHub
Action (`.github/workflows/crawl.yml`) runs `crawl` end-to-end in CI and
has been proven against live sites, including a run with real AI
interpretation — a genuinely demoable regression gate, not a diagram. The
same workflow can optionally publish a run's rendered reports, POMs, and
specs as static HTML to the `gh-pages` branch (opt-in `publish_to_pages`
input, off by default since this is a public repo) — the publish
mechanism is proven against two real runs, though GitHub Pages serving
itself still needs a one-time repo-settings step turned on before the
result is reachable at a public URL (see CLAUDE.md).

## Quick start

```
pnpm install
pnpm build

cd packages/cli
export ANTHROPIC_API_KEY=sk-ant-...   # or add --skip-interpretation to run free
pnpm exec tsx src/index.ts crawl https://example.com --max-pages 5 --output ../../treeline-output/my-crawl
```

Reports land in `treeline-output/my-crawl/reports/`. Compare two crawls:

```
pnpm exec tsx src/index.ts diff ../../treeline-output/my-crawl ../../treeline-output/my-crawl-later --fail-on-regression
```

See `CONTEXT.md` for full design rationale and `CLAUDE.md` for the
operational guide when working in this repo with Claude Code.

## Packages

- `packages/cli` — the `treeline` CLI (`crawl`, `diff`)
- `packages/core` — crawler, capture orchestration, SQLite persistence
- `packages/acquire` — hardened Playwright/Patchright layer + Fastify API
- `packages/interpret` — AI interpretation, 2-tier model routing (Claude
  Haiku 4.5 / Sonnet 5)
- `packages/output` — atlas, POM, selector/testid/axe/diff/flow-map reports

## Stack

TypeScript, Playwright + Patchright, Fastify, SQLite (better-sqlite3),
Anthropic API via `@anthropic-ai/sdk`, `@axe-core/playwright`, pnpm
workspaces, Vitest, commander.

## Status

v1 is complete, and the GitHub Action — both crawl-in-CI (Stage A) and
static-HTML publish to GitHub Pages (Stage B) — is complete and proven
against live sites and real runs, as of session 36. All core reports, POM
generation, diff mode, flow map, CI-based crawling, and Pages publish are
built, tested, and verified against real sites; enabling GitHub Pages
serving itself for this specific repo is a one-time Settings step still
pending (see CLAUDE.md). See `CONTEXT.md`'s Status section for exact scope
and known limitations.
