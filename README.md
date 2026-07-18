# treeline

AI-powered site comprehension engine that turns a live website into
executable QA tooling. Point it at a URL and treeline crawls the site with
a hardened Playwright browser, captures real DOM and accessibility-tree
state on every page, and runs that state through tiered AI interpretation
to produce Page Object Models, selector stability reports, accessibility
findings, and structured data — not just a written summary of the site.

## What you get

Each crawl produces nine reports plus generated test code, all under
`<output>/reports/`:

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
  informal API surface (XHR/fetch activity worth knowing about), with an
  opt-in sampled JSON response body per endpoint (`--capture-response-bodies`)
- **Coverage-gap report** — zero-coverage and high-skip pages, forms with
  no generated field-level assertions, and unresolved `hard-pages/` entries
- **Timing report** — slow-loading pages, slow network requests, and
  high-latency element appearance, each against an empirically-derived
  threshold
- **Color report** — the site's actual color palette (text/background hex
  values), aggregated site-wide and per page
- **Proposal-coverage report** — which pages got an AI-proposed test
  assertion and of what kind
- **AI-proposed test scenarios** — a `*.proposed.spec.ts` alongside the
  trusted generated specs for pages with a meaningful proposed assertion
  (form-fill or content-presence), always `test.skip`-wrapped and never
  merged into the trusted spec — a human reviews and enables it deliberately

And **diff mode**: crawl a site twice and treeline tells you exactly which
selectors regressed between runs — "did this deploy break my locators" as
an actual command, with `--fail-on-regression` for CI. Diff mode also
surfaces visual changes (pixel-diff screenshots) and page-load timing
regressions, but neither of those affects the `--fail-on-regression` exit
code — that guarantee is driven solely by selector-candidate regressions.

Treeline can also crawl behind a login (`--login-url`, `--username`,
`--success-indicator`) — session state is captured once via a real login
and re-seeded into every page's browser context, never written to disk.
**Read CLAUDE.md's "Operational gotchas" before pointing this at a target
where write access matters**: a same-origin, link-following crawl is only
as read-only as the target makes it, and a real authenticated crawl has
already triggered a genuine data mutation via an ordinary GET link during
normal link discovery (no form fill, no JS execution) — this codebase does
not yet have a mitigation for that class of risk.

This isn't just a CI capability in theory: a `workflow_dispatch` GitHub
Action (`.github/workflows/crawl.yml`) runs `crawl` end-to-end in CI and
has been proven against live sites, including a run with real AI
interpretation — a genuinely demoable regression gate, not a diagram. The
same workflow can optionally publish a run's rendered reports, POMs, and
specs as static HTML to the `gh-pages` branch (opt-in `publish_to_pages`
input, off by default since this is a public repo) — the publish
mechanism is proven against real runs, though GitHub Pages serving itself
still needs a one-time repo-settings step turned on before the result is
reachable at a public URL (see CLAUDE.md). Authenticated crawling is
CLI-only and deliberately not wired into this workflow.

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
- `packages/core` — crawler, capture orchestration, SQLite persistence,
  diff/screenshot-diff/origin-scope logic
- `packages/acquire` — hardened Playwright/Patchright layer, axe-core
  scanning, Fastify API, login/session handling for authenticated crawls
- `packages/interpret` — AI interpretation, 2-tier model routing (Claude
  Haiku 4.5 / Sonnet 5), plus the AI-proposed-assertion call
- `packages/output` — atlas, POM, and all nine report generators (selector,
  testid, axe, diff, flow-map, coverage-gap, timing, color, proposal-
  coverage), plus the shared markdown-safety sanitizer
- `packages/pages` — static HTML renderer (markdown-it + shiki) that turns
  a crawl/diff output directory into the site published to `gh-pages`

## Stack

TypeScript, Playwright + Patchright, Fastify, SQLite (better-sqlite3),
Anthropic API via `@anthropic-ai/sdk`, `@axe-core/playwright`, `pixelmatch`
+ `pngjs` (visual diffing), `markdown-it` + `shiki` (GitHub Pages HTML
rendering), pnpm workspaces, Vitest, commander.

## Status

v1 is complete (all 8 original output-set items built and verified). Since
then, this has grown well past v1 through a series of V2 additions: visual
diffing and page-load timing regressions in `diff` mode, the GitHub Action
(crawl-in-CI plus opt-in GitHub Pages publish), a coverage-gap report, a
timing/flakiness report, AI-proposed test assertions (form-fill and
content-presence, always `test.skip`-wrapped), a markdown/HTML escaping
audit, opt-in JSON response-body capture, and a color-scheme report — all
built, tested, and verified against real sites, not just fixtures.

Most recently, authenticated crawling (`--login-url`/`--username`/
`--success-indicator`) was built and verified end-to-end against a real
authenticated target (a local OpenEMR instance). That same verification
run surfaced a real, confirmed finding: an ordinary same-origin
link-following crawl triggered a genuine data mutation via a GET link with
a pre-baked CSRF token — no form fill, no JS execution required. There is
no mitigation for this yet (no URL-pattern denylist, no CLI warning on
`--login-url`) — read CLAUDE.md's "Operational gotchas" before running an
authenticated crawl anywhere write access matters.

See `CONTEXT.md`'s Status and Open Items sections for exact scope, every
known limitation, and the full authenticated-crawling design writeup.
