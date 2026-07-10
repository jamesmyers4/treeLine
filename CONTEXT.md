# treeline — CONTEXT.md

_Last updated after session 36. This file reflects what's actually built and
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

## V2 additions

Work here was never part of the original v1 output list — v1 was already
complete and closed out (see "Status" above) before any of this started. It's
tracked separately so the historical record stays honest about what was
originally scoped vs. what got added afterward. See `V2.md` for the full
candidate roadmap this was picked from.

- **Visual diffing in `treeline diff`** (sessions 21-26, the first completed
  V2 initiative) — `V2.md` originally estimated this at "2-3 sessions"; it
  took 6. Worth recording as a real data point on estimate accuracy, not
  glossed over — treat other `V2.md` session estimates as floors, not
  ceilings.
  - Real screenshot capture: full-page PNG via Playwright's `page.screenshot`
    (session 21) — previously only a `null` placeholder existed on
    `PageState`.
  - Disk persistence with directory-independent, deterministic naming
    (session 22) — see "PageState shape" below for the `screenshot` vs.
    `screenshotPath` split this introduced.
  - Pixel-diff comparison via `pixelmatch`/`pngjs`, `packages/core/src/
    screenshot-diff.ts` (session 23). Uses a 0.1% changed-pixel threshold —
    empirically determined, not guessed: two independent real crawls of
    unchanged pages (example.com and the more visually complex httpbin.org/
    forms/post) both showed a 0% noise floor after pixelmatch's own
    anti-aliasing filtering, so 0.1% keeps a margin above that observed
    floor while staying far below any genuine visual change.
  - Diff-image generation — a rendered pixel-diff PNG buffer produced only
    for pages whose status is `'changed'` (session 24).
  - Rendered into `diff-report.md`'s "Visual Changes" section in
    `packages/output/src/diff-report.ts` (session 25).
  - Automatic file-writing wired into `treeline diff` in
    `packages/cli/src/orchestrate.ts` — writes `reports/visual-diffs/
    <urlHash>.png` for each changed page, no new CLI flag required
    (session 26).
  - **Guarantee preserved:** `--fail-on-regression` remains driven solely by
    selector-candidate regressions (`summary.hasRegressions` in
    `packages/cli/src/index.ts`) — visual changes never affect its exit
    code. Deliberately guarded in session 26; a test in
    `packages/cli/src/orchestrate.test.ts` asserts a visual change is
    reported without setting `hasRegressions`.
- **GitHub Action, Stage A, plus real-world hardening** (sessions 28-32) —
  packaging `crawl` behind a `workflow_dispatch` trigger, then three real
  bugs found and fixed by actually operating it against live sites, not
  just building it.
  - **Stage A** (session 28) — `.github/workflows/crawl.yml`:
    `workflow_dispatch` trigger with `url` (required), `max_pages` (default
    `20`), `skip_interpretation` (default `true`) inputs. Builds all 5
    packages in dependency order, runs under Xvfb — the default
    (non-stealth) capture path launches headed (`headless: false`) with no
    CLI override, so a GitHub-hosted runner needs a virtual display or
    nothing works at all — and uploads the output directory via
    `actions/upload-artifact`. `timeout-minutes: 25` safety net. Verified
    with two successful real runs (hgwllc.com, goldenpetbrands.com),
    including one with real AI interpretation and a real
    `ANTHROPIC_API_KEY` secret. Stage B (GitHub Pages auto-publish) not
    started — see `V2.md` item 2.
  - **Process-lifecycle fix** (session 29) — a real CI run hung for ~1.5
    hours after finishing all its actual work. Root cause: `capturePage`
    only closed its browser on the happy path, so any page-level error
    (caught and swallowed by the crawler's own per-page resilience logic)
    orphaned that browser process and kept Node's event loop alive
    indefinitely. Fixed with a `finally` block in
    `packages/acquire/src/capture.ts` guaranteeing closure on every path,
    plus a `process.exit()` backstop in `packages/cli/src/index.ts`, plus
    the workflow's `timeout-minutes: 25` as a second safety net. Verified
    against the exact site/settings that originally hung — now completes
    in about 2 minutes.
  - **Filename collision bug** (found session 30, fixed session 31) — a
    real-output review of two GitHub Actions crawl outputs found a genuine
    silent-data-loss bug: POM/spec generation overwrote files when two
    different URLs slugified to the same filename (root `/` vs `/home`;
    bare paths vs `.html`-suffixed duplicates). Every other report showed
    correct page counts — only POM/spec output was affected, which is why
    it went unnoticed by build/test alone. Fixed with deterministic
    collision detection and numeric-suffix disambiguation, new file
    `packages/output/src/naming.ts` — mirrors the existing `.nth(i)`-style
    disambiguation already used for duplicate elements within a page (see
    "v1 core output set" item 5 above). **`naming.ts` is now the single
    source of truth for filename assignment** — do not derive a POM/spec
    filename independently anywhere else.
  - **Redirect-origin scope bug** (session 32) — `www.goldenpetbrands.com`
    issues a real 301 redirect, but the crawler was establishing
    same-origin scope from the pre-redirect seed URL and never updating
    it. `sitemap.xml` (fetched via `fetch()`, which follows redirects
    transparently) returned entries on the real post-redirect hostname,
    all of which got filtered out against the stale origin. Fixed in new
    file `packages/core/src/origin-scope.ts`: origin is now resolved from
    the post-redirect URL. Also added detection (sitemap + `rel=canonical`
    signals) for genuine non-redirected hostname mismatches, which warns
    with the specific alternate URL rather than silently auto-widening
    scope — same-origin enforcement stays strict by design; auto-widening
    was considered and rejected (different `robots.txt` per hostname,
    genuinely different content sometimes living at each hostname).
- **GitHub Pages publish, Stage B (sessions 34-35b)** — `crawl.yml`'s Stage
  A (see above) already produced a downloadable artifact; Stage B turns
  that into a shareable, browsable link with no local unzip required.
  - **`packages/pages`** — new package, static HTML renderer for a
    treeline output directory. `renderOutputToHtml(outputDir, targetDir)`
    (`render.ts`) is the entry point: renders every `reports/*.md` file to
    HTML via `markdown-it` (`markdown.ts` — `extractTitle` pulls the first
    `# heading` as the page title, falling back to the filename), renders
    every `poms/*.ts` and `specs/*.ts` file to syntax-highlighted HTML via
    `shiki` (`code.ts`, `github-dark` theme), copies
    `reports/visual-diffs/*.png` through unchanged, and writes a per-run
    `index.html` (`index-page.ts`) linking all of it. All rendered pages
    share one inline stylesheet (`template.ts`) that deliberately reuses
    treeline's own `#1a2744`/`#f4f6f9`/`#aac4ff` palette rather than
    inventing a second look for generated output. `discover.ts` orders
    reports by a fixed known list (atlas, selector-report, testid-audit,
    axe-report, flow-map, diff-report) before falling back to alphabetical
    for anything unrecognized.
  - **`meta.json` capture** (`meta.ts`) — `buildRunMeta(outputDir, mode)`
    opens the run's `crawl.sqlite` (if present) via `@treeline/core`'s
    `openCrawlDb`, reads `db.getMeta()?.seedUrl` and
    `db.getAllPages().length`, and closes the db in a `finally` — same
    "always close in finally" discipline as session 29's browser-lifecycle
    fix, applied here to a db handle instead of a browser. `RunMode` is
    inferred, not passed by the caller with certainty: `render.ts` checks
    whether any rendered report is `diff-report.md` and sets `mode:
    'diff'` if so, `'crawl'` otherwise. This relies on `getMeta()`, a new
    read accessor added to `packages/core/src/persistence.ts` alongside
    the existing `insertMeta` — `crawl_meta` was already written on every
    crawl, but nothing previously read it back out.
  - **Multi-run index** (`runs-index.ts`) — `buildRunsIndex(runsRootDir)`
    scans immediate subdirectories of a `runs/` root, reads each one's
    `meta.json` (skipping any directory that doesn't have one — e.g. a
    non-run file that ended up in the same directory), sorts by
    `renderedAt` descending, and writes a `runs/index.html` table of every
    published run (target URL, mode, rendered timestamp, page count) — the
    landing page for browsing historical runs, not just the latest one.
  - **`scripts/publish.ts`** — the two-subcommand entry point the workflow
    actually shells out to: `render <outputDir> <targetDir>` (wraps
    `renderOutputToHtml`) and `index <runsRootDir>` (wraps
    `buildRunsIndex`). Not a general CLI — just enough surface for the two
    workflow steps that need it.
  - **Workflow wiring** (`.github/workflows/crawl.yml`) — new
    `publish_to_pages` boolean input, **default `false`** (opt-in, not
    opt-out). Reasoning: this repo is public (see the "This repo is
    public" gotcha in CLAUDE.md), and prior real runs (sessions 28-32)
    already crawled live third-party sites the repo owner doesn't own —
    publishing every run's actual content to a public URL by default would
    compound that without a deliberate choice each time. `permissions:
    contents: write` (needed to push to the `gh-pages` branch) and
    `fetch-depth: 0` on checkout (needed so the later `git worktree
    add`/`rebase` steps against `origin/gh-pages` have real history to
    work with, not a shallow clone) were both added alongside this input.
    `@treeline/pages` was added to the build-order step, between
    `@treeline/core` and `@treeline/interpret`. Six subsequent steps are
    all gated on the same condition: render the run to HTML
    (`scripts/publish.ts render`), prepare a `gh-pages` worktree (checks
    out the existing `origin/gh-pages` branch if it exists, otherwise
    creates it fresh as an orphan branch via `git worktree add --detach` +
    `checkout --orphan gh-pages` + `rm -rf .`), copy the rendered run into
    `runs/<github.run_number>/` inside that worktree (deliberately
    `run_number`, the short per-repo incrementing counter, not
    `run_id`/`github.run_id` — much friendlier as a URL path than the long
    globally-unique ID already used for the artifact name), rebuild the
    runs index (`scripts/publish.ts index`), commit, and push — with a
    fetch/rebase/retry fallback if the push is rejected (another run
    landed on `gh-pages` first).
  - **The boolean-input type-coercion bug** (introduced in the session
    34-35b "Wire GitHub Pages publish into crawl workflow" commit, fixed
    the same session) — every one of the six gated steps above originally
    read `if: inputs.publish_to_pages == 'true'`. This silently evaluated
    **false on every run, regardless of what the user actually selected**,
    so triggering the workflow with `publish_to_pages: true` produced an
    artifact but never touched `gh-pages` at all — no error, no visible
    signal, just steps quietly skipped. Root cause: GitHub Actions'
    `inputs.*` context (workflow_dispatch only) preserves the real
    declared type of an input — a `type: boolean` input is a genuine
    boolean there, not a string. `github.event.inputs.*`, by contrast,
    stringifies every input unconditionally. `inputs.publish_to_pages ==
    'true'` therefore compares a real boolean against a string; GitHub
    Actions' expression syntax resolves `==` between mismatched types by
    coercing both sides to numbers, and `true`/`'true'` do not coerce to
    the same number, so the comparison is false whether the underlying
    input was `true` or `false`. Fixed by comparing the boolean directly —
    `if: inputs.publish_to_pages` — with no string comparison at all. This
    is the same class of gotcha as `SKIP_INTERPRETATION` a few lines above
    it in the same workflow, which is safe **only** because that one is
    consumed inside a bash `run:` step (`env: SKIP_INTERPRETATION:
    ${{ inputs.skip_interpretation }}`, then bash's `[ "$SKIP_INTERPRETATION"
    = "true" ]`) — env vars are always strings by the time bash sees them,
    so the string comparison there is correct. The bug only exists in a
    YAML-level `if:` expression, where `inputs.*` is not a string. Verified
    fixed for real, not just by inspection: two real workflow runs after
    the fix (`Publish run 7 (https://example.com)`, `Publish run 9
    (https://httpbin.org/forms/post)`, both 2026-07-10) landed real commits
    on `origin/gh-pages` under `runs/7/` and `runs/9/`, each with a
    correct `meta.json`, rendered reports, POMs, and specs.
  - **Known gap, not yet resolved:** the `gh-pages` branch as it exists on
    the real remote today has `runs/7/`, `runs/9/`, and `runs/index.html`,
    but **no root-level `index.html`** — `scripts/publish.ts index` only
    ever writes `<runsRootDir>/index.html` (i.e. `runs/index.html`), and
    nothing in the workflow creates a landing page at the branch root.
    Combined with this: hitting the repo's actual GitHub Pages URL as of
    this writing 404s, both at the root and at `/runs/index.html` —
    consistent with GitHub Pages serving not actually being turned on yet
    in this repo's Settings (Pages source = `gh-pages` branch root is a
    one-time manual step, see CLAUDE.md, and doesn't happen automatically
    just because the branch exists and has content). Until Pages is
    enabled *and* a root `index.html` exists (or redirects to `runs/`),
    there is no working public URL yet, even though the publish mechanism
    itself is proven. Flagged for an owner decision, not silently fixed
    here — this session is docs-only.

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

- `url`, `title`, `ariaSnapshot`, `links`, `capturedAt`
- `screenshot: Buffer | null` — a real full-page PNG captured via
  Playwright's `page.screenshot` (session 21). This field was previously
  documented here as "captured" when it was actually a hardcoded `null`
  placeholder — that claim was stale and is corrected here. The in-memory
  `Buffer` itself is never persisted directly: `@treeline/core`'s
  persistence layer writes it to disk and stores the relative path instead.
  See `screenshotPath` below — these are deliberately two different names
  for two different representations (session 22), not a naming
  inconsistency.
- `screenshotPath: string | null` — NOT part of the in-memory `PageState`
  captured by `@treeline/acquire`. This is the persisted/read-back field on
  the stored page row in `@treeline/core` (`persistence.ts`): a path to the
  screenshot file on disk, relative to the crawl's SQLite db so it stays
  valid regardless of which directory the tool is invoked from (session
  22). Visual diffing (see "V2 additions" below) reads this field, not
  `screenshot`, when comparing two crawls.
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
  diffing), `selector-candidates.ts` (candidate computation),
  `screenshot-diff.ts` (pixel-diff visual comparison, session 23),
  `origin-scope.ts` (post-redirect origin resolution + hostname-mismatch
  detection, session 32), and `urlHash` in `url-utils.ts` (deterministic
  per-URL hash used to name screenshot and diff-image files, session
  22/26)
- `packages/acquire` — hardened Playwright/Patchright capture layer +
  axe-core scanning + Fastify API
- `packages/interpret` — 2-tier AI interpretation with retry + persistence
  orchestration
- `packages/output` — selector report, testid audit, atlas, POM+spec
  generation (via `naming.ts`'s collision-safe filename assignment,
  session 31), axe report, diff report renderer (now includes the Visual
  Changes section, session 25), `flow-map.ts` (forms + API surface)
- `packages/pages` — static HTML renderer for a treeline output directory
  (markdown-it + shiki), `meta.json` capture, multi-run index generation
  (sessions 34-35b, see "V2 additions" above)
- `packages/cli`'s `orchestrate.ts` — in addition to crawl orchestration,
  now writes `reports/visual-diffs/*.png` diff images for pages with a
  visual change (session 26)
- `.github/workflows/crawl.yml` — `workflow_dispatch` CI crawl trigger
  (session 28) plus opt-in `gh-pages` publish (sessions 34-35b), see "V2
  additions" above

## Stack

TypeScript, Playwright + Patchright, Fastify, SQLite (better-sqlite3),
Anthropic API (Haiku 4.5 / Sonnet 5) via `@anthropic-ai/sdk`, `@axe-core/
playwright`, `pixelmatch` + `pngjs` (visual diff comparison), `markdown-it`
+ `shiki` (GitHub Pages HTML rendering), pnpm workspaces, Vitest,
commander (CLI).

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
