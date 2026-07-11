# CLAUDE.md — treeline

_Last updated after session 36._

Full design rationale lives in `CONTEXT.md` — read that first for the "why."
This file is the operational guide: conventions, commands, and hard-won
gotchas from the actual build.

## What this repo is

AI-powered site comprehension engine. Crawls a site, captures aria-tree +
real DOM state via a hardened Playwright layer, runs tiered AI
interpretation, and emits test artifacts (POMs, selector reports) plus docs,
accessibility findings, and structured data. Claude Code's role in this repo
is escalation (fixing `hard-pages/` entries), not the crawl runtime.

## Monorepo layout

- `packages/cli` — the real `treeline crawl <url>` command. Has its own
  `vitest.config.ts` — see "Operational gotchas" below for why this exists
  and must not be removed.
- `packages/core` — crawler, persistence (`pages` + `interpretations`
  tables), robots/sitemap, hard-pages writer
- `packages/acquire` — Patchright-hardened Playwright layer, axe-core
  scanning, Fastify API
- `packages/interpret` — 2-tier AI interpretation (Haiku 4.5 / Sonnet 5)
  with retry, plus persistence orchestration (`runInterpretation`)
- `packages/output` — selector report, testid audit, atlas, POM+spec
  generation, axe report, diff report, flow map (`flow-map.ts`) generators

## Conventions

- TypeScript, strict mode.
- Playwright/TypeScript for any test automation in this repo.
- No comments in code.
- One line break after a function or major code block ends; no line breaks
  between statements within a function body.
- **This convention applies to treeline's own source files only** — NOT to
  the content of strings this tool generates as output (POM classes, spec
  files). Generated code for end users should use normal, readable
  TypeScript formatting. Don't compress generated-code templates just
  because the generator's own source follows the compressed style.
- Locator ranking for anything selector-related: `getByRole` → `data-testid`
  → CSS → XPath, in that order of preference.
- **A selector candidate is only safe to bake directly into generated code
  when BOTH `stable` (survives DOM changes) AND `uniqueOnPage` (resolves to
  exactly one element right now) are true.** These are independent
  properties tracked separately (session 5.5) — a role selector can be
  perfectly stable and still throw a Playwright strict-mode violation if
  it's not unique. If only `stable` is true, scope it (`.nth(i)`, a parent
  locator, `.filter()`) rather than using it as-is.
- Same-origin crawl scope is the default and should not be silently widened.
- Stealth mode is opt-in (`--stealth` flag) — never the default posture.

## Commands

```
pnpm install
pnpm --filter @treeline/<package> build
pnpm --filter @treeline/<package> test
pnpm --filter @treeline/cli dev -- crawl <url> [--stealth] [--max-pages n]
  [--max-depth n] [--throttle-ms n] [--output dir] [--skip-interpretation]
pnpm --filter @treeline/cli dev -- diff <baselineDir> <currentDir>
  [--output dir] [--fail-on-regression]
```

Real example, from `packages/cli`:

```
pnpm exec tsx src/index.ts crawl https://example.com --max-pages 5
```

`crawl` generates five reports per run, under `<output>/reports/`:
`selector-report.md`, `testid-audit.md`, `atlas.md`, `axe-report.md`,
`flow-map.md`.

`diff` writes `reports/diff-report.md` into the current-run output
directory, plus `reports/visual-diffs/*.png` — one pixel-diff image per
page with a genuine visual change — automatically, with no new CLI flag.

### GitHub Action

`.github/workflows/crawl.yml` runs a real `crawl` in CI via
`workflow_dispatch` — trigger it from the repo's Actions tab (or `gh
workflow run crawl.yml -f url=https://example.com`). Three inputs: `url`
(required), `max_pages` (default `20`), `skip_interpretation` (default
`true`, so it runs without a stored `ANTHROPIC_API_KEY` secret unless you
explicitly turn interpretation on). Output lands as a downloadable
`actions/upload-artifact` artifact named `treeline-crawl-<run_id>`,
containing the same `reports/` directory a local crawl produces.

### Publishing to GitHub Pages

Same `crawl.yml` workflow, opt-in via the `publish_to_pages` boolean input
(default `false`). Trigger from the Actions tab (or `gh workflow run
crawl.yml -f url=https://example.com -f publish_to_pages=true`). When
enabled, the run's output is rendered to static HTML by `@treeline/pages`
(markdown reports → HTML via markdown-it, `.ts` POMs/specs →
syntax-highlighted HTML via shiki) and pushed to the `gh-pages` branch
under `runs/<run_number>/`, with `runs/index.html` regenerated to list
every published run. `false` by default because this repo is public and
prior real crawls (sessions 28-32) already targeted live third-party
sites the repo owner doesn't own — publishing every run's content to a
public URL should be a deliberate per-run choice, not automatic.

A fresh clone/fork needs two one-time repo-settings changes before this
works at all, neither of which the workflow can set for you:

1. **Settings → Actions → General → Workflow permissions** — must allow
   "Read and write permissions," or the workflow's `permissions: contents:
write` block still gets rejected when it tries to push to `gh-pages`.
2. **Settings → Pages → Build and deployment → Source** — must be set to
   "Deploy from a branch," branch `gh-pages`, folder `/ (root)`. This does
   not happen automatically just because the branch exists and has
   content pushed to it — a `gh-pages` branch with real HTML on it and no
   Pages source configured still 404s on the public Pages URL. Confirmed
   the hard way in session 36: two real published runs landed on
   `gh-pages` with correct content, and the public URL still 404'd because
   this setting hadn't been turned on. Also note `scripts/publish.ts
index` only ever writes `runs/index.html`, not a root-level
   `index.html` — the effective landing page is `/runs/index.html`, not
   `/`, until/unless a root redirect is added.

### Pruning a published run from GitHub Pages

Not automated — a manual recipe, proven for real once the two prerequisites
above are met:

```
git fetch origin gh-pages
git worktree add gh-pages-worktree origin/gh-pages
git -C gh-pages-worktree rm -rf runs/<run-number-to-remove>
cd packages/pages
pnpm exec tsx scripts/publish.ts index "$(realpath ../../gh-pages-worktree/runs)"
cd ../..
git -C gh-pages-worktree add -A
git -C gh-pages-worktree commit -m "Prune run <run-number-to-remove> from gh-pages"
git -C gh-pages-worktree push origin HEAD:gh-pages
git worktree remove gh-pages-worktree
```

The `index` regeneration step is not optional — skipping it leaves a
`runs/index.html` that still links to the now-deleted run directory.

### Verify the repo is actually in the state described

Don't assume — confirm, especially before starting a new session on top of
prior work. Run, in order:

```
pnpm install
pnpm --filter @treeline/acquire build && pnpm --filter @treeline/acquire test
pnpm --filter @treeline/core build && pnpm --filter @treeline/core test
pnpm --filter @treeline/interpret build && pnpm --filter @treeline/interpret test
pnpm --filter @treeline/output build && pnpm --filter @treeline/output test
pnpm --filter @treeline/cli build && pnpm --filter @treeline/cli test
```

All five packages should build and pass cleanly. If `packages/cli`'s test
run shows a wall of unrelated failures importing `@playwright/test`, check
that `packages/cli/vitest.config.ts` exists and excludes
`treeline-output/**` — see "Operational gotchas" below.

Then confirm the real end-to-end crawl command still works:

```
cd packages/cli
echo "${ANTHROPIC_API_KEY:0:8}..."
```

If that's blank, set it (`export ANTHROPIC_API_KEY=sk-ant-...`) before the
next command, or add `--skip-interpretation` to run for free without it.

```
pnpm exec tsx src/index.ts crawl https://example.com --max-pages 2 --output treeline-output/verify
```

Should complete with a summary showing pages captured, POMs/specs
generated, and (if interpretation wasn't skipped) an axe violations/
needs-review count. Check `treeline-output/verify/reports/` for all five
report files: `selector-report.md`, `testid-audit.md`, `atlas.md`,
`axe-report.md`, `flow-map.md`. For the flow-map check specifically,
confirm against a real site with an actual form (e.g.
httpbin.org/forms/post) that the forms table is populated and the API
surface table lists at least one endpoint — an empty flow-map.md on a site
known to have forms/network activity means something regressed.

Then confirm diff mode still works — run a second small crawl into a
different `--output` path, then:

```
pnpm exec tsx src/index.ts diff treeline-output/verify treeline-output/verify-2
```

Should write `reports/diff-report.md` into the second directory — alongside
`reports/visual-diffs/*.png` diff images for any page with a genuine visual
change, written automatically with no new CLI flag required — and print a
summary of pages added/removed, title changes, and selector regressions/
improvements/other. Try it once with `--fail-on-regression` too and confirm
with `echo $?` that the exit code behaves as documented above. **Guarantee:**
`--fail-on-regression`'s exit code is driven solely by selector-candidate
regressions — a visual change alone, however large, never trips it. Confirm
this holds if you touch diff mode again.

If any of this doesn't match what CONTEXT.md's "Status" section claims,
stop and figure out why before writing new code — something regressed.

## Operational gotchas (learned the hard way — read before debugging)

- **`tsx` is not hoisted to the workspace root.** Each package that needs to
  run a script directly (throwaway sanity scripts, `dev` scripts) needs
  `tsx` as its own devDependency: `pnpm add -D tsx --filter @treeline/<pkg>`.
  Running `pnpm exec tsx` from a package that doesn't have it installed
  fails with "'tsx' is not recognized," not a clearer dependency error.
- **`ANTHROPIC_API_KEY` only persists for the current shell session.**
  `export ANTHROPIC_API_KEY=...` is lost on a new terminal/tab. Any session
  involving real interpretation calls should start with `echo
$ANTHROPIC_API_KEY` to confirm it's actually set before running anything.
  The Anthropic Console only shows a key's full value once, at creation —
  there is no way to retrieve a lost key later, only generate a new one.
- **`packages/cli/vitest.config.ts` exists specifically to exclude
  `treeline-output/**`from test collection.** Every real crawl into`packages/cli`writes generated`.spec.ts`files under`treeline-output/<host>/specs/`. Without this exclusion, vitest's default
glob picks those up as if they were real test suites and they fail
importing `@playwright/test`(which isn't a dependency of this repo's own
test setup). If you see a wall of unrelated-looking test failures in`packages/cli`, check this file hasn't been reverted/removed before
  assuming something's actually broken.
- **Re-running a crawl against the same `--output` path resumes, it doesn't
  restart.** The crawler skips URLs already in that db's `pages` table.
  Comparing two "identical" runs will show fewer newly-captured pages on
  the second one — this is correct resumability behavior (CONTEXT.md), not
  a bug, but easy to misread as one mid-debugging.
- **`browser.newPage()` vs. `browser.newContext()` → `context.newPage()`
  matters for axe-core.** Axe's `finishRun()` needs to open its own helper
  page internally, which fails against an implicit single-owner context
  from `browser.newPage()`. `capture.ts` uses the explicit context form —
  don't revert this without re-verifying axe still runs (it will silently
  return empty results otherwise, caught the hard way in session 9).
- **`git add .` and `git push` both print nothing on success.** Don't
  assume a silent terminal means a command failed — check with `git
status` / look for the `[new branch]`-style confirmation line rather than
  re-running the command.
- **`treeline diff` only produces a meaningful result if both crawls used
  the same crawl config** (`--max-pages`, `--max-depth`, etc.). A config
  mismatch between the baseline and current run produces a diff that
  reflects the config difference, not real site drift — came up during
  manual sanity-checking in sessions 13-14. Before trusting a diff report,
  confirm both runs used matching flags.
- **`packages/core/src/url-utils.ts` has two related exports, described
  together since they're used together.** `normalizeUrl(url)` — strips
  fragments, sorts query params, used for crawl dedup and for matching a
  page across two crawl runs in diff mode. `urlHash(url)` — a deterministic
  per-URL hash (session 22, extended for diff images in session 26), used
  to name both a page's screenshot file on disk and its visual diff-image
  file (`reports/visual-diffs/<urlHash>.png`) so the same URL always maps
  to the same filename across separate crawl runs.
- **Real visual-diff test scenarios can't be induced against a live
  site** — same category of constraint diff mode itself already had before
  visual diffing existed. A live site won't reliably re-render a genuine
  pixel-level change on demand between two crawls. The technique proven
  across sessions 23-26: run one real crawl, then manually swap the
  on-disk screenshot file for a _different_ image of the _same pixel
  dimensions_ before running `diff` a second time — this forces a genuine
  `'changed'` status (as opposed to `'dimensions-changed'`, which is a
  different code path) so the comparison, threshold, and report-rendering
  logic can all be exercised for real. Worth remembering for any future
  visual-diff-adjacent work rather than re-deriving it.
- **`vitest` does not type-check.** Changing a field on a shared type used
  in test fixtures across multiple packages (e.g. `PageState`) can silently
  break other packages' fixtures without `vitest` ever failing, because
  fixture objects satisfy the old shape at the type level as far as the
  test file itself is concerned but no longer match what real code
  constructs. This happened twice in this build — first with
  `axeIncomplete`, then with `forms` — both times only caught by running an
  actual package `build`, not `test`. After changing a shared type, run
  `build` for every package that could plausibly construct that type as
  test data, not just the package where the type changed.
- **Browser cleanup must be in a `finally` block, always.** A real CI run
  once hung for ~1.5 hours after finishing all its actual work because
  `capturePage` only closed its browser on the happy path — a page-level
  error (caught and swallowed by the crawler's own per-page resilience
  logic) orphaned the browser process and kept Node's event loop alive
  indefinitely (session 29). If you're touching capture code, confirm the
  browser/context genuinely closes on every path, including error paths —
  don't assume the happy-path close is sufficient.
- **The GitHub Actions crawl workflow needs Xvfb.** Default (non-stealth)
  capture launches headed (`headless: false`); there's no flag to change
  this. `.github/workflows/crawl.yml` installs Xvfb and runs the crawl
  under `xvfb-run` — any future CI-related session touching the crawl
  workflow needs to know this or the run fails outright on a GitHub-hosted
  runner.
- **Crawl origin must be resolved from the post-redirect URL**, not the
  originally-typed seed URL. `fetch()` (used for `sitemap.xml`) follows
  redirects transparently; `page.goto()`'s origin-scope check needs to
  match that behavior or same-origin filtering silently rejects real,
  legitimate site content (`packages/core/src/origin-scope.ts`, session
  32 — caught via a real crawl of `www.goldenpetbrands.com`, which
  redirects).
- **`packages/output/src/naming.ts` is the single source of truth for
  POM/spec filenames.** Never derive a filename independently in a second
  place — that's exactly what caused a real silent-data-loss bug (sessions
  30-31): two different URLs slugifying to the same filename silently
  overwrote each other's generated POM/spec files.
- **This repo is public.** Actions history, logs, and artifacts from any
  crawl run are visible to anyone. The API key itself is masked
  automatically in logs, but the actual crawled content (reports, POMs,
  real business content) is not — worth a moment's thought before crawling
  any new target through the Action.
- **`inputs.*` vs `github.event.inputs.*` — a boolean input compared with
  `== 'true'` in a workflow-level `if:` silently always evaluates false.**
  For a `workflow_dispatch` trigger, the `inputs` context preserves each
  input's real declared type — a `type: boolean` input is a genuine
  boolean there. `github.event.inputs`, by contrast, stringifies every
  input unconditionally. `if: inputs.someBoolInput == 'true'` therefore
  compares a real boolean against a string; GitHub Actions' `==` between
  mismatched types coerces both sides to numbers, and `true`/`'true'`
  don't coerce to the same number, so the condition is false regardless of
  what the user actually selected — no error, the gated step just quietly
  never runs. This exact bug shipped in `crawl.yml`'s six
  `publish_to_pages`-gated steps (session 34-35b) and was only caught by
  actually triggering the workflow with the input set to `true` and
  noticing `gh-pages` never changed — not by reading the YAML. Fix: never
  string-equate a boolean input in an `if:` expression — compare it
  directly (`if: inputs.someBoolInput`). This is unrelated to
  `SKIP_INTERPRETATION`'s existing `[ "$SKIP_INTERPRETATION" = "true" ]`
  bash check elsewhere in the same file, which is correct as written — by
  the time an input reaches a bash `run:` step via `env:`, it's already a
  string, so the string comparison there is the right tool. The bug is
  specific to comparing a boolean against a string inside a YAML-level
  `if:` expression.

## Model routing (packages/interpret)

- **Haiku 4.5** — default tier for simple/structured pages.
- **Sonnet 5** — complex/ambiguous pages.
- No Opus tier. `MAX_INTERPRETATION_ATTEMPTS = 2` — a malformed response
  (most commonly `keyDataEntities` coming back as a string instead of an
  array) gets retried once before the page is sent to `hard-pages/`. This
  is a real, observed ~1-in-3 single-attempt failure rate, not a
  theoretical edge case — don't be surprised by `console.warn` retry lines
  in normal operation.
- `StoredInterpretation` is defined and persisted in `@treeline/core`, NOT
  `@treeline/interpret`. **Do not move it or import it from
  `@treeline/interpret`** — this split exists specifically to avoid a
  circular workspace dependency (`core` must not depend on `interpret`).
  `PageInterpretation` (the type `interpretPage` returns) and
  `StoredInterpretation` (what gets persisted) intentionally share field
  names but are separate types in separate packages.
- `PageInterpretation` does NOT include `interactiveElements` — removed in
  session 4.7. Per-element data belongs to `PageState.interactiveElements`
  (real DOM capture), not AI interpretation. Do not reintroduce it to
  `PageInterpretation`.

## Escalation workflow — `hard-pages/`

Manual workflow. Nothing shells out to Claude Code automatically. Confirmed
working end-to-end with real failures during development.

Manifest entry shape (`HardPageEntry`, as actually implemented):

```
{
"url": "",
"reasonCode": "",
"attemptedAt": "",
"captureSnapshot": null
}
```

`reasonCode` values: `empty-snapshot`, `timeout`, `auth-wall`,
`low-confidence`, `parse-error`. `captureSnapshot` carries a truncated real
error message when available (session 5.97 fix) — do not hardcode this back
to always-`null`.

When invoked against `hard-pages/`, Claude Code should:

1. Read each manifest entry and the associated raw capture (if any).
2. Write a handler matching the `CaptureHandler` interface in
   `packages/acquire` that resolves the specific failure pattern.
3. Add a test proving the handler resolves the case.
4. Commit the handler into the pipeline (not a one-off script) so the next
   crawl handles that pattern deterministically.
5. Remove or mark the manifest entry resolved.

`CaptureHandler` interface (implement, don't redesign, unless the pattern
genuinely doesn't fit it):

```
interface CaptureHandler {
matches(url: string, ariaSnapshot: string): Promise<boolean>
capture(url: string, options?: AcquireOptions): Promise<PageState>
}
```

## Session-splitting practice (how this repo has actually been built)

This codebase has been built through many small, single-package-scoped
Claude Code sessions rather than large multi-package ones — deliberately.
Sessions that touched 2+ packages (the crawler, POM generation) were
noticeably higher-risk than single-package ones. Keep following this
pattern for new work:

- Scope each session to one package where possible, with a detailed,
  explicit prompt (types spelled out field-by-field, exact function
  signatures, exact test cases to write) rather than an open-ended ask.
- After any session whose output feeds a later session (interpretation
  schemas, capture data shapes, report inputs), do a manual real-data sanity
  check — a throwaway script against a real crawl, read by a human, then
  deleted — before building the next thing on top of it. This has caught
  real bugs unit tests missed at least four separate times (AI-guessed
  testid unreliability, a swallowed exception hiding a config error, a
  malformed-JSON schema issue, axe silently failing on every capture), plus
  three more real-data limitations found this way during flow map's
  verification (session 19-20) — see CONTEXT.md's "Open items".
- When a manual check finds a real bug, fix it in its own small session
  before continuing, even if it means backtracking. Don't build the next
  feature on top of output you haven't verified.

## Do not

- Do not make stealth the default crawl posture.
- Do not build Phase 2 interaction-reachable discovery yet.
- Do not add a third model tier without updating `CONTEXT.md` first.
- Do not have the crawler pipeline invoke Claude Code automatically.
- Do not move `StoredInterpretation` into `@treeline/interpret` or import
  it from there — circular dependency risk, see above.
- Do not reintroduce `interactiveElements` to `PageInterpretation`.
- Do not remove or bypass `packages/cli/vitest.config.ts`'s exclusion of
  `treeline-output/**`.
- Do not treat `DomInteractiveElement.accessibleName` as a complete,
  spec-accurate accessible-name computation — it's a simplified heuristic
  with known gaps (see CONTEXT.md).
- Do not default `treeline diff --fail-on-regression` to on.
