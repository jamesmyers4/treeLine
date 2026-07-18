# treeline — CONTEXT.md

_Last updated after session 53. This file reflects what's actually built and
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
    `ANTHROPIC_API_KEY` secret.
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
    reports by a fixed known list before falling back to alphabetical for
    anything unrecognized.
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
    `meta.json` (skipping any directory that doesn't have one), sorts by
    `renderedAt` descending, and writes a `runs/index.html` table of every
    published run (target URL, mode, rendered timestamp, page count).
  - **`scripts/publish.ts`** — the two-subcommand entry point the workflow
    shells out to: `render <outputDir> <targetDir>` (wraps
    `renderOutputToHtml`) and `index <runsRootDir>` (wraps
    `buildRunsIndex`).
  - **Workflow wiring** (`.github/workflows/crawl.yml`) — new
    `publish_to_pages` boolean input, **default `false`** (opt-in, not
    opt-out). Reasoning: this repo is public, and prior real runs
    (sessions 28-32) already crawled live third-party sites the repo
    owner doesn't own — publishing every run's actual content to a public
    URL by default would compound that without a deliberate choice each
    time. This reasoning was not hypothetical — see the GPB judgment call
    below. `permissions: contents: write` and `fetch-depth: 0` on checkout
    both added alongside this input. `@treeline/pages` added to the
    build-order step, between `@treeline/core` and `@treeline/interpret`.
    Six gated steps: render the run to HTML, prepare a `gh-pages`
    worktree (checks out `origin/gh-pages` if it exists, otherwise
    creates it fresh as an orphan branch), copy the rendered run into
    `runs/<github.run_number>/`, rebuild the runs index, commit, and push
    — with a fetch/rebase/retry fallback if the push is rejected.
  - **The boolean-input type-coercion bug** (introduced and fixed in the
    same session, 35b) — every one of the six gated steps originally read
    `if: inputs.publish_to_pages == 'true'`, which silently evaluated
    **false on every run regardless of the actual input** — no error, no
    visible signal, steps just quietly skipped. Root cause: `inputs.*`
    (workflow_dispatch context) preserves an input's real declared type —
    a `type: boolean` input is a genuine boolean there — while
    `github.event.inputs.*` stringifies everything unconditionally.
    `inputs.publish_to_pages == 'true'` compares a real boolean against a
    string; GitHub Actions' `==` coerces mismatched types to numbers, and
    `true`/`'true'` don't coerce to the same number, so the comparison is
    always false. Fixed by comparing the boolean directly:
    `if: inputs.publish_to_pages`. See CLAUDE.md's gotchas for the full
    writeup, including why `SKIP_INTERPRETATION`'s existing string
    comparison elsewhere in the same file is correct and unrelated (it's
    consumed inside a bash `run:` step via `env:`, where everything is
    already a string by the time bash sees it).
- **Root landing page for GitHub Pages** (session 37) — resolves the gap
  flagged at the end of Stage B's rollout: `scripts/publish.ts index` only
  ever wrote `runs/index.html`, so the bare Pages root URL 404'd even once
  Pages serving was enabled. Fixed with a static file,
  `packages/pages/static/root-redirect.html` (a meta-refresh redirect to
  `runs/`, plus a plain fallback link) — deliberately static rather than
  rendered, since its content never varies. A new "Write root redirect"
  workflow step, in the same `publish_to_pages`-gated group, copies it to
  `gh-pages-worktree/index.html` on every publish run, so it's self-healing
  if the branch is ever rebuilt from scratch rather than a one-time manual
  add. Verified live: the repo's actual Pages root URL now returns 200 and
  redirects correctly to `/runs/`, confirmed via a real triggered run
  (`example.com`, `publish_to_pages: true`) after both this fix and the
  separate one-time repo-Settings changes (see CLAUDE.md) were done. The
  `/runs/` URL itself was and remains unaffected.
- **Coverage-gap report** (session 38, V2 item 3) — `coverage-report.md`,
  wired into `treeline crawl` as the sixth automatic report, same pattern
  flow-map followed when it was added as the fifth (session 19). Four
  sections, all computed from data treeline already tracks — no new
  capture work:
  - **Zero-coverage pages** — every interactive element on the page ended
    up in POM generation's `skipped` array, no locators generated at all.
  - **High-skip pages** — skipped elements exceed 50% of that page's total
    interactive elements. Deliberately a relative threshold, not absolute
    — a 4-element page with 3 skipped is a worse signal than a 200-element
    page with 3 skipped.
  - **Forms without a corresponding generated test** — Step 0 investigation
    found this isn't a per-form defect to detect, it's a currently-always-
    true fact: `generateSpec` (`pom-generation.ts`) produces only a
    page-level skeleton with a single `toHaveURL` assertion — it has never
    referenced form fields, for any form, regardless of page. The report
    states this plainly, with the reasoning, rather than presenting it as
    a per-form finding it isn't. (Session 42's proposed-assertion work,
    below, is the actual answer to this gap — for forms specifically.)
  - **Unresolved hard-pages entries** — a small reader for the
    `HardPageEntry` JSON manifest was added directly in
    `packages/cli/src/orchestrate.ts` (not `core`/`acquire` — kept
    minimal, scoped only to where it's needed), replacing what had been
    just a raw file count with real parsed entries.
  - Verified against a real crawl with deliberately unlabeled/duplicate
    elements, cross-checked by hand against that run's own
    `selector-report.md`/`testid-audit.md` — exact-match counts, and the
    50%-exactly boundary case correctly excluded (threshold is `>50%`, not
    `≥50%`).
  - **Bundled in the same session, unrelated:** a real table-overflow bug
    in `flow-map.md`'s API surface table, reported against a live
    published run — very long unbroken URL tokens (Cloudflare
    challenge-platform paths) pushed the whole page wide, since browsers
    only wrap at whitespace by default. Fixed in
    `packages/pages/src/template.ts`'s shared table CSS:
    `overflow-wrap: anywhere; word-break: break-word;` on `td`/`th`.
    Verified with a real headless-Chromium A/B measurement — the same
    rendered page overflowed its 1024px viewport to 1706px without the
    fix, fit cleanly at 1024px with it. Only affects future renders; not
    retroactively applied to already-published runs.
- **Timing/flakiness signal, first cut** (sessions 39-41, V2 item 4) —
  V2.md's own description of this item claimed it could reuse "capture
  timing data ... that already exists." That claim turned out to be false
  — checking the real `PageState`/`NetworkEntry` shape at the time found
  no timestamps or durations captured anywhere. This item genuinely starts
  in `packages/acquire`, not `packages/output`, confirming V2.md's own
  separate suspicion that it "may need new capture-layer instrumentation."
  Split across three sessions, each proving its output against real data
  before the next was scoped — same discipline as flow map's four-session
  capture/persist/render/wire-in split.
  - **Session 39 — page-load and network-request timing.**
    `PageState.pageLoadMs: number`, wall-clock time from just before
    navigation through the crawler's existing `waitForLoadState
('networkidle')` wait (confirmed as the real wait strategy in Step 0,
    not assumed). `NetworkEntry.durationMs: number`, measured from a
    request event to its matching response event. Both persisted (new
    `pageLoadMs` column on the `pages` table). Cross-checked by hand
    against Chrome DevTools' Network tab for a real page — not just
    asserted non-null.
  - **Session 40 — per-element appearance latency.**
    `DomInteractiveElement.appearedAtMs: number | null` — deliberately
    narrowed to only mean something for elements that render in _after_
    initial page load; trivially inapplicable (and reported as `null`,
    never a fake `0`) for anything already present at initial capture.
    Mechanism: a `MutationObserver` is injected via `page.addInitScript`
    at navigation start, tagging any element inserted after
    `DOMContentLoaded` fires with a `data-treeline-appeared-at` attribute
    — the existing `interactiveElements` `$$eval` pass reads that
    attribute back during its normal DOM traversal, no new communication
    plumbing needed. Elements present at initial load simply have no
    attribute, so they read back as `null`. Verified against a permanent
    (not throwaway) local-fixture test in `capture.test.ts` — one
    immediately-present element, one inserted after a real 700ms-delayed
    `fetch()` response, confirmed `null` vs. a real, sane latency value.
    Kept as a permanent test rather than deleted, since "immediate →
    `null`, delayed → a number in a sane range" is precisely assertable
    against a controlled fixture, unlike, say, a visual-diff pixel
    comparison on a real complex page, which genuinely needs human
    judgment — the throwaway-script convention exists for the latter
    case, not this one.
  - **Resolved in this arc:** an open question from session 39 — whether
    `page.pageLoadMs ?? 0` in `packages/interpret/src/orchestrate.ts` was
    reachable defensive code or dead code. Traced the real invariant:
    `recordPageState` sets `pageLoadMs` atomically with `title`/
    `ariaSnapshot`/`capturedAt`; `markFailed` nulls all four; the
    `capturedPages` filter already excludes `markFailed` rows via the
    other three fields. `pageLoadMs` can therefore never be `null` inside
    that filter — confirmed dead. Changed to a non-null assertion
    (`page.pageLoadMs!`) with a one-line comment stating the invariant, so
    a future reader knows why the assertion is safe rather than having to
    re-derive it. Same pattern found and fixed in
    `packages/interpret/scripts/sanity-check.ts`.
  - **Session 41 — `timing-report.md`.** Wired into `treeline crawl` as
    the seventh automatic report. Three sections, each with an
    empirically-derived threshold, same discipline as visual diffing's
    0.1% pixel threshold — not a guessed number:
    - Slow-loading pages: **2500ms.** Real crawled sites topped out at
      1071ms; deliberately-slow test loads started at 3599ms.
    - Slow network requests: **500ms.** Real requests (including images)
      topped out at 399ms; deliberately-slow ones (`httpbin.org/delay/3`
      and similar) started at 712ms.
    - High-latency element appearance: **2500ms**, but on a genuinely
      thinner empirical basis than the other two — real crawls turned up
      almost no naturally-occurring `appearedAtMs` samples, since the
      crawler doesn't click or scroll, so there wasn't enough real
      distribution to derive a percentile from. Anchored instead to
      Playwright's own default `expect()` timeout (5000ms), halved. This
      weaker basis is stated explicitly in the code, not presented with
      false confidence equal to the other two thresholds.
    - Every section also always surfaces its top 5 slowest/highest-latency
      entries regardless of threshold, so the report has real content
      even on a uniformly fast or uniformly slow site — a pure
      percentile/outlier approach would otherwise report nothing unusual
      on a site where everything is equally slow.
    - Verified with a deliberately-slow real request
      (`httpbin.org/delay/3`) correctly flagged, and fast pages/requests/
      elements correctly not flagged — false positives checked
      deliberately, not just false negatives.
  - **Session 44 — diff-mode timing regression detection, closing the
    item.** Page-load timing only (network-request and element-appearance
    timing diffing are explicit follow-ups, not built this session).
    `packages/core/src/timing-diff.ts`: `diffPageLoadTimingFromPages`/
    `diffPageLoadTiming`, matched on normalized URL (page-level, no
    occurrence-index needed — unlike selector-candidate diffing).
    Threshold derived from real repeated back-to-back crawls with
    identical config, same technique as the visual-diff/timing-report
    thresholds: a pure local fixture (no external DNS/TLS) held run-to-run
    swings within +/-6.4% across 5 runs; a real external multi-page site
    (playwright.dev, 6 pages) held within +/-17%; a real external
    single-page site (example.com, 5 runs) held within +/-15% for 4 of 5
    runs, but one run spiked to +126% from what looks like a cold DNS/TLS
    handshake after connection reuse expired. Set
    `TIMING_NOISE_THRESHOLD_PERCENT = 50` — real margin above the ~17%
    ceiling observed across both local and normal external-network
    profiles, while explicitly documenting the rare cold-connection
    outlier as a known, unresolved false-positive source (an inherent
    limitation of relative page-load-time diffing against external
    network-bound sites, not something a static threshold alone solves).
    Wired into `CrawlDiff.timingChanges` in `diff.ts`, a new `## Page Load
    Timing Changes` section (regressions/improvements, same
    `sanitizeMarkdownTableCell` discipline as every other diff section) in
    `packages/output/src/diff-report.ts`, and a `treeline diff`
    `--fail-on-regression` guarantee test proving a timing regression
    never sets `hasRegressions` — report-only, same as visual changes.
    Verified against real data, not just fixtures: a real baseline crawl
    of a local fixture vs. a real second crawl of the same fixture with a
    genuine 2-second server-side delay produced a real
    516ms→2533ms/+390.9% regression entry, correctly bucketed, with
    `--fail-on-regression`'s exit code confirmed still `0`.
- **AI-proposed test assertions, first cut — forms only** (session 42, V2
  item 5) — extends `StoredInterpretation` with
  `proposedAssertion: ProposedAssertion | null`, attempted only for pages
  with at least one captured form (gated before the AI call, not after).
  Scoping decisions locked in before any code was written, given this is
  the first V2 item that touches generated test _logic_ rather than
  structure:
  - **Every proposed test lives in a separate `*.proposed.spec.ts` file**,
    never merged into the trusted generated `.spec.ts` — mirrors this
    project's existing pattern of keeping trusted/suggested data in
    separate types and files (`StoredInterpretation`/`PageInterpretation`,
    POM/spec) rather than blurring the boundary in one shared file.
  - **Every proposed test is wrapped in `test.skip(...)`** — real,
    complete, editable Playwright code, but never runnable by default. A
    human deletes one line to enable it after review; nothing runs
    silently against a real target just by running the suite. Verified
    for real, not just asserted: the generated file was run through
    `npx playwright test` and confirmed to report "1 skipped," not
    executed.
  - **Proposed fill values are deliberately, obviously synthetic**
    (`"Test User"`, `"test@example.com"`) — a second, independent safety
    layer beyond `test.skip`, in case a human ever removes the skip
    without fully reading the file.
  - **Treeline itself never fills or submits anything during generation**
    — stays entirely passive/read-only, same as every other part of this
    codebase. The AI only ever writes code describing what a test _could_
    do; it never acts on a live page to produce that description.
  - **The success assertion is explicitly stated as an unverified guess**,
    in the generated file itself (a comment, not just this document) —
    treeline has never observed real post-submission behavior for any
    page it's crawled, so any "assert success" claim is a plausible guess
    based only on the page's captured pre-submission state, not a checked
    fact the way everything else treeline generates is.
  - **A real bug, caught by the mandated manual check:** the first version
    matched the model's own freeform `accessibleName` guess back to
    captured form fields, as the lookup key. On `httpbin.org/forms/post`
    (genuinely unlabeled inputs), the model recognized the well-known URL
    and invented plausible-sounding labels instead of describing what it
    actually saw — so locators never matched real fields, and
    checkbox/radio fields got `.fill()` instead of `.check()`. Fixed by
    ensuring field identity always traces back to the real captured field
    array; the model may propose values and scenarios, but never gets to
    serve as the identity/matching key for structured data. General
    lesson, not just a one-off patch: **never let a model's freeform
    natural-language output serve as a lookup key against deterministic,
    structured data.**
  - **Values are safe by construction, not by manual escaping** — every
    dynamic value spliced into the generated spec (`fill()`/
    `selectOption()` arguments, locator strings, the scenario title, even
    the target URL) goes through `JSON.stringify(...)`, which handles
    quote/newline escaping as an inherent property of what it does. The
    one place that genuinely needed a different technique —
    `successAssertion`/`successAssertionCaveat`, spliced into a `//`
    comment rather than a quoted string literal — got `toSafeComment()`
    (strips embedded newlines) specifically because a code comment has no
    equivalent to matched-quote escaping; see session 43 below for how
    this was confirmed complete.
  - **Deliberately not built in this first cut:** anything beyond
    form-fill-and-submit scenarios; a way to "promote" a reviewed-good
    proposal into the trusted spec (plain copy-paste may be entirely
    sufficient); a summary report of how many proposals exist across a
    crawl.
- **Escaping/injection audit** (session 43) — not a V2.md roadmap item;
  reactive hardening work, prompted by a direct question about whether a
  dedicated review pass would surface anything a feature-scoped session
  wouldn't. It found real things. Scope: every path where crawled or
  AI-derived content reaches the HTML actually published to the live,
  public `gh-pages` site — stakes that didn't exist before Stage B turned
  markdown files someone might read in a terminal into HTML served to
  anyone visiting a public URL.
  - **Confirmed safe by design, verified empirically, not assumed:**
    `markdown-it`'s `html: false` config (`packages/pages/src/
markdown.ts`) fully blocks raw HTML/script injection, in prose and in
    table cells alike; markdown-it's default link validator already
    rejects `javascript:`/`data:` URI schemes in `[text](url)` links;
    `naming.ts`'s filename generation can't produce path traversal
    (segments joined with `-`, never `/`, and the WHATWG URL API
    percent-encodes dangerous characters in a pathname), so unescaped
    `href` interpolation in `index-page.ts`/`runs-index.ts` was already
    safe.
  - **Fixed — `escapeHtml` gap:** `packages/pages/src/template.ts`'s
    existing HTML-escaping function (built in session 34) was missing the
    `'` character from the five it's required to escape. Added.
  - **Fixed — real content-integrity bug, not XSS:** crawled titles,
    URLs, `accessibleName`, and AI-derived text were spliced directly
    into markdown source with no handling of `|` or embedded newlines.
    Verified live: a `|` silently truncated a table row (columns
    dropped), and an embedded newline injected a fake `<h1>` heading plus
    a real clickable link into a report. Correctly categorized as content
    spoofing rather than XSS — markdown-it's `html:false` and its
    link-scheme validator genuinely do block code execution here — but a
    real integrity problem regardless: a crawled site could make its own
    fabricated content appear as if it were part of treeline's own
    published report. Fixed with a new file,
    `packages/output/src/markdown-safety.ts`
    (`sanitizeMarkdownText`/`sanitizeMarkdownTableCell`), applied at every
    untrusted-string interpolation point across all eight report
    generators (`atlas.ts`, `axe-report.ts`, `selector-report.ts`,
    `testid-audit.ts`, `coverage-report.ts`, `timing-report.ts`,
    `flow-map.ts`, `diff-report.ts`).
  - **Fixed — comment-breakout risk:** in `proposed-assertions.ts` (see
    session 42 above), `successAssertion`/`successAssertionCaveat` were
    the only two dynamic values in that file spliced into a `//` comment
    rather than a `JSON.stringify`-escaped string literal — an embedded
    newline could break out of the comment into raw, uncommented
    generated TypeScript. Fixed with `toSafeComment()`. Confirmed in
    follow-up review that every other dynamic value in that same file
    (`.fill()`/`.selectOption()` arguments, locators, the scenario title,
    `page.url`) was already safe by construction via `JSON.stringify`, so
    this was the one genuine gap, not one of several.
  - **Permanent regression test:**
    `packages/pages/src/injection-safety.test.ts` — a real `PageState`
    with a `<script>alert(1)</script>` title and pipe-laden titles/names
    runs through the actual `@treeline/output` generators and
    `renderOutputToHtml`, asserting no live `<script>` tag and no table
    corruption in the final HTML. Manually verified against raw HTML
    bytes, not just test assertions — the payload appears only as
    `&lt;script&gt;`, the pipe payload stays inside one `<td>`, and the
    injected-heading attempt renders as inert text.
- **AI-proposed test assertions, extended beyond forms** (session 45, V2
  item 5 extension) — widens `ProposedAssertion` from session 42's single
  form-fill shape into a discriminated union:
  `FormFillAssertion` (`kind: 'form-fill'`, today's shape unchanged plus
  the discriminant) and a new `ContentPresenceAssertion`
  (`kind: 'content-presence'`, `elementIndices: number[]` +
  `assertion`/`assertionCaveat`). `ProposedAssertion` is exported as
  `FormFillAssertion | ContentPresenceAssertion`. Two additive proposal
  paths, kept mutually exclusive on `pageState.forms.length` — never both
  attempted for the same page, so the review surface per crawl stays one
  proposal per page, same as session 42.
  - **Part A — search-form scenarios.** Session 42's prompt told the model
    to set `applicable: false` for "a search box, a single free-text
    filter" — an undocumented, overly conservative default, not an
    architectural limit. Removed the carve-out; added guidance that a
    search/filter-primary form should get a success assertion phrased as
    an observable state change (results appearing, an item count
    changing, the URL reflecting the query), never a confirmation-message
    pattern search pages don't have. Still a `FormFillAssertion` under the
    hood — no new type needed for this half. Verified against a real
    target: crawling `en.wikipedia.org` (its site-wide header search form
    counts as a captured form on every page) produced a real proposed
    spec phrased as "the browser URL changes to include the search query
    ... and either a matching article or a search results list is
    displayed" — correctly avoiding a confirmation-message guess.
  - **Part B — content-presence assertions for form-less pages.** New
    proposal type, gated on `forms.length === 0`. Grounding constraint
    decided before writing code: `packages/acquire/src/capture.ts` only
    produces structured, locator-backed data
    (`cssPath`/`xpath`/testId/accessibleName) for elements matching
    `'button, a[href], input, select, textarea, [role]'`
    (`DomInteractiveElement[]`) — plain body text (a heading, a price, an
    article paragraph) has no structured locator anywhere, only the
    unstructured `ariaSnapshot` sees it. So a content-presence assertion
    can only ever reference **already-captured interactive elements**,
    never a freeform `getByText` guess against body copy — the same
    discipline session 42 already established (never let a model's
    freeform text serve as the lookup key against structured data)
    applied to a new surface: `elementIndices` are bounds-checked against
    the real `interactiveElements` array both at proposal time
    (`packages/interpret/src/interpret.ts`'s `proposeContentAssertion`,
    filters out-of-range indices, returns `null` if none survive) and
    again defensively at render time
    (`packages/output/src/proposed-assertions.ts`'s
    `renderContentPresenceSpec`). Locator generation
    (`buildContentElementLocator`) mirrors the existing form-field
    fallback chain exactly: accessibleName → testId → cssPath.
  - **Review posture is identical for both new paths** — still
    `*.proposed.spec.ts`, still `test.skip`-wrapped, still one call away
    from being merged only by a human, despite a content-presence
    assertion being arguably better-grounded (it checks something
    treeline actually observed, not behavior it never watched happen).
    Treeline hasn't earned automatic trust for AI-authored assertions
    regardless of assertion type, and that posture isn't being revisited
    piecemeal.
  - **Escaping discipline held without a new gap:** both new dynamic
    fields (`ContentPresenceAssertion.assertion`/`assertionCaveat`) go
    through the same `toSafeComment()` session 43 already required for the
    form-fill success assertion/caveat — confirmed via a dedicated test
    (embedded newline collapses to a single commented line rather than
    breaking into a bare, uncommented statement) for both kinds, not
    assumed to carry over.
  - **Verified against real data, not just fixtures, for both halves:** a
    real crawl of `en.wikipedia.org/wiki/Web_scraping` (Part A, above) and
    a real crawl of `www.gnu.org/software/bash/manual/bash.html` — a
    form-less page — produced a real content-presence spec referencing 6
    genuinely captured TOC links (spot-checked one locator,
    `getByRole('link', { name: '1 Introduction' })`, against the crawl's
    own stored `interactiveElements`: real `cssPath: "#toc-Introduction"`
    on disk, not a fabricated element). Both generated specs were then run
    through a real `npx playwright test` and confirmed to report "2
    skipped," not executed.
  - **Deliberately not built this session:** a way to "promote" a
    reviewed-good proposal into the trusted spec; a summary report of how
    many proposals exist, or of which kind, across a crawl. Both remain
    open future items, same as session 42 left them, now just also
    scoped to two assertion kinds instead of one.
- **JSON response-body capture** (session 47) — not a `V2.md` roadmap item;
  grew directly out of a real jobSearch-recon crawl against
  `careers.quarterhill.com`: `flow-map.md`'s API Surface table surfaced a
  real internal JSON endpoint, but with no body captured, a manual `curl`
  was needed to see what it actually returned. This closes that gap.
  - **Opt-in, off by default** — new `--capture-response-bodies` CLI flag
    (`CrawlConfig.captureResponseBodies?: boolean`, `AcquireOptions.
captureResponseBodies?: boolean`), same posture as `--stealth` and
    `--skip-interpretation`: everything captured elsewhere is a structured
    record of what a browser would visibly show a human; response bodies
    can include fields never rendered anywhere, so this doesn't get to be
    a silent default.
  - **Dedup at capture time, via crawl-level shared state.** A
    `Set<string>` of `${method} ${url}` keys — `sampledEndpoints` — lives in
    `packages/core/src/crawler.ts`'s `crawl()` function alongside `visited`,
    threaded through `AcquireOptions` into every `capturePage()` call across
    the whole crawl (same Set instance every iteration, not a fresh one per
    page), so a shared endpoint hit by multiple pages is only sampled once.
  - **Fixed size cap, no second CLI flag** — `MAX_RESPONSE_BODY_BYTES =
    51200` in `packages/acquire/src/capture.ts`. Over the cap: don't
    capture, don't truncate — `responseBodySample` stays `null`, same as
    every other ineligible case (non-JSON content-type, non-xhr/fetch
    `resourceType`, already sampled, body read threw). A truncated JSON
    fragment would be worse than nothing.
  - **Async body read, `Promise.all`-gated return.** `capture.ts`'s
    `page.on('response', ...)` handler still pushes each `NetworkEntry`
    synchronously as before; only when eligible does it kick off an async
    body read that mutates the already-pushed entry object in place once
    resolved. Every such read is tracked in a `bodyReads` array;
    `capturePageWithBrowser` `await`s `Promise.all(bodyReads)` before
    returning — proven with a dedicated test using a deliberately
    slow-arriving response body (matching the session 40 technique of a
    small local server with genuinely delayed content, not a live site) to
    confirm the wait is load-bearing, not just that the code compiles.
  - **New code-fence-safe escaping helper** — `packages/output/src/
markdown-safety.ts`'s `safeCodeFence(content)`, finds the longest run of
    consecutive backticks in the content and returns a fence one backtick
    longer (minimum three). Existing `sanitizeMarkdownText`/
    `sanitizeMarkdownTableCell` are built for inline text and table cells,
    not multi-line fenced code blocks — a response body containing a stray
    triple-backtick sequence breaks out of a fence the same way an
    unescaped `|` breaks a table cell, and neither existing helper covered
    it before this session.
  - `flow-map.ts`'s `ApiSurfaceEntry` gained `responseBodySample: string |
    null`; `renderFlowMapMarkdown` adds a new "Sample Response Bodies"
    subsection below the existing API Surface table (which is left exactly
    as-is — body content in table cells would wreck table formatting), one
    fenced block per endpoint with a sample, pretty-printed via
    `JSON.parse`/`JSON.stringify(_, null, 2)` with a raw-text fallback if
    parsing fails, routed through `safeCodeFence` before wrapping.
  - **Verified against real data, not just fixtures:** a real crawl of
    `careers.quarterhill.com` (`--capture-response-bodies --throttle-ms
    5000`, respecting its real `crawl-delay: 5`) produced real,
    correctly pretty-printed samples in `flow-map.md`'s new section for two
    genuinely-hit JSON endpoints (`/api/jasession`, `/api/alrts/
hasTalentCommunityAlrts`) — the actual case that motivated the session.
    A timed before/after comparison (same crawl, flag on vs. off) showed
    no meaningful difference in total wall-clock time (~26s either way,
    dominated by the 5s per-page throttle) — async body reads running
    alongside the existing throttle delay don't meaningfully slow a crawl
    down.
  - **Session 47b — the fixed 51200-byte cap from session 47 was an
    unvalidated guess, and it was wrong for the endpoint that motivated the
    whole feature.** `curl -s -o /dev/null -w '%{size_download} bytes\n'
    https://careers.quarterhill.com/api/jobs` returned **379,382 bytes** —
    over 7x the session 47 cap — so `/api/jobs` itself never got a sample
    in that session's real-crawl verification, even though two smaller
    endpoints on the same site did. Not a logic bug on its own, just an
    empirical size assumption that didn't hold once checked against the
    actual motivating endpoint.
    - Fix: the cap is now `--max-response-body-bytes <n>` (default
      `512000`), threaded the same path `--capture-response-bodies`
      already follows — CLI flag → `CrawlConfig.maxResponseBodyBytes` →
      `crawler.ts` → `AcquireOptions.maxResponseBodyBytes` →
      `capture.ts`'s `DEFAULT_MAX_RESPONSE_BODY_BYTES` fallback. `512000`
      is real headroom over the confirmed 379,382-byte case, not another
      derived/empirical number.
    - **Second bug found in the same real-data pass:** `sampledEndpoints`
      was being marked (`.add(key)`) *before* the body read was attempted,
      not after. A transient failure (a thrown `res.text()` — redirected
      or already-consumed response) permanently locked that endpoint out
      of ever being sampled again for the rest of the crawl, even from a
      later page where the same call might succeed cleanly. Fixed by
      moving `sampledEndpoints.add(key)` inside the `try`, after the read
      resolves — so only a *conclusive* result (successful read, whether
      under the cap or over it — response size is effectively
      deterministic within one crawl, so over-cap doesn't need a retry
      either) marks the endpoint sampled; a thrown read leaves it eligible
      for retry on a later occurrence.
    - Closed a test-coverage gap that should have shipped with session 47:
      `packages/acquire/src/capture.test.ts` didn't exist as a real test
      suite until this session even though the feature had landed —
      added, including a dedicated regression test for the lockout bug
      (first call's read forced to throw via a redirect response, whose
      body Playwright documents as unreadable — a same-instance socket
      reset turned out to be silently absorbed by Chromium's own
      transparent retry-on-reset behavior within a single page load,
      making it useless for testing this specific bug; the redirect
      technique is deterministic instead) followed by a second call to the
      same endpoint succeeding.
    - Re-verified against `careers.quarterhill.com` with the new default:
      `/api/jobs` now appears in `flow-map.md`'s "Sample Response Bodies"
      section with a real, correctly pretty-printed sample — the specific
      case that was missing before this session.
- **Color scheme capture** (session 48) — not a `V2.md` roadmap item;
  prompted by a direct question about whether treeline captures the colors
  used on a crawled page. Step 0 confirmed it didn't: no color data existed
  anywhere in `PageState`, `DomInteractiveElement`, or any of the nine
  existing report generators — axe-core's `color-contrast` rule only
  reports a pass/fail contrast violation, never the actual color values, on
  the one element it examines.
  - **Capture** (`packages/acquire/src/capture.ts`) — new
    `extractColorPalette(page)`, sampling `getComputedStyle().color` and
    `.backgroundColor` over a fixed structural selector
    (`body, header, nav, main, footer, h1–h6, p, a, button, input,
    [class*="btn" i]`), deliberately narrower than every element on the
    page (`*`) to avoid an unbounded DOM walk on large pages. `rgb()`/
    `rgba()` values are normalized to hex; fully-transparent values (alpha
    `0`, e.g. an unset `background-color`) are dropped rather than reported
    as a real color. Aggregated by `(property, hex)` into a `ColorSwatch[]`
    (`hex`, `property: 'color' | 'background-color'`, `usageCount`,
    `exampleSelector`), sorted by usage and capped at `MAX_COLOR_SWATCHES =
    20` per page. New `PageState.colorPalette: ColorSwatch[]` field.
  - **A real bug caught by the mandated manual/test check, not just
    asserted:** `computeCssPath` — the same selector-path helper duplicated
    across this file's `$$eval` callbacks (see `naming.ts`/duplication
    notes elsewhere in this doc) — was written for the interactive-element
    and form-field cases, where the target is never `document.body`
    itself, and deliberately stops walking at `document.body` without
    including it in the path. `extractColorPalette`'s selector list
    includes `body` directly (it's real, common source of a page's
    background color), and calling the existing helper on `document.body`
    itself returned an empty string, not `"body"` — caught by a real
    Playwright-driven test against a local fixture asserting
    `exampleSelector.length > 0`, not just that a hex value was captured.
    Fixed by adding a `target === document.body` special case at the top
    of this function's own copy of the helper only — the two pre-existing
    copies (interactive elements, form fields) were left untouched since
    neither is ever called on `document.body`.
  - **Persistence** — new `colorPalette` TEXT column on `pages`
    (`packages/core/src/persistence.ts`), `JSON.stringify`/`parse`,
    identical pattern to `forms`/`axeViolations`. Round-trip tests added
    (non-empty, empty-as-`[]`-not-null, isolation across multiple page
    rows) mirroring the existing `forms persistence` test block.
  - **Report** — `packages/output/src/color-report.ts` →
    `reports/color-report.md`, wired into `treeline crawl` as an automatic
    report alongside the other nine. Two sections: a **site-wide color
    scheme** (colors aggregated across every captured page, ranked by total
    usage — the actual answer to "what colors does this site use," not
    just a per-page dump) and **per-page colors** (top 10 per page, with
    hex, property, usage count, and example selector). Every dynamic
    string goes through `sanitizeMarkdownTableCell`, same discipline as
    every report since session 43's audit.
  - **Text/hex table only, no generated swatch image** — a deliberate
    scope decision, confirmed before writing code: `markdown-it`'s
    `html:false` (session 43, not touched) means a literal colored swatch
    box can't be rendered as raw HTML in the `.md` report. A real PNG
    swatch strip (reusing `pngjs`, already a dependency from visual
    diffing) was considered and explicitly deferred — hex-code text is
    simpler, faster to verify, and avoids a new artifact type for a first
    cut. Worth revisiting if real usage asks for it.
  - **Always-on, not gated behind a flag** — unlike
    `--capture-response-bodies`, colors are already visible to any human
    looking at the page in a browser, same posture as every other existing
    report (selector, axe, timing, etc.). No new CLI flag.
  - **Shared-type fixture fallout, confirmed the hard way (again) that
    `vitest` doesn't catch this — only a real `build` does:** adding the
    required `colorPalette` field to `PageState` broke test fixtures across
    all six packages (25 files constructing a `PageState`/`CrawledPage`
    object). Caught entirely via `pnpm --filter <pkg> build` per package,
    not via `vitest` — one fixture specifically
    (`packages/output/src/proposed-assertions.test.ts`'s main `makePage`
    helper) used `forms: [makeForm()]` rather than the `forms: []` pattern
    most other fixtures used, so a first pass of fixes missed it and it
    only surfaced once `tsc` ran. Same lesson this doc already documents
    under "Operational gotchas" — recorded again here as the fourth
    real instance, not a new lesson.
  - **Verified against a real site, not just fixtures:** a real crawl of
    `example.com` (`--skip-interpretation`) produced a real
    `color-report.md` — `#eeeeee` background (1 usage, `body` selector),
    `#000000` text (4 usages, correctly aggregated across the page's
    heading/paragraphs/body), and `#334488` link text (1 usage, a real
    `div > p:nth-of-type(2) > a` selector) — matching example.com's actual
    known styling, not fabricated output.

## Authenticated crawling (sessions 49-52, built and verified)

Not a `V2.md` roadmap item; prompted by a direct question about crawling
sites that sit behind a login (motivating example: OpenEMR, an open-source
EMR with a standard admin/pass login splash). This section is the output
of a dedicated grill session (`domain-modeling` discipline, run against a
second-opinion proposal in `CLAUDEAIPROPOSAL.md`) held *before* any code
was written. The design below was locked before any of the four build
sessions ran; all four have since run and this reflects what actually got
built, not just the original plan — real deviations from the original lock
are called out explicitly in "Session 52 — implementation notes" near the
end of this section rather than silently folded into the design as if it
had been the plan all along.

### The structural constraint that shapes everything here

`capturePage()` (`packages/acquire/src/capture.ts`) launches a brand-new
browser for every single page in a crawl, not once per crawl. So "log in
once, crawl the whole site" cannot mean "keep one logged-in browser alive"
— it means capture Playwright's `storageState` (cookies + localStorage)
once via a real login, then re-seed that state into every subsequent
per-page browser context via `browser.newContext({ storageState })`. Same
threading shape already used for `sampledEndpoints` (session 47): one
shared value resolved before the crawl starts, passed through
`AcquireOptions` into every `capturePage()` call.

### Terms (glossary)

- **Login credentials** — username + password supplied for an
  authenticated crawl. Never persisted anywhere, in any form, at any
  point — see "Credential and session-state handling" below.
- **Session state** — Playwright's `storageState`, captured once after a
  *verified* successful login. Held in memory only, for the lifetime of
  one `treeline crawl` invocation. Never written to disk, never part of
  `CrawlConfig`.
- **Success indicator** — a required, user-supplied CSS selector that is
  present if and only if the current session is authenticated (e.g. a
  logout link, a user-menu element). Selector-only, deliberately — no
  URL-substring mode; matches this repo's existing locator-first
  convention (role → testid → CSS → XPath ranking).
- **Auth wall** — a page that appears to require authentication,
  encountered while no login was configured for this crawl at all.
  Detection is opt-in (`--detect-auth-wall`, default `false`) — see
  "Resolved: auth-wall detection is opt-in" below.
- **Auth expiry** — loss of a *previously-verified* authenticated session
  partway through a crawl.

Auth wall and auth expiry are two distinct detection mechanisms for two
distinct preconditions, not two names for the same thing — conflating them
was considered and rejected during the grill session (see below).

### Why two mechanisms, not one

The obvious single mechanism — "does this page contain a password-type
form field," free from already-captured `PageState.forms`, no new DOM work
— has a real false positive against the actual motivating target: OpenEMR
has an admin "change password" page reachable while fully, legitimately
authenticated. Detecting auth loss via password-field presence alone would
misfire on it.

Resolution: the required success indicator is reused for *two* jobs, and
the password-field heuristic is scoped to exactly the one case where it
can't produce that false positive:

- **Auth expiry** (auth WAS configured): checked via `checkAuthStillValid`
  (below) — the success indicator's absence, or a redirect back to
  `loginUrl`. A change-password page still shows the indicator (nav
  chrome, logout link), so it doesn't false-positive.
- **Auth wall** (auth was NOT configured at all): checked via the
  password-field-in-`forms` heuristic — safe here specifically *because*
  no legitimate authenticated content exists in this scenario to
  false-positive against.

### `checkAuthStillValid` — the auth-expiry check

Lives in `packages/acquire/src/auth.ts`, used both to verify the initial
login (`performLogin`) and, per page, during the crawl:

```ts
function normalizeForComparison(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname.replace(/\/$/, '')}${u.search}`
  } catch {
    return url
  }
}

async function checkAuthStillValid(page: Page, indicator: string, loginUrl: string): Promise<boolean> {
  if (normalizeForComparison(page.url()) === normalizeForComparison(loginUrl)) return false
  return (await page.locator(indicator).count()) > 0
}
```

Two signals, not one: OpenEMR-class server-session PHP apps commonly
redirect straight to the login route on session expiry with no
authenticated-looking chrome rendered at all — a selector-only check would
miss that case entirely. `normalizeForComparison` is a small,
`acquire`-local helper (trailing-slash tolerant) — deliberately NOT
`core`'s `normalizeUrl` (fragment-stripping, query-sorting, built for
crawl-dedup/diff-matching — overkill here, and importing it would create a
circular workspace dependency: `core` already depends on `acquire`, not
the other way around).

**Check ordering vs. timeout, deliberately:** this check runs as the
*last* step of `capturePageWithBrowser`, after DOM/axe/forms/color/
screenshot capture all complete — not before. `page.goto`'s own timeout
sits early in the function and propagates through `crawler.ts`'s existing
`err.message.includes('timeout')` branch untouched, before this check ever
runs — a slow-rendering page fails into `timeout`, never gets
misattributed as `auth-expired`. Cost: a page about to be discarded still
pays for full capture first; accepted, since an auth-expired hit aborts
the whole crawl immediately afterward anyway (below) — a one-time cost,
not a recurring one.

**Verification requirement, not an assumption:** before this check is
trusted as a circuit breaker, session 4 (below) must verify the chosen
success-indicator selector is actually present on every authenticated
OpenEMR page template it's tested against — including print views,
modals, and iframe-heavy screens — against a real instance, not asserted
from reading OpenEMR's markup once.

### Credential and session-state handling — locked

- `--username <user>` is a CLI flag (not sensitive — same posture as a
  username displayed on-screen by the login UI itself).
- Password is `TREELINE_LOGIN_PASSWORD`, an env var only, never a CLI
  flag — same reasoning as this repo's existing `ANTHROPIC_API_KEY`
  gotcha (shell history / `ps` exposure, see CLAUDE.md). `runTreelineCrawl`
  fails fast if `--username` is set but the env var isn't, mirroring the
  existing `ANTHROPIC_API_KEY` check at the top of that function.
- `storageState` and raw credentials are threaded as their own function
  parameters (`crawl(config, dbPath, hardPagesDir, authSession?)`),
  **never** added as `CrawlConfig` fields. `crawler.ts` already does
  `db.insertMeta(config.seedUrl, config)`, which `JSON.stringify`s the
  *entire* `CrawlConfig` into `crawl.sqlite`'s `crawl_meta` table — and
  that db file sits inside `treeline-output/`, which
  `.github/workflows/crawl.yml` uploads wholesale as a public GitHub
  Actions artifact. Anything added to `CrawlConfig` would leak into a
  public artifact — the same class of mistake as the `ANTHROPIC_API_KEY`
  echo incident, just a new instance of it, avoided here by keeping
  credentials and session state structurally outside the type that gets
  persisted rather than by remembering to scrub them later.
- No caching of `storageState` to disk to skip re-login on a resumed
  crawl — every `treeline crawl` invocation with auth flags does a fresh
  login. A session cookie is functionally as sensitive as the password
  itself (anyone holding it can act as that user); this is the GPB
  judgment call (below), one level worse, if it were ever cached under
  `treeline-output/`.

### Resumability — the `markFailed` gap this design specifically avoids

`persistence.ts`'s `pageExists(url)` is status-blind: `SELECT 1 FROM pages
WHERE url = ?` returns true for *any* row, successful or failed. The
existing `timeout`/`parse-error` reason codes already call `markFailed`,
which means those, too, already cause permanent resume-skip on a re-run —
a pre-existing property of the whole system, surfaced (not introduced) by
this design. It hasn't bitten anyone yet because those reason codes aren't
usually "fixable by re-running with different input" the way an expired
session or a missing `--username` are.

Both new reason codes deliberately do **not** call `markFailed`:

- **`auth-expired`** — page 8 of a crawl that already correctly captured
  pages 1–7 must not be permanently poisoned in `pages`; a future resumed
  run (fresh session) needs to actually retry it, not silently skip it
  forever.
- **`auth-wall`** — a page hit with no `--username` configured must be
  retried on a later run where the user *does* provide credentials — same
  reasoning.

The `hard-pages/` manifest entry is written in both cases regardless
(separate file from `crawl.sqlite`), so nothing about visibility to
`coverage-report.md` is lost — only the SQLite resumability record is
handled differently, deliberately, for these two reason codes. (Worth
revisiting for any *future* `HardPageReasonCode` too — `markFailed` is not
automatically the right default; see CLAUDE.md's gotchas.)

### Crawl-abort behavior — `auth-expired` only

`auth-expired` breaks the crawl's while loop immediately rather than
continuing to the next frontier item — continuing to crawl against a dead
session produces nothing but noise. `auth-wall` does **not** abort — a
site can have a small gated subsection alongside real public content, and
losing the rest of an otherwise-legitimate crawl over one gated page would
be an overcorrection; OpenEMR-class apps are gated end-to-end, but the
mechanism shouldn't assume every target is.

`CrawlResult` gains a new field: `abortedAt: { url: string; reason:
'auth-expired' } | null`, so the CLI can print something honest ("Crawl
aborted: session expired at `<url>` after 14 pages — fix credentials and
re-run to resume from here") instead of a summary line indistinguishable
from a normal, complete run.

### Resolved: auth-wall detection is opt-in, `--detect-auth-wall` (default `false`)

Auth-wall detection's trigger (no credentials configured + a password-type
field in `pageState.forms`) only ever fires on the plain, existing, no-auth
crawl path — that's structural, not incidental. Initially considered
narrowing the byte-identical guarantee instead (mirroring the session 48
color-report precedent of an always-on, no-flag improvement), but that
precedent doesn't hold here: color capture has no existing users whose
output it changes, while auth-wall detection would silently change output
for *any current, real, already-being-crawled target* that mixes public
and gated content — a marketing site with a `/login` link, a docs site
with a members area, a WordPress install with `/wp-admin`. That page
captures and generates a POM/spec today; under the original design it
would instead silently reroute to `hard-pages/`. Not a hypothetical edge
case, so the guarantee doesn't get weakened to make room for it.

Resolved by gating the trigger instead: a new `--detect-auth-wall` flag,
**default `false`**. Off (the default): zero exceptions, every existing
crawl target's output is byte-identical to today, full stop — no asterisk
about `AcquireOptions` plumbing needed. On: the forms-heuristic behaves
exactly as originally designed (still scoped to `!authSession`, since
`auth-expired` already covers the credentials-configured case). This
doesn't touch anything else locked in this section — `checkAuthStillValid`,
the `markFailed`/resumability fix, or the abort-vs-continue split — it's
one added condition (`options?.detectAuthWall`) on the existing trigger in
`capturePageWithBrowser`, threaded the same way `captureResponseBodies`
already is: CLI flag → `CrawlConfig.detectAuthWall` → `crawler.ts` →
`AcquireOptions.detectAuthWall` → the throw condition in `capture.ts`. Not
sensitive data, so — unlike `authSession`/credentials — it's fine to live
on `CrawlConfig` and get persisted into `crawl_meta` normally.

### Explicit non-goals for this pass

- No CI wiring — `.github/workflows/crawl.yml` untouched. Same posture
  already established for `publish_to_pages`: a new capability touching a
  public, artifact-uploading, potentially-publishing workflow gets a
  deliberate later decision, not a default bundled in.
- No auto-relogin on `auth-expired` — abort and let a human re-run.
- No MFA / CSRF-token / multi-step login support — single-step
  username+password form only.
- No resume-without-relogin caching of `storageState` to disk (see above).

### Session split (as actually run)

Per CLAUDE.md's own session-splitting practice (multi-package sessions
have been the highest-risk ones on this build):

1. **`packages/acquire`, session 49** — `auth.ts` (`performLogin`,
   `LoginCredentials`, `AuthSession`, `checkAuthStillValid`,
   `normalizeForComparison`) + a local fixture login page for testing —
   same "can't induce this against a live site" principle already used for
   visual-diff and appearance-latency testing. Built as designed.
2. **`packages/acquire`, session 50** — threaded `AuthSession` through
   `AcquireOptions`/`capturePageWithBrowser` (`newContext({ storageState
})`, the end-of-capture `checkAuthStillValid` call, new
   `AuthExpiredError`/`AuthWallError`), local-fixture tests for both —
   including a fixture that can simulate mid-crawl session expiry,
   matching session 40's delayed-response-fixture technique. Built as
   designed.
3. **`packages/core`, session 51** — `crawler.ts` takes `authSession` as
   its own `crawl()` parameter, never a `CrawlConfig` field; `CrawlConfig`
   gained `detectAuthWall?: boolean` (not sensitive, persists normally);
   `instanceof` dispatch on `AuthExpiredError`/`AuthWallError` in the catch
   block (checked before the existing timeout/parse-error string-
   matching); `auth-expired` breaks the loop and skips `markFailed`;
   `auth-wall` continues the loop and also skips `markFailed`;
   `CrawlResult` gained `abortedAt`. Tests explicitly assert
   `authSession`/credentials never appear in `crawl_meta`, that a page
   marked `auth-expired`/`auth-wall` is retried (not skipped) on a
   simulated resumed run, **and that `detectAuthWall: false`/unset
   produces byte-identical output to today's crawler on a fixture with a
   mixed public/login-page target** — the actual regression guarantee, now
   unconditional rather than asterisked. Built as designed.
4. **`packages/cli`, session 52** — `--login-url`, `--username`,
   `--success-indicator` (required alongside `--login-url`),
   `--username-selector`/`--password-selector`/`--submit-selector`
   overrides, `--detect-auth-wall` (default `false`), `TREELINE_LOGIN_PASSWORD`
   env var, `orchestrate.ts` wiring (fail fast on missing `--username`/env
   var before any network activity, call `performLogin` before `crawl()`,
   fail loudly on `LoginFailedError` before crawl activity begins). Built
   as designed, with two real deviations — see "Session 52 —
   implementation notes" immediately below. **Verification gap, recorded
   honestly rather than glossed over:** the original plan called for real
   verification against a local OpenEMR Docker instance, checking the
   success-indicator selector's presence across print views, modals, and
   iframe-heavy screens (the "Verification requirement, not an assumption"
   note above). That did not happen — session 52 verified end-to-end
   against a local Node fixture server only (same class of fixture as
   sessions 49-51), not a real OpenEMR instance. `checkAuthStillValid`'s
   circuit-breaker behavior is therefore proven correct against a
   controlled fixture, not against OpenEMR's actual template variety.
   **Closed in session 53** — see below for the real-target verification,
   the real gaps it found (a seed-URL constraint, a template-split problem
   with the single-selector design, and a real data-mutation risk), and
   CLAUDE.md's "Operational gotchas" for the operational writeup of each.

#### Session 52 — implementation notes (deviations from the lock, recorded honestly)

- **`launchHardened` exported from `@treeline/acquire`'s `index.ts`.**
  `performLogin(browser, creds)` needs a real `Browser` instance, and the
  only function that constructs one correctly (respecting `--stealth`/
  proxy) is `launchHardened` — which wasn't part of `acquire`'s public
  surface before this session. Rather than have `packages/cli` launch a
  second, parallel, unhardened Playwright browser just for the login step
  (which would silently drop `--stealth` for login specifically), one
  export line was added to `packages/acquire/src/index.ts`. This is a
  deliberate, narrow exception to session 52's own "packages/cli only, do
  not touch acquire" scoping — flagged to and confirmed by the repo owner
  before making it, not decided unilaterally.
- **`--detect-auth-wall` + login flags: warn-and-ignore, not error.**
  `runTreelineCrawl` prints a `console.warn` naming both flags and forces
  the effective `CrawlConfig.detectAuthWall` to `false` for that run
  (auth-wall detection is structurally scoped to `!authSession` downstream
  anyway, per the "Resolved: auth-wall detection is opt-in" note below —
  this makes the persisted `crawl_meta` value match what actually
  happened, rather than persisting `true` for a flag that never fired).
  Chosen over a hard error so a wrapper script that always passes
  `--detect-auth-wall` doesn't break the moment login flags are added to
  the same invocation.
- **`CrawlResult.abortedAt` → CLI message extracted as a testable
  function**, `formatAbortedCrawlMessage(abortedAt, pagesCaptured)` in
  `orchestrate.ts`, rather than inlined directly in `index.ts`'s Commander
  action. `index.ts`'s action handler calls `process.exit()`, which makes
  it untestable in-process; extracting the formatting into a pure,
  exported function let the session 52 test suite assert the exact
  wording (names the URL and page count, doesn't read like a normal
  completed-run summary) without spawning a subprocess.
- **Username is a CLI flag (`--username`), matching the lock above, not an
  env var.** Session 52's own task instructions initially specified both
  username and password as env vars (`TREELINE_LOGIN_USERNAME` +
  `TREELINE_LOGIN_PASSWORD`), which conflicts with this section's locked
  design. Flagged to the repo owner before writing any code; resolved in
  favor of the original lock (`--username` flag, `TREELINE_LOGIN_PASSWORD`
  env var only) — recorded here so a future session doesn't rediscover the
  same conflict from a stale prompt.

### Session 53 — real OpenEMR verification (gap closed), plus a real mutation-via-GET finding

Closes the verification gap session 52 recorded honestly rather than
glossed over. This session ran a real authenticated crawl against a local
OpenEMR 7.0.3 Docker instance (`OPENEMR-QA`, `admin`/`pass`, self-signed
TLS) for a real structural-map deliverable, not a fixture test — and found
several real things the fixture-only verification in sessions 49-52
couldn't have surfaced. **Full operational detail for every finding below
lives in CLAUDE.md's "Operational gotchas"** (five entries, in priority
order, headed by the mutation finding) rather than being duplicated here —
this section records what was found and what it means for the feature's
design status, not how to reproduce the fix.

- **New: `--insecure-certs` flag**, threaded the same way every other
  opt-in crawl-behavior flag is (`--stealth`, `--detect-auth-wall`):
  `CrawlConfig.insecureCerts?: boolean` → `AcquireOptions.insecureCerts?:
  boolean` → `ignoreHTTPSErrors: true` on every `newContext()` call in
  `capture.ts` and on `auth.ts`'s `performLogin`. Needed because treeLine
  had no mechanism at all for a self-signed-cert target before this
  session. Default `false`.
- **Confirmed real: the natural seed URL (site root / `main.php`) doesn't
  work even with a fully valid session**, because of a per-login
  URL-nonce gate unrelated to cookies. The design's assumption that a
  target's top-level authenticated URL is a valid crawl seed does not hold
  universally — see CLAUDE.md.
- **Confirmed real: the single-selector `--success-indicator` design (one
  selector reused for both `performLogin` and every `checkAuthStillValid`
  check) has a genuine limitation** when a target's login-landing template
  and regular content-page template diverge enough that no one selector
  satisfies both. Worked around per-target with an OR-selector; the
  underlying one-selector design itself is unchanged and unrevisited — see
  CLAUDE.md for the technique and "Open items" below for the open design
  question.
- **Confirmed real: Phase-1 discovery (link-following + sitemap.xml) finds
  almost nothing on a JS-nav-driven authenticated target** — OpenEMR's
  `main.php` has exactly one same-origin `<a href>` on the entire page.
  Worked around by extracting the target's own client-side nav-state object
  (`window.menu_objects`) and feeding many seeds into accumulating crawl
  invocations — not a treeLine feature, not Phase 2 discovery (still
  backlog, still not being built per "Do not build Phase 2... yet"). See
  CLAUDE.md for the technique.
- **Real crawl result**: 95 pages captured (of 98 attempted seeds), 88 with
  forms / 112 forms total, 8 distinct API endpoints, 607 axe violations /
  104 needs-review, 15 distinct colors — a real, usable structural
  inventory, delivered to the repo owner for a separate test-plan doc. 17
  of 98 seeds never captured (template-inconsistent auth markers, see
  CLAUDE.md) — documented as a known limitation, not chased to 100%; same
  discipline as every other "known limitation, not fixed yet" entry in this
  doc.
- **Headline finding: a real, confirmed data mutation caused by ordinary
  same-origin link-following, not a form submission or any action
  treeLine itself took.** `forms_admin.php`'s per-module "disable" link
  carries an already-valid CSRF token baked into its `href`, so a plain GET
  during normal link discovery was sufficient to disable two real form
  modules (`registry.state = 0` for ids 18/20 — "Care Plan," "Clinical
  Instructions"). Confirmed via OpenEMR's own audit log, not inferred from
  source — and every other non-`-select` log entry in the crawl window was
  independently checked and confirmed harmless (dashboard widget AJAX,
  lazy UI-preference bootstrapping, internal UUID backfill; no
  `patient-record-*`/`billing-*`/clinical category showed anything but
  `-select`). Root cause is a real OpenEMR anti-pattern (a state-changing
  action reachable via GET with a pre-baked token, unlike every other
  write-sounding page checked this session, which correctly gates behind
  `$_POST` + CSRF verified at submit time) — but the *risk class* is
  generalizable to any authenticated crawl of any target, which is why it's
  the headline entry in CLAUDE.md rather than an OpenEMR-only note. **Not
  yet mitigated in this codebase** — no URL-pattern denylist option, no CLI
  warning on `--login-url` — see "Open items" below. Environment was
  disposable by design for exactly this reason (`docker compose down -v &&
up -d`, confirmed both containers healthy again afterward).

## GPB judgment call (context, not code — worth knowing regardless)

Not an architectural decision, but worth recording in the same spirit as
the judgment calls already documented above, since it directly shaped
`publish_to_pages`'s default-`false` design and isn't obvious from the
code alone: mid-project, a real crawl of `goldenpetbrands.com` — a company
the repo owner was actually interviewing with — got published to the
public `gh-pages` run history via the opt-in flag, with the intent of
possibly sharing the live link with the hiring contact there. On
reflection, this was pruned rather than shared or left live: the
technical/legal footing was fine (treeline respects `robots.txt`, no
stealth, nothing here is different from what any browser or scanner does
to a public site), but the optics of an unsolicited, permanently-public
scan of a real company's site — while a hiring relationship might still be
live — were judged not worth the risk, especially since that specific
report wasn't even a strong demonstration of treeline's actual
differentiators (zero forms found, mostly Cloudflare/font-loading noise in
the API surface table, not real business logic). Pruned using the
documented recipe (see CLAUDE.md). The general principle this reinforces:
`publish_to_pages` is for targets you own or have standing to publish
about — real third-party targets, however legitimate the crawl itself is,
belong as artifact-only unless there's a specific, deliberate reason and
ideally consent to make that particular run permanent and public.

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
9.5, 39-40, and 48:

- `url`, `title`, `ariaSnapshot`, `links`, `capturedAt`
- `pageLoadMs: number` (session 39) — wall-clock time from just before
  navigation through the crawler's existing `waitForLoadState
('networkidle')` wait. Persisted as a `pages` table column. Feeds
  `timing-report.md`'s slow-page-load section (session 41).
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
  resourceType, plus `durationMs: number` (session 39, time between the
  request event and its matching response event). Captured since session
  1; rendered as the API surface half of `flow-map.md` since session 18
  (see "Open items" for two known dedup/filter gaps in that rendering);
  `durationMs` feeds `timing-report.md`'s slow-request section (session
  41).
- `interactiveElements: DomInteractiveElement[]` — real DOM ground truth
  per element: `role`, `accessibleName`, `testId`, `tagName`, `elementId`,
  `classList`, `cssPath`, `xpath`, plus `appearedAtMs: number | null`
  (session 40) — `null` for anything present at initial page load,
  otherwise the real timestamp (relative to navigation start) at which a
  `MutationObserver` first observed the element being inserted after
  `DOMContentLoaded`. Feeds `timing-report.md`'s high-latency-element
  section (session 41). This exists specifically because AI guessing at
  `testIdPresent` from the aria snapshot was unreliable (session 4.5) —
  `data-testid` is invisible to the accessibility tree by design.
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
- `colorPalette: ColorSwatch[]` (session 48) — real `getComputedStyle()`
  `color`/`background-color` values sampled over a fixed structural
  selector (not every element on the page), normalized to hex, aggregated
  by usage count, capped at the top 20 per page. Distinct from axe's
  `color-contrast` rule above — that reports a pass/fail contrast
  judgment on flagged elements only; this reports the actual color values
  used across the page regardless of whether axe flagged anything. Feeds
  `color-report.md`'s site-wide scheme and per-page sections.

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
  `keyDataEntities: string[]`, `confidence`, plus
  `proposedAssertion: ProposedAssertion | null` (session 42, extended
  session 45 — see "V2 additions" above; a discriminated union of
  `FormFillAssertion` (pages with a captured form) and
  `ContentPresenceAssertion` (form-less pages) — non-null whenever either
  proposal path found something worth proposing, null only when neither
  did).
  `interactiveElements` was deliberately removed from this type — it's
  redundant with and less accurate than `PageState.interactiveElements`
  from real DOM capture. Do not reintroduce it.
- **Persistence:** `StoredInterpretation` lives in `@treeline/core`, NOT
  `@treeline/interpret` — this is intentional, not an oversight, to avoid a
  circular workspace dependency (`core` has no dependency on `interpret`).
  It mirrors `PageInterpretation`'s shape by field name only (including
  `proposedAssertion`, session 42), plus `interpretedAt`.
  `runInterpretation(dbPath, hardPagesDir)` in `@treeline/interpret`
  orchestrates: skips pages without a successful capture, skips pages that
  already have a stored interpretation (idempotent — safe to re-run),
  retries once on a malformed response before giving up, and routes final
  failures to `hard-pages/`.
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
  Session 42's `proposedAssertion` call is a second, separate AI call. As
  of session 45 it always fires (never a third call, never skipped) —
  pages with a captured form get `proposeAssertion`, form-less pages get
  `proposeContentAssertion` instead, mutually exclusive on
  `forms.length`. Cost is still bounded to exactly one proposal call per
  page, same budget envelope as session 42, just no longer restricted to
  form-bearing pages.
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
  `--skip-interpretation`), orchestrating everything below, plus a small
  `HardPageEntry` manifest reader (session 38) used by coverage-report.
  Has its own `vitest.config.ts` excluding `treeline-output/` — see
  CLAUDE.md.
- `packages/core` — crawler, persistence (pages + interpretations tables,
  including `pageLoadMs`, `proposedAssertion`, and `colorPalette`),
  robots/sitemap,
  hard-pages writer, `diff.ts` (page + selector-candidate diffing),
  `selector-candidates.ts` (candidate computation), `screenshot-diff.ts`
  (pixel-diff visual comparison, session 23), `origin-scope.ts`
  (post-redirect origin resolution + hostname-mismatch detection, session
  32), and `urlHash` in `url-utils.ts` (deterministic per-URL hash used to
  name screenshot and diff-image files, session 22/26)
- `packages/acquire` — hardened Playwright/Patchright capture layer +
  axe-core scanning + Fastify API + timing/appearance-latency
  instrumentation (sessions 39-40) + color-scheme extraction
  (`extractColorPalette`, session 48)
- `packages/interpret` — 2-tier AI interpretation with retry + persistence
  orchestration + the `proposedAssertion` AI call (session 42; form-fill
  path for pages with a captured form, content-presence path for
  form-less pages added session 45)
- `packages/output` — selector report, testid audit, atlas, POM+spec
  generation (via `naming.ts`'s collision-safe filename assignment,
  session 31), axe report, diff report renderer (Visual Changes section,
  session 25), `flow-map.ts` (forms + API surface), `coverage-report.ts`
  (session 38), `timing-report.ts` (session 41), `proposed-assertions.ts`
  (session 42, renders `*.proposed.spec.ts`), `markdown-safety.ts`
  (session 43, untrusted-content sanitization used by all nine report
  generators), `proposal-coverage-report.ts` (session 46, derives
  per-page proposal-coverage categories from already-captured data, no
  new persistence), `color-report.ts` (session 48, site-wide + per-page
  color scheme from `PageState.colorPalette`)
- `packages/pages` — static HTML renderer for a treeline output directory
  (markdown-it + shiki), `meta.json` capture, multi-run index generation
  (sessions 34-35b), `static/root-redirect.html` (session 37), the
  hardened `escapeHtml` and `injection-safety.test.ts` regression suite
  (session 43)
- `packages/cli`'s `orchestrate.ts` — in addition to crawl orchestration,
  writes `reports/visual-diffs/*.png` diff images for pages with a visual
  change (session 26), generates `*.proposed.spec.ts` files alongside
  POM/spec output for pages with a non-null proposal (session 42), writes
  `reports/proposal-coverage-report.md` (session 46), and writes
  `reports/color-report.md` (session 48)
- `.github/workflows/crawl.yml` — `workflow_dispatch` CI crawl trigger
  (session 28), opt-in `gh-pages` publish (sessions 34-35b), root-redirect
  write step (session 37)

## Stack

TypeScript, Playwright + Patchright, Fastify, SQLite (better-sqlite3),
Anthropic API (Haiku 4.5 / Sonnet 5) via `@anthropic-ai/sdk`, `@axe-core/
playwright`, `pixelmatch` + `pngjs` (visual diff comparison), `markdown-it`

- `shiki` (GitHub Pages HTML rendering), pnpm workspaces, Vitest,
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
  `testid-audit.md`, and `flow-map.md`. Promoted to the top of this list
  given the now-confirmed scope (see PageState shape section above for
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
- **No mitigation exists yet for authenticated crawls reaching a
  state-changing action exposed via a plain GET link (session 53) — no
  URL-pattern denylist option, no CLI warning on `--login-url`.** Confirmed
  real, not hypothetical, against a live OpenEMR target; see "Authenticated
  crawling" above and CLAUDE.md's "Operational gotchas" for the full
  writeup. Worth prioritizing before the next real authenticated-crawl
  target where write access matters.
- `--success-indicator` is a single selector reused for both `performLogin`
  and every ongoing `checkAuthStillValid` check; a target whose
  authenticated-chrome template and authenticated-content template diverge
  enough (confirmed real on OpenEMR — see "Authenticated crawling" above)
  can require an OR-selector workaround per target rather than one clean
  selector. Not fixed; no redesign attempted yet.

**Phase 2 backlog (unchanged):** interaction-reachable page discovery.
