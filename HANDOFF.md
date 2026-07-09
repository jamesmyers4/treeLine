# HANDOFF.md — treeline (as of session 32)

_Written for a fresh Claude Code session, or a fresh conversation with
Claude, picking this project up with zero memory of the 32-session
history that built it. Read `CONTEXT.md` and `CLAUDE.md` next — but see
"Known staleness" below before trusting them fully. Verify real repo
state over trusting any document, including this one._

## What treeline is, briefly

An AI-powered site comprehension engine. Crawls a site with a hardened
Playwright/Patchright browser, captures real DOM + accessibility-tree
state, runs tiered AI interpretation (Claude Haiku 4.5 / Sonnet 5), and
generates Page Object Models, Playwright specs, and five markdown reports
(selector stability, testid audit, atlas, axe accessibility, flow map).
Also supports diffing two crawls against each other, including visual
(screenshot pixel-diff) comparison, with a `--fail-on-regression` CI-gate
flag. Full architecture and rationale: `CONTEXT.md`.

## Verify the repo is actually in the state described

Don't assume — confirm, in order:

```
pnpm install
pnpm --filter @treeline/acquire build && pnpm --filter @treeline/acquire test
pnpm --filter @treeline/core build && pnpm --filter @treeline/core test
pnpm --filter @treeline/interpret build && pnpm --filter @treeline/interpret test
pnpm --filter @treeline/output build && pnpm --filter @treeline/output test
pnpm --filter @treeline/cli build && pnpm --filter @treeline/cli test
```

All five should build and pass cleanly. If `packages/cli`'s tests show a
wall of unrelated failures importing `@playwright/test`, check
`packages/cli/vitest.config.ts` excludes `treeline-output/**` (see
CLAUDE.md's gotchas).

Then confirm the real CLI still works end to end:

```
cd packages/cli
pnpm exec tsx src/index.ts crawl https://example.com --max-pages 2 --output ../../treeline-output/handoff-verify --skip-interpretation
```

Check `treeline-output/handoff-verify/reports/` for all five report
files. Then confirm diff mode (including visual diffing):

```
pnpm exec tsx src/index.ts crawl https://example.com --max-pages 2 --output ../../treeline-output/handoff-verify-2 --skip-interpretation
pnpm exec tsx src/index.ts diff ../../treeline-output/handoff-verify ../../treeline-output/handoff-verify-2
```

Should produce `diff-report.md` with a Visual Changes section.

Also confirm `.github/workflows/crawl.yml` exists — a sixth thing worth
checking that older versions of this verify sequence didn't need to,
since CI-based crawling is new as of session 28.

If any of this doesn't match what's claimed below, stop and figure out
why before writing new code — something regressed.

## What's actually done

**v1 (sessions 1-20) — complete.** Crawler, hardened capture (DOM ground
truth + axe-core), 2-tier AI interpretation with retry, all five base
reports, POM + spec generation, `hard-pages/` escalation, diff mode
(sessions 11-14), form/flow map (sessions 16-19). Fully documented in
`CONTEXT.md`.

**V2 item #1, visual diffing (sessions 21-27) — complete.** Real
screenshot capture (session 21), disk persistence with directory-
independent deterministic naming (22), pixel-diff comparison via
`pixelmatch`/`pngjs` with an empirically-determined 0.1% threshold (23),
diff-image generation (24), rendering into `diff-report.md`'s "Visual
Changes" section (25), automatic CLI wiring with no new flag (26), docs
sync (27). Removed from `V2.md` per that file's own process once done —
its content now lives in `CONTEXT.md`'s "V2 additions" section.

**GitHub Action, Stage A (session 28) — complete, proven working.**
`.github/workflows/crawl.yml`: `workflow_dispatch` trigger with `url`
(required), `max_pages`, `skip_interpretation` (default `true`) inputs.
Builds all 5 packages in dependency order, runs under Xvfb (the default
non-stealth capture path launches headed — `headless: false` — with no
CLI override, so a GitHub-hosted runner needs a virtual display or
nothing works at all), uploads the output directory via
`actions/upload-artifact`. Verified with two successful real runs
(hgwllc.com, goldenpetbrands.com), including one with real AI
interpretation and a real `ANTHROPIC_API_KEY` secret. Stage B (GitHub
Pages auto-publish) is not started.

**Process-lifecycle fix (session 29) — complete.** A real CI run hung for
~1.5 hours after finishing all its actual work — root cause:
`capturePage` only closed its browser on the happy path, so any page-
level error (caught and swallowed by the crawler's own per-page
resilience logic) orphaned that browser process and kept Node's event
loop alive indefinitely. Fixed with a `finally` block guaranteeing
closure on every path, plus a `process.exit()` backstop in the CLI, plus
`timeout-minutes: 25` added to the workflow as a safety net. Verified
against the exact site/settings that originally hung — now completes in
about 2 minutes.

**Real-output review + two more real bugs found and fixed (sessions
30-32) — complete.** Session 30 reviewed two real GitHub Actions crawl
outputs and found a genuine silent-data-loss bug: POM/spec generation
overwrote files when two different URLs slugified to the same filename
(root `/` vs `/home`; bare paths vs `.html`-suffixed duplicates), with
every other report showing correct page counts — only POM/spec output
was affected, which is why it went unnoticed. Session 31 fixed it with
deterministic collision detection and numeric-suffix disambiguation
(`packages/output/src/naming.ts`, new), mirroring the existing
`.nth(i)`-style disambiguation pattern already used for duplicate
elements within a page. Session 32 found and fixed a related discovery
bug: `www.goldenpetbrands.com` issues a real 301 redirect, but the
crawler was establishing same-origin scope from the pre-redirect URL and
never updating it — `sitemap.xml` (fetched via `fetch()`, which follows
redirects transparently) returned entries on the real post-redirect
hostname, all of which got filtered out against the stale origin. Fixed
to resolve origin from the post-redirect URL; also added detection
(sitemap + `rel=canonical` signals) for genuine non-redirected hostname
mismatches, which warns with the specific alternate URL rather than
silently auto-widening scope.

## Known staleness — read this before trusting CONTEXT.md/CLAUDE.md

Both files were last updated in session 27, covering everything through
visual diffing. **They do not yet reflect any of sessions 28-32** — not
the GitHub Action's existence, not the process-lifecycle fix, not either
of the two bugs found via the output review. Treat this document as
authoritative for anything from session 28 onward until a docs-sync pass
happens (see "What's left," below) — and don't be surprised if
`CLAUDE.md`'s Commands section, monorepo layout, or operational gotchas
look incomplete relative to what's actually in the repo.

## What's left — options, not a directive

**Strongest candidate: a docs-sync pass covering sessions 28-32.**
Same shape as sessions 15, 20, and 27 — fold the GitHub Action, the
process-lifecycle fix, and both bug fixes into `CONTEXT.md`/`CLAUDE.md`,
add the gotchas listed below to CLAUDE.md's operational-gotchas section.
Low risk (no source changes), high value (closes the exact staleness gap
this document exists to warn about), and consistent with how every prior
arc in this project has been closed out before moving to the next thing.

**GitHub Action Stage B** — auto-publish reports to GitHub Pages after
each run (Shiki for `.ts` highlighting, native markdown rendering for
`.md` reports), giving a persistent shareable link instead of artifacts
that expire on GitHub's retention schedule. Natural continuation of
session 28, not yet scoped in detail.

**Six items remain in `V2.md`, unstarted, sketch-level only** (item
numbering may have shifted since item #1's removal in session 27 — check
the file rather than trust a number): the GitHub Action item beyond
Stage A (see above), coverage-gap reporting, a timing/flakiness signal, AI-
proposed test assertions, multi-step flow test generation, and a hosted
run+output viewer. The file's own calibration note is worth taking
seriously: item #1 was estimated at "2-3 sessions" and took 6. Several of
these remaining items were explicitly flagged as needing a `/grill-me` or
`/grill-with-docs` scoping pass before any session prompt should be
written — particularly the timing signal and AI-proposed assertions,
which are more architecturally open than the others.

## Known gotchas from sessions 28-32 (not yet folded into CLAUDE.md)

- **Browser cleanup must be in a `finally` block, always.** The session
  29 bug happened because it wasn't. If you're touching capture code,
  confirm the browser/context genuinely closes on every path, including
  error paths — don't assume the happy-path close is sufficient.
- **The GitHub Actions workflow needs Xvfb.** Default (non-stealth)
  capture launches headed; there's no flag to change this. Any future
  CI-related session touching the crawl workflow needs to know this.
- **Crawl origin must be resolved from the post-redirect URL**, not the
  originally-typed seed URL. `fetch()` (used for `sitemap.xml`) follows
  redirects transparently; `page.goto()`'s origin-scope check needs to
  match that behavior or same-origin filtering silently rejects real,
  legitimate site content.
- **POM/spec filenames can collide across different URLs** — always go
  through the deterministic disambiguation in `naming.ts`, never derive a
  filename independently in a second place (this is exactly what caused
  the session 30 bug — two independent computations of "the same" name).
- **This repo is public.** Actions history, logs, and artifacts from any
  crawl run are visible to anyone. The API key itself is masked
  automatically in logs, but the actual crawled content (reports, POMs,
  real business content) is not — worth a moment's thought before
  crawling any new target through the Action.
- **The GitHub Action doesn't expose `--stealth`.** Deliberately deferred
  in session 28. Stealth-mode testing happens locally only, for now.

## How work has actually happened in this repo (keep doing this)

Small, single-package-scoped sessions with detailed, explicit prompts —
types spelled out, exact function signatures, exact test cases — rather
than open-ended asks. A "Step 0" investigation of real source, before
writing any fix or feature, has repeatedly caught things a written spec
alone would have missed or gotten wrong (screenshots not actually being
captured when `CONTEXT.md` claimed they were; the real root cause of the
origin-scope bug turning out to be a redirect-handling gap, not a "same-
origin is too strict" design problem). A manual sanity check against a
real site, every session that touches capture/output — not just unit
tests — has caught real bugs unit tests alone missed, repeatedly, most
recently the two bugs found in session 30's real-output review. When a
real incident happens (the session 29 hang, which cost real CI time), it
gets root-caused and fixed properly, not patched around or deferred.
Cross-file and cross-report consistency checks (does this report's own
summary line match its own content; do two independently-derived values
ever diverge) have been a disproportionately high-value habit — worth
continuing deliberately, not just when something already seems wrong.

## Judgment calls worth knowing the reasoning behind, not just the outcome

- **Pixel-diff, not AI-vision, as the primary visual-diff mechanism.**
  Deterministic, free, fast; an AI-description layer is planned as a
  separately-scoped future addition, gated to only fire on pages the
  pixel-diff already flagged as changed — not built yet.
- **Warn-with-a-fix, not auto-widen, for the origin-mismatch case.**
  Session 32 deliberately preserved strict same-origin enforcement rather
  than treating www/non-www as automatically equivalent — real downsides
  exist to auto-widening (different `robots.txt` per hostname, genuinely
  different content sometimes living at each hostname) that outweighed
  the convenience.
- **No new CLI flags added without a clear need.** The GitHub Action
  kept its input surface deliberately minimal (`url`, `max_pages`,
  `skip_interpretation` only) rather than exposing every CLI flag
  speculatively.
