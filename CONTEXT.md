# treeline — CONTEXT.md

## What it is

An AI-powered site comprehension engine. Point it at a URL and it crawls the
site with a hardened Playwright browser, captures the accessibility-tree state
of every page, and runs that state through tiered AI interpretation to
produce test artifacts, documentation, and structured data — with Claude Code
as a manual escalation path for pages the pipeline can't parse on its own.

Not "just a scraper." The differentiator is that it turns a live website into
executable QA tooling (Page Object Models, selector inventories, flow maps),
not just prose or JSON.

## Primary deliverable priority

1. **Generated test artifacts** (POMs, selector stability reports, testid
   audits) — this is the star feature, and the schema design downstream
   should optimize for this first.
2. **Human-readable site documentation** (markdown site atlas) — free
   byproduct of the same interpretation pass.
3. **Structured extracted data** (SQLite) — the persistence layer everything
   else is built on; not a headline feature on its own.

## Architecture — three loops

1. **Crawler** (deterministic, no AI). URL frontier seeded from the input URL
   plus `sitemap.xml` if present. Same-origin scoping only. URL
   normalization for dedup (strip fragments, sort query params).
   Depth/page limits, robots.txt respect, throttling.
2. **Capture** (per page, via `@treeline/acquire`). Title, meta,
   `ariaSnapshot()`, discovered links, network/XHR log, optional screenshot,
   forms. Persisted to SQLite before any AI touches it — resumable, and
   re-interpretable without re-crawling.
3. **Interpretation** (AI, async, tiered). A worker drains the capture queue
   and sends each snapshot to the Anthropic API. Output feeds the site atlas,
   selector/testid/flow-map reports, and POM generation.

## Crawl scope & boundaries

- Same-origin only (no cross-subdomain by default).
- Phase 1 discovery: link graph (`<a href>`) + `sitemap.xml` + SPA route
  sniffing (watch `history.pushState`). This is what ships in v1.
- Phase 2 (backlog, not built yet): interaction-reachable page discovery —
  pages that only exist after a click, form submit, or filter. Capture
  schema should be designed so this bolts on later without a rewrite.
- Stealth is **opt-in**, off by default. Polite crawling is the default
  posture — you don't want to fingerprint-spoof your own staging
  environment on every run.

## `@treeline/acquire`

The hardened acquisition layer — a standalone package, not just plumbing
inside the crawler. Built as **both a library and a network-callable API
from day one**.

- **Stealth stack:** Patchright (drop-in Playwright fork, actively
  maintained — not `rebrowser-playwright`, which is effectively abandoned as
  of late 2024) + `channel: 'chrome'` (real Chrome, not bundled Chromium) +
  `--disable-blink-features=AutomationControlled`.
- **Reality check:** stealth solves fingerprint-level detection only. It does
  not fix IP reputation, TLS fingerprinting, behavioral analysis, or
  cryptographic challenge systems (Cloudflare, DataDome). Hard targets still
  need residential proxies and human-like pacing on top.
- **HTTP surface:** Fastify, API key auth. Returns a `PageState`: url, title,
  ariaSnapshot, network log, optional screenshot, links, capturedAt.
- **Framing:** authorized-use tooling — QA, accessibility, and sites you own
  or have permission to test. Respects robots.txt and ToS by default.

## AI interpretation

- **2-tier model routing:**
  - **Claude Haiku 4.5** — default tier, simple/structured pages (clear
    nav, standard content, low ambiguity).
  - **Claude Sonnet 5** — complex/ambiguous interpretation (dense
    interactive pages, unclear structure, low-confidence Haiku output).
  - No Opus escalation tier in v1 — kept to two tiers deliberately.
- Pages that fail capture or interpretation (empty snapshot, timeout,
  low-confidence flag) are queued into `hard-pages/` with a reason code
  instead of silently failing or retrying blindly.

## v1 core output set

Ranked by how much they earn their place for an SDET:

1. **Selector stability report** — every interactive element with candidate
   locators ranked (`getByRole` → testid → css → xpath), brittle ones
   flagged. The crown jewel.
2. **data-testid coverage audit** — which interactive elements have no
   stable test hook. A testability scorecard.
3. **Network/API capture** — the site's informal API surface per page.
4. **Markdown site atlas** — human-readable documentation, generated as a
   byproduct of the same interpretation pass.
5. **POM generation** — per-page Page Object Model classes plus skeleton
   Playwright specs, derived from the aria tree.
6. **axe-core accessibility findings** — near-free given the aria tree is
   already captured.
7. **Diff mode** — crawl twice, diff structure/content/selectors between
   runs. A regression radar: "which deploy broke my selectors."
8. **Form & flow map** — every form, its fields, validation, submit target.

**Backlog (Phase 2):** interaction-reachable page discovery (AI decides what
to click to reveal new state).

## Storage / resume model

- SQLite, one file per crawl run. Embedded, zero setup, queryable, and makes
  diff mode between runs straightforward.
- Raw captures persisted before interpretation — a run can be resumed or
  re-interpreted without re-crawling.

## Claude Code integration contract

Claude Code is the tool that **improves** the pipeline, not the runtime that
executes every page. It is **not** in the hot path of a normal crawl.

- **Trigger:** manual. You open Claude Code yourself when `hard-pages/` has
  items — no automated shell-out at end of run.
- **What it does:** reads the queue, writes a bespoke handler matching the
  capture/interpretation interface, tests it, and commits it back into the
  pipeline — so the next crawl handles that pattern deterministically.
- Standalone API calls remain the backbone for a full-site crawl (a
  500-page run needs an assembly line, not an agent loop on every page).

## Repo layout

pnpm workspaces monorepo:

- `packages/cli` — the `treeline` CLI entrypoint
- `packages/core` — crawler, capture orchestration, SQLite persistence
- `packages/acquire` — hardened Playwright/Patchright layer + Fastify API
- `packages/interpret` — AI interpretation, 2-tier model routing
- `packages/output` — atlas generator, POM generator, selector/testid/axe/
  diff/flow-map reports

## Stack

TypeScript, Playwright + Patchright, Fastify, SQLite, Anthropic API (Haiku
4.5 / Sonnet 5), pnpm workspaces, Vitest.

## Open items / Phase 2 backlog

- Interaction-reachable page discovery
- Possible future: other tools (e.g. Shenny) consuming `@treeline/acquire`
  as a remote service rather than a library
