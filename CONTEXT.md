# treeline — CONTEXT.md

_Last updated after session 20. This file reflects what's actually built and
verified, not just the original plan — see the "Status" section for what's
done vs. remaining._

## What it is

An AI-powered site comprehension engine. Point it at a URL and it crawls the
site with a hardened Playwright browser, captures the accessibility-tree and
DOM state of every page, and runs that state through tiered AI interpretation
to produce test artifacts, documentation, and structured data — with Claude
Code as a manual escalation path for pages the pipeline can't parse on its
own.

Not "just a scraper." The differentiator is that it turns a live website into
executable QA tooling (Page Object Models, selector inventories), not just
prose or JSON.

## Status (as of session 20)

**v1 is complete.** All 8 items from the original v1 output list are now
built, tested, and verified against real crawls: selector stability report,
data-testid coverage audit, network/API capture (folded into flow map),
markdown site atlas, POM generation, axe-core accessibility findings, diff
mode (sessions 11-14), and form & flow map (sessions 16-19). This is a real
milestone, not another incremental update — see "v1 core output set" below
for the full per-item breakdown.

**Fully built, tested, and verified against real crawls (goldenpetbrands.com):**

- Crawler (same-origin, sitemap + link-graph discovery, robots.txt, SQLite
  persistence, resumable)
- Hardened capture layer (`@treeline/acquire`) — Patchright stealth, DOM
  interactive-element extraction with real `data-testid`/CSS/XPath ground
  truth, axe-core scanning
- Network-callable Fastify API on `@treeline/acquire` (API key auth)
- 2-tier AI interpretation with retry (`@treeline/interpret`)
- Five reports: selector stability, testid coverage audit, markdown site
  atlas, axe-core accessibility findings, form & flow map
- POM generation + skeleton Playwright specs
- Full CLI (`treeline crawl <url>`) wiring everything above into one command
- `hard-pages/` escalation queue, proven working end-to-end with real
  failures
- **Diff mode** (sessions 11-14) — page-level diff between two crawl output
  directories (pages added/removed, title changes), selector-candidate
  regression/improvement/other classification (diffs each element's
  top-ranked candidate, matched across runs by role + accessibleName +
  occurrenceIndex), a markdown diff report with regressions surfaced first,
  and the `treeline diff <baselineDir> <currentDir> [--output dir]
  [--fail-on-regression]` CLI command
- **Form & flow map** (sessions 16-19) — forms captured as grouped
  structures in `@treeline/acquire` (session 16), persisted in
  `@treeline/core` (session 17), rendered as `flow-map.md` combining forms
  and API surface in `packages/output` (session 18), wired into `treeline
  crawl` as a fifth automatic report in `packages/cli` (session 19)

Nothing structural remains from the original v1 plan.

**Backlog (Phase 2, intentionally not started):**

- Interaction-reachable page discovery (crawling states only reachable via
  click/form-submit)

## Primary deliverable priority

1. **Generated test artifacts** (POMs, selector stability reports, testid
   audits) — the star feature. Done and verified.
2. **Human-readable site documentation** (markdown site atlas) — done.
3. **Structured extracted data** (SQLite) — the persistence layer everything
   else is built on. Done; this is what makes resumability and diff mode
   possible.

## Architecture — three loops

1. **Crawler** (deterministic, no AI). URL frontier seeded from the input URL
   plus `sitemap.xml` if present. Same-origin scoping only. URL
   normalization for dedup (strip fragments, sort query params).
   Depth/page limits, robots.txt respect, throttling.
   **Resumability note:** re-running a crawl against the same `--output`
   path (same SQLite db) skips URLs already persisted and only visits new
   ones. This is by design (session 3), not a bug — but it means comparing
   two runs meaningfully requires a fresh `--output` path, and page counts
   from a repeated run will look lower than expected if you're mentally
   expecting a full fresh crawl.
2. **Capture** (per page, via `@treeline/acquire`). Captures far more than
   the original plan — see "PageState shape" below for the real, current
   field list. Persisted to SQLite before any AI touches it — resumable, and
   re-interpretable without re-crawling.
3. **Interpretation** (AI, async, tiered, with retry). A worker drains pages
   without a stored interpretation and sends each one to the Anthropic API.
   Output is persisted (not just returned) — see "AI interpretation" below.

## PageState shape (as actually captured, `@treeline/acquire`)

Grew significantly beyond the original plan through sessions 1, 4.5, 4.6, 9,
and 9.5:

- `url`, `title`, `ariaSnapshot`, `links`, `capturedAt`, `screenshot`
- `networkLog: NetworkEntry[]` — request/response url, method, status,
  resourceType. Captured since session 1; rendered as the API surface half
  of `flow-map.md` since session 18 (see "Open items" for two known dedup/
  filter gaps in that rendering).
- `interactiveElements: DomInteractiveElement[]` — real DOM ground truth
  per element: `role`, `accessibleName`, `testId`, `tagName`, `elementId`,
  `classList`, `cssPath`, `xpath`. This exists specifically because AI
  guessing at `testIdPresent` from the aria snapshot was unreliable (session
  4.5) — `data-testid` is invisible to the accessibility tree by design.
  **Known limitation:** `accessibleName` resolution is a simplified
  heuristic (`aria-label` → `aria-labelledby` → `textContent` →
  `placeholder`/`value`). It does NOT check for an `<img alt>` descendant or
  `<label for>` association — both real, common sources of an accessible
  name that axe-core's independent computation does check. This means some
  elements this tool reports as "no accessible name" (excluded from role-
  strategy selector candidates, appearing in testid-audit gaps) may
  genuinely have one. Confirmed via a real cross-check: axe-core did not
  flag a logo link or a `<label for="nav-toggle">`-associated checkbox input
  as unlabeled, even though this heuristic reported them as having no
  accessible name. Worth fixing if selector-report/testid-audit accuracy
  becomes a priority — not fixed yet.
- `axeViolations: AxeViolation[]` — confirmed accessibility issues from
  axe-core's `violations` bucket.
- `axeIncomplete: AxeIncompleteResult[]` — axe-core's `incomplete` bucket:
  findings that need human judgment to confirm (e.g. `color-contrast` behind
  a pseudo-element, which axe can't resolve automatically). Added in session
  9.5 after discovering the original session 9 capture only mapped
  `violations`, silently dropping real, serious findings (a `serious`-impact
  `color-contrast` issue on primary nav was found this way).

## Crawl scope & boundaries

- Same-origin only (no cross-subdomain by default).
- Phase 1 discovery: link graph (`<a href>`) + `sitemap.xml` + SPA route
  sniffing (watch `history.pushState`). This is what shipped.
- Phase 2 (backlog, not built): interaction-reachable page discovery.
- Stealth is **opt-in**, off by default (`--stealth` CLI flag).

## `@treeline/acquire`

Built as both a library and a network-callable API from day one.

- **Stealth stack:** Patchright + `channel: 'chrome'` +
  `--disable-blink-features=AutomationControlled`. Note: axe-core's
  `finishRun()` requires an explicit `browser.newContext()` →
  `context.newPage()` setup, NOT `browser.newPage()` directly — the latter
  creates an implicit single-owner context that rejects axe's internal
  helper-page creation. This caused axe to silently fail on every capture
  until caught and fixed in session 9; worth remembering for any future
  capture-layer addition that needs to spin up auxiliary pages.
- **HTTP surface:** Fastify, API key auth (`TREELINE_API_KEY` env var),
  `/health` and `/capture` routes.

## AI interpretation

- **2-tier model routing** (`packages/interpret/src/routing.ts`), heuristic
  based on interactive-element count and `ariaSnapshot` length — no AI call
  needed to decide the tier:
  - **Claude Haiku 4.5** — simple/structured pages.
  - **Claude Sonnet 5** — complex/ambiguous pages.
  - No Opus escalation tier — deliberate.
- **`PageInterpretation` shape** (as of session 4.7 — narrower than
  originally planned): `url`, `tierUsed`, `pageType`, `purpose`,
  `keyDataEntities: string[]`, `confidence`. `interactiveElements` was
  deliberately removed from this type — it's redundant with and less
  accurate than `PageState.interactiveElements` from real DOM capture. Do
  not reintroduce it.
- **Persistence:** `StoredInterpretation` lives in `@treeline/core`, NOT
  `@treeline/interpret` — this is intentional, not an oversight, to avoid a
  circular workspace dependency (`core` has no dependency on `interpret`).
  It mirrors `PageInterpretation`'s shape by field name only, plus
  `interpretedAt`. `runInterpretation(dbPath, hardPagesDir)` in
  `@treeline/interpret` orchestrates: skips pages without a successful
  capture, skips pages that already have a stored interpretation
  (idempotent — safe to re-run), retries once on a malformed response
  before giving up, and routes final failures to `hard-pages/`.
- **Same category of split, session 12:** `computeSelectorCandidates` moved
  from `packages/output` into `packages/core` (as `selector-candidates.ts`),
  since `diff.ts` (also in `core`) needed it and `core` must not depend on
  `output`. Same reasoning as the `StoredInterpretation` placement above —
  keep the dependency direction one-way.
- **Retry:** `MAX_INTERPRETATION_ATTEMPTS = 2` (session 5.99). Real-world
  data across multiple live runs showed roughly a 1-in-3 single-attempt
  failure rate on `keyDataEntities` coming back as a comma-separated string
  instead of a JSON array — genuine per-call model non-determinism, not
  fixed by tightening the schema description alone (tried in session 5.98,
  didn't move the rate). The retry mitigates this; it does not eliminate
  it. Budget for occasional real API cost on retried pages.
- **Real cost data point:** roughly $0.02–0.04 per Sonnet-tier page
  (~3–4k input tokens, a few hundred output tokens for the reduced schema).
- Pages that fail after retries are queued into `hard-pages/` with
  `reasonCode: 'parse-error'` and a truncated real error message in
  `captureSnapshot` (session 5.97 — the original design had this hardcoded
  to `null`; a swallowed-exception bug made early debugging much harder
  than it needed to be, fixed by actually surfacing the real error).

## v1 core output set — status

1. **Selector stability report** — ✅ done. Tracks both `stable` (survives
   DOM changes) and `uniqueOnPage` (resolves to exactly one element right
   now) as independent properties — a candidate can be one without being
   the other. **This is the rule POM generation depends on: only treat a
   candidate as safe to bake into generated code directly when both
   `stable` and `uniqueOnPage` are true.**
2. **data-testid coverage audit** — ✅ done.
3. **Network/API capture** — ✅ done. Captured and persisted since session
   1/3; folded into flow map's API surface table (session 18) rather than
   becoming its own standalone report — see item 8.
4. **Markdown site atlas** — ✅ done. Handles pages with no interpretation
   gracefully (shows a "not yet interpreted" note rather than omitting the
   page) — though note this message doesn't currently distinguish "skipped
   deliberately" from "attempted and failed," which can read as misleading
   when interpretation was intentionally skipped via `--skip-interpretation`.
5. **POM generation** — ✅ done. Generates a class per page with one
   `Locator` property per interactive element that has a stable candidate.
   Elements with no stable candidate are skipped (not given a broken
   locator) and listed in a separate `skipped` array with a reason.
   Duplicate elements (same role + accessible name, e.g. a nav link
   appearing in both header and footer) get deterministic `.nth(i)` scoping
   and numeric-suffixed property names (`aboutLink1`, `aboutLink2`).
   **Known limitation:** this disambiguation is positional only — elements
   with identical text but genuinely different destinations (e.g. three
   "See the brand →" links pointing to three different brand sites) get
   `.nth()`-scoped correctly (the locators are accurate) but the property
   names don't indicate which destination each one is, since `href` isn't
   currently captured on `DomInteractiveElement`. Not a bug, just not
   self-documenting — fixing it would mean adding `href` to the capture
   layer.
6. **axe-core accessibility findings** — ✅ done. Reports both `violations`
   (confirmed) and `needsReview` (axe's `incomplete` bucket) in clearly
   separated sections. **Known limitation:** when many elements share one
   finding (e.g. 13 elements failing the same `color-contrast` rule), the
   report currently shows only one `exampleSelector`, not the full list —
   fine for a portfolio artifact, not yet sufficient for real remediation
   triage at scale.
7. **Diff mode** — ✅ done. Page-level diff (added/removed/title changes)
   plus selector-candidate regression/improvement/other classification
   between two crawl output directories, rendered as a markdown report with
   regressions surfaced first. Exposed via `treeline diff <baselineDir>
   <currentDir> [--output dir] [--fail-on-regression]`.
8. **Form & flow map** — ✅ done. Forms captured as grouped structures
   (fields, `action`, `method`) in `@treeline/acquire` (session 16),
   persisted in `@treeline/core` (session 17), rendered as `flow-map.md`
   combining a forms table and the API surface (from `networkLog`) in
   `packages/output` (session 18), and wired into `treeline crawl` as a
   fifth automatic report in `packages/cli` (session 19).

## Storage / resume model

- SQLite, one file per crawl run (`<outputDir>/crawl.sqlite`). Confirmed
  resumable in practice: pages already in a `pages` table are skipped on a
  re-run against the same db, and `runInterpretation` independently skips
  pages that already have a `StoredInterpretation` row — the two skip
  checks are separate and both idempotent.

## Claude Code integration contract

Confirmed working end-to-end with real failures, not just designed —
`hard-pages/` entries have been produced by genuine `interpretPage`
failures during real crawls.

- **Trigger:** manual. No automated shell-out at end of run.
- **Manifest shape** (as actually implemented, `HardPageEntry`):
  `url`, `reasonCode`, `attemptedAt`, `captureSnapshot` — the latter now
  carries a truncated real error message when available (not always
  `null`, despite the original design).
- **What it does:** reads the queue, writes a bespoke handler, tests it,
  commits it back into the pipeline. Not yet exercised for real (no actual
  hard-page fix has been written through this workflow yet — only the
  queue-writing side has been proven).

## Repo layout (current, real)

pnpm workspaces monorepo:

- `packages/cli` — the real `treeline crawl` command
  (`--stealth`, `--max-pages`, `--max-depth`, `--throttle-ms`, `--output`,
  `--skip-interpretation`), orchestrating everything below. Has its own
  `vitest.config.ts` excluding `treeline-output/` — see CLAUDE.md.
- `packages/core` — crawler, persistence (pages + interpretations tables),
  robots/sitemap, hard-pages writer, `diff.ts` (page + selector-candidate
  diffing), `selector-candidates.ts` (candidate computation)
- `packages/acquire` — hardened Playwright/Patchright capture layer +
  axe-core scanning + Fastify API
- `packages/interpret` — 2-tier AI interpretation with retry + persistence
  orchestration
- `packages/output` — selector report, testid audit, atlas, POM+spec
  generation, axe report, diff report renderer, `flow-map.ts` (forms + API
  surface)

## Stack

TypeScript, Playwright + Patchright, Fastify, SQLite (better-sqlite3),
Anthropic API (Haiku 4.5 / Sonnet 5) via `@anthropic-ai/sdk`, `@axe-core/
playwright`, pnpm workspaces, Vitest, commander (CLI).

## Open items

**Remaining v1 work:** none. All 8 v1 output-set items are done — see
"Status" above.

**Known gaps worth fixing eventually, not blocking:**

- `accessibleName` heuristic gap has broader real-world impact than
  previously documented. A real crawl of httpbin.org/forms/post showed 12
  out of 12 form fields with a blank accessible name in the rendered
  `flow-map.md` forms table — not an occasional edge case, a near-total
  miss on that page. Confirmed to affect `selector-report.md`,
  `testid-audit.md`, and now `flow-map.md`. Promoted to the top of this
  list given the now-confirmed scope (see PageState shape section above for
  the underlying heuristic detail: misses `<img alt>` and `<label for>`).
- The API surface filter (`isApiSurfaceCandidate` in flow map) is
  technically correct per its resourceType-based rule, but can surface
  third-party resource-loading calls that aren't really part of a site's
  business API — confirmed via a real crawl where a Google Fonts request
  was genuinely tagged `resourceType: 'xhr'` by the capture layer and
  correctly included per the rule, even though it isn't meaningfully an
  "API endpoint" in the spirit of the original pitch.
- The API surface dedup logic groups by exact `(method, url)` string match,
  which doesn't collapse URLs carrying per-request tokens — confirmed via a
  real crawl of goldenpetbrands.com where Cloudflare's bot-challenge
  mechanism (a single conceptual thing, hit once per page) was reported as
  5 separate endpoint rows because each request's URL path embeds a unique
  hash. What's actually 2 distinct mechanisms (Cloudflare's challenge,
  Google Fonts) was reported as 6 rows.
- POM property naming doesn't disambiguate same-text/different-destination
  links.
- Axe report's `exampleSelector` doesn't show all affected elements.
- Atlas's "not yet interpreted" message doesn't distinguish skipped vs.
  failed interpretation.

**Phase 2 backlog (unchanged):** interaction-reachable page discovery.
