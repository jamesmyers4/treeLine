# CLAUDE.md — treeline

_Last updated after session 54._

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
  scanning, Fastify API, timing/appearance-latency instrumentation
- `packages/interpret` — 2-tier AI interpretation (Haiku 4.5 / Sonnet 5)
  with retry, plus persistence orchestration (`runInterpretation`), plus
  the forms-gated AI-proposed-assertion call
- `packages/output` — selector report, testid audit, atlas, POM+spec
  generation, axe report, diff report, flow map, coverage-gap report,
  timing report, proposed-assertion spec generation, and a shared
  markdown-safety sanitizer used by every report generator
- `packages/pages` — static HTML renderer that turns a crawl/diff output
  directory into a browsable site (used by the GitHub Pages publish flow)

## Conventions

- TypeScript, strict mode.
- Playwright/TypeScript for any test automation in this repo.
- No comments in code.
- One line break after a function or major code block ends; no line breaks
  between statements within a function body.
- **This convention applies to treeline's own source files only** — NOT to
  the content of strings this tool generates as output (POM classes, spec
  files, proposed-assertion specs). Generated code for end users should use
  normal, readable TypeScript formatting. Don't compress generated-code
  templates just because the generator's own source follows the compressed
  style.
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
- **Any dynamic/untrusted value spliced into generated code or markdown
  needs an escaping strategy matched to its destination — there is no one
  universal "safe" function.** `JSON.stringify(...)` is correct for a value
  landing inside a quoted TS string literal (handles quote/newline escaping
  as an inherent property of what it does). It is not correct for a value
  landing inside a `//` comment, which has no equivalent to matched-quote
  escaping — use `toSafeComment()` (strips embedded newlines) there instead.
  Values landing in generated markdown need `sanitizeMarkdownText`/
  `sanitizeMarkdownTableCell` (`packages/output/src/markdown-safety.ts`).
  Values landing directly in hand-written HTML templates need `escapeHtml`
  (`packages/pages/src/template.ts`). Picking the wrong one for the
  destination is exactly how the session 42 comment-breakout bug happened —
  see "Operational gotchas" below.

## Commands

```
pnpm install
pnpm --filter @treeline/<package> build
pnpm --filter @treeline/<package> test
pnpm --filter @treeline/cli dev -- crawl <url> [--stealth] [--max-pages n]
  [--max-depth n] [--throttle-ms n] [--output dir] [--skip-interpretation]
  [--insecure-certs] [--capture-response-bodies] [--max-response-body-bytes n]
  [--capture-request-bodies] [--max-request-body-bytes n]
pnpm --filter @treeline/cli dev -- diff <baselineDir> <currentDir>
  [--output dir] [--fail-on-regression]
```

Real example, from `packages/cli`:

```
pnpm exec tsx src/index.ts crawl https://example.com --max-pages 5
```

`crawl` generates nine reports per run, under `<output>/reports/`:
`selector-report.md`, `testid-audit.md`, `atlas.md`, `axe-report.md`,
`flow-map.md`, `coverage-report.md` (session 38), `timing-report.md`
(session 41), `proposal-coverage-report.md` (session 46), `color-report.md`
(session 48) — plus, for any page with a captured form and a meaningful
proposed scenario, a `<page>.proposed.spec.ts` alongside the trusted
generated specs (session 42, always `test.skip`-wrapped, never merged into
the trusted spec). A tenth report, `reports/api-test-scaffold.md` (session
55), is **conditional, not automatic** — it's only written when the crawl
had `--capture-request-bodies` and/or `--capture-response-bodies` set; with
neither flag, it isn't written at all (no new CLI flag of its own — see
`TreelineCrawlSummary.apiTestScaffoldGenerated`). Don't be surprised by its
absence on an ordinary crawl; that's correct, not a regression.

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
every published run, and a static root-redirect `index.html` (session 37)
written at the branch root so the bare Pages URL works too, not just
`/runs/`. `false` by default because this repo is public and prior real
crawls (sessions 28-32) already targeted live third-party sites the repo
owner doesn't own — publishing every run's content to a public URL should
be a deliberate per-run choice, not automatic. **This isn't a hypothetical
concern** — see the GPB judgment call in CONTEXT.md for a real instance of
this almost going wrong; only publish a real third-party target
deliberately, ideally with standing/consent to do so, not by default.

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
   this setting hadn't been turned on.

As of session 37, once both of the above are done, both the bare Pages
root URL and `/runs/` work correctly — the earlier gap (root URL 404ing
even with the branch settings correct, because nothing wrote a root
`index.html`) is resolved; see "V2 additions" in CONTEXT.md.

### Pruning a published run from GitHub Pages

Not automated — a manual recipe, proven for real more than once (including
for a real accidental publish, see CONTEXT.md's GPB judgment call):

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
`runs/index.html` that still links to the now-deleted run directory. If
`git push` fails with "You are not currently on a branch" here, it's
because the worktree checked out `origin/gh-pages` in detached-HEAD state
— fix with `git push origin HEAD:gh-pages` (pushes the current commit
straight to the remote branch regardless of local branch tracking), or add
`-B gh-pages` to the `git worktree add` step next time to avoid it
entirely, matching what the real workflow does.

### Verify the repo is actually in the state described

Don't assume — confirm, especially before starting a new session on top of
prior work. Run, in order:

```
pnpm install
pnpm --filter @treeline/acquire build && pnpm --filter @treeline/acquire test
pnpm --filter @treeline/core build && pnpm --filter @treeline/core test
pnpm --filter @treeline/interpret build && pnpm --filter @treeline/interpret test
pnpm --filter @treeline/output build && pnpm --filter @treeline/output test
pnpm --filter @treeline/pages build && pnpm --filter @treeline/pages test
pnpm --filter @treeline/cli build && pnpm --filter @treeline/cli test
```

All six packages should build and pass cleanly. If `packages/cli`'s test
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
**Never `echo` the full key value** — see "Operational gotchas" below for
why this specific command is written the way it is.

```
pnpm exec tsx src/index.ts crawl https://example.com --max-pages 2 --output treeline-output/verify
```

Should complete with a summary showing pages captured, POMs/specs
generated, and (if interpretation wasn't skipped) an axe violations/
needs-review count. Check `treeline-output/verify/reports/` for all seven
report files: `selector-report.md`, `testid-audit.md`, `atlas.md`,
`axe-report.md`, `flow-map.md`, `coverage-report.md`, `timing-report.md`.
For the flow-map check specifically, confirm against a real site with an
actual form (e.g. httpbin.org/forms/post) that the forms table is
populated and the API surface table lists at least one endpoint — an
empty flow-map.md on a site known to have forms/network activity means
something regressed. If interpretation wasn't skipped and the site has a
form, also check for a `<page>.proposed.spec.ts` alongside the generated
specs.

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

- **A same-origin, link-following crawl is only as read-only as the target
  makes it — treeLine itself never fills or submits a form, but that does
  not mean an ordinary crawl can't mutate data.** If a target exposes a
  state-changing action via a plain `<a href>` with a valid token already
  baked into the URL (rather than requiring a POST, with the token supplied
  only at submit time), a same-origin link-following crawl reaching that
  link is enough to trigger it — no form-fill, no JS execution, just a
  normal `page.goto()` during ordinary frontier traversal. **Confirmed real,
  not hypothetical** (session 53): a real authenticated crawl of a local
  OpenEMR instance followed `forms_admin.php`'s per-module "disable" link
  (`forms_admin.php?...&id=18&method=disable&csrf_token_form=<live-token>`)
  during normal same-origin link discovery, and this genuinely disabled two
  real form modules (`registry.state = 0` for ids 18 and 20) — confirmed via
  OpenEMR's own `log` audit table (`security-administration-update` rows,
  decoded from base64 `comments`), not inferred from reading source. This is
  a materially bigger risk on an *authenticated* crawl than an anonymous
  one — a logged-in session is far more likely to reach a privileged admin
  surface with real destructive actions than a public, unauthenticated
  crawl would ever encounter. **Not yet mitigated in this codebase**: there
  is no URL-pattern denylist option, and `--login-url` prints no warning
  about this risk even though that's exactly the flag that makes reaching a
  privileged surface likely. Worth building at least one of: a denylist
  option for URL patterns/query params (e.g. a configurable block on
  `method=disable`-shaped links) or a loud, unconditional CLI warning
  whenever `--login-url` is used, reminding the operator that an
  authenticated crawl is not guaranteed read-only. See CONTEXT.md's
  "Authenticated crawling" section (session 53 addendum) for the full
  writeup, including why the earlier per-page POST+CSRF source check for
  this same real crawl didn't catch it (it only covered the specific pages
  flagged as write-sounding ahead of time, not `forms_admin.php`).
- **A per-login nonce in the URL can make the "obvious" seed URL
  unreachable even with a perfectly valid session.** OpenEMR gates its
  top-level frame (`interface/main/tabs/main.php`) behind a `token_main`
  query-string value minted fresh at login time — a brand-new browser
  context seeded only with a valid `storageState` (no cookie problem at
  all) and pointed at the site root or at `main.php` directly gets
  redirected straight back to the login page, because the check is on the
  URL's nonce, not the session. Confirmed real via direct probing (session
  53), not assumed from reading the app. **The seed URL for an
  authenticated crawl of a target like this must be a real content-pane
  URL** — whatever actually loads inside the gated frame's iframes —
  never the root or the frame-container page itself. Worth checking for on
  any future target that uses a similar top-level-frame-plus-iframes
  shape: if a fresh, validly-seeded context still redirects to login on the
  natural seed URL, suspect a URL-level nonce before suspecting the
  session/cookie plumbing.
- **`--success-indicator` is one selector reused for two different
  checks (`performLogin`'s post-login check and every ongoing
  `checkAuthStillValid` check) — a target whose login-landing template and
  its regular content-page template diverge enough can make a single
  selector impossible.** On OpenEMR, `performLogin` lands on `main.php`,
  whose only real "authenticated" marker is a knockout-rendered logout menu
  item (`[data-bind*="logout"]`); real content-pane pages never render that
  chrome (they're bare fragments meant for iframe embedding) but do carry
  `onsubmit`/`onclick` attributes calling `top.restoreSession()` (OpenEMR's
  session-keepalive convention) — and `main.php` itself only mentions
  `restoreSession` inside a JS *comment*, not a real attribute, so neither
  marker alone satisfies both checks. Confirmed real via direct probing of
  both templates (session 53), not assumed. **Fix: combine the markers with
  a CSS OR-selector** rather than searching for one universal marker:
  `[data-bind*="logout"], [onsubmit*="restoreSession"],
[onclick*="restoreSession"], input[type=hidden][name*=csrf i]` — verified
  present on `main.php` and on every content-pane template tried, and
  absent on the login page itself (the last clause was checked absent from
  the login page specifically before adding it, since a false positive
  there would silently break auth-failure detection). This selector is
  OpenEMR-specific, not portable as-is, but the OR-selector *technique* is
  the reusable lesson for any future target with the same template split.
- **`window.menu_objects` (or an equivalent client-side nav-state object)
  can be the only real way to discover pages on a knockout.js/JS-nav-driven
  authenticated site — treeLine's Phase-1 discovery (link-following +
  sitemap.xml) can come back nearly empty otherwise.** OpenEMR's `main.php`
  has exactly one real same-origin `<a href>` on the entire page (an
  external link to open-emr.org) — every actual in-app navigation is a
  knockout.js click handler swapping an iframe `src` client-side, invisible
  to link-following. Confirmed real (session 53): a single-seed crawl of
  `main.php` or any one content page discovers essentially nothing beyond
  its own seed. **Not a treeLine feature and not Phase 2 interaction-
  reachable discovery** (still backlog, still not being built per "Do not"
  below) — a one-off workaround: OpenEMR's real menu tree is reachable via
  `page.evaluate(() => window.menu_objects)` (a JS object the app's own
  top-frame JS holds, recursively `label`/`url`/`children`), which was
  extracted once, flattened to real URLs, and fed as many separate
  `treeline crawl <url> --output <same-dir>` invocations accumulating into
  one `crawl.sqlite`/report set via ordinary resumability (`pageExists`
  skip) — no new treeLine mechanism, just many seeds. Worth checking any
  future heavily-JS-driven authenticated target for an equivalent
  client-side nav-state object before assuming Phase-1 discovery will find
  its pages.
- **Chasing 100% seed-URL coverage on a real authenticated target has real
  diminishing returns — know when to stop and document the gap instead.**
  A real OpenEMR crawl (session 53) using the combined selector above still
  left 17 of 98 attempted seed URLs uncaptured: some failed outright
  (`SeedAuthenticationError` — the indicator genuinely absent on that
  specific page template, e.g. the Zend-modules pages, the orders module,
  the DICOM viewer, `controller.php` dispatcher endpoints), a few tripped a
  false `auth-expired` mid-invocation on a same-origin link discovered at
  depth 1 that landed on yet another marker-less template. Widening the
  selector once already recovered 18 of an original 35 failures: a good
  return on one iteration, a bad one on further template-specific
  micro-fixes. **This is now a documented, known limitation** (see
  CONTEXT.md's "Authenticated crawling" section and "Open items"), not an
  open bug to keep chasing — the same discipline this file already applies
  to `accessibleName`'s known gaps and the API-surface-dedup known gap:
  state the limitation plainly with real numbers, don't silently claim
  completeness, and don't burn unbounded time closing the last few percent
  of an inherently template-diverse target.
- **`tsx` is not hoisted to the workspace root.** Each package that needs to
  run a script directly (throwaway sanity scripts, `dev` scripts) needs
  `tsx` as its own devDependency: `pnpm add -D tsx --filter @treeline/<pkg>`.
  Running `pnpm exec tsx` from a package that doesn't have it installed
  fails with "'tsx' is not recognized," not a clearer dependency error.
- **Never `echo` the raw `$ANTHROPIC_API_KEY` value — check presence, not
  content.** A real key got exposed this way: `echo $ANTHROPIC_API_KEY` (at
  the time, this file's own literal recommendation) prints the full raw
  value to the terminal, and terminal output routinely ends up pasted back
  into an agent's context for troubleshooting. Use
  `echo "${ANTHROPIC_API_KEY:0:8}..."` (confirms it's set and gives a
  partial sanity-check without exposing the whole thing) or
  `[ -n "$ANTHROPIC_API_KEY" ] && echo set || echo "not set"` (confirms
  presence only) instead. If a raw key value ever does end up in a
  terminal output, chat log, or anywhere else outside a secrets manager,
  rotate it immediately in the Anthropic Console — there is no way to
  retrieve a lost/exposed key's value after the fact, only revoke and
  generate a new one. This applies to the GitHub Actions
  `ANTHROPIC_API_KEY` repo secret too, not just your local shell — update
  both if you rotate.
- **`ANTHROPIC_API_KEY` only persists for the current shell session.**
  `export ANTHROPIC_API_KEY=...` is lost on a new terminal/tab.
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
  visual-diff-adjacent work rather than re-deriving it. **Session 40 used
  the same real-fixture-not-live-site principle for appearance-latency
  testing** — a live site's async behavior can't be relied on to appear on
  cue either, so a small local server with a genuinely delayed element is
  the controlled equivalent.
- **`vitest` does not type-check.** Changing a field on a shared type used
  in test fixtures across multiple packages (e.g. `PageState`) can silently
  break other packages' fixtures without `vitest` ever failing, because
  fixture objects satisfy the old shape at the type level as far as the
  test file itself is concerned but no longer match what real code
  constructs. This happened multiple times in this build — `axeIncomplete`,
  then `forms`, then session 39's `pageLoadMs`/`durationMs` addition
  (fixture fallout across all six packages, all caught by running real
  `build`) — every time only caught by running an actual package `build`,
  not `test`. After changing a shared type, run `build` for every package
  that could plausibly construct that type as test data, not just the
  package where the type changed.
- **Browser cleanup must be in a `finally` block, always.** A real CI run
  once hung for ~1.5 hours after finishing all its actual work because
  `capturePage` only closed its browser on the happy path — a page-level
  error (caught and swallowed by the crawler's own per-page resilience
  logic) orphaned the browser process and kept Node's event loop alive
  indefinitely (session 29). If you're touching capture code, confirm the
  browser/context genuinely closes on every path, including error paths —
  don't assume the happy-path close is sufficient. **The same "always close
  in `finally`" discipline was reapplied in session 34-35b to a different
  resource, a SQLite db handle** (`packages/pages/src/meta.ts`'s
  `buildRunMeta`) — same principle, any resource with a lifecycle, not
  just browsers.
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
  any new target through the Action, and a bigger moment's thought before
  publishing that content to `gh-pages` (see the GPB judgment call in
  CONTEXT.md for why this isn't just theoretical).
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
- **`markdown-it`'s `html: false` config is what makes rendering crawled
  content to HTML safe by default — don't change it without understanding
  what it's actually blocking.** Confirmed empirically in session 43: with
  `html: false` (the current, correct setting in
  `packages/pages/src/markdown.ts`), raw HTML embedded in source markdown
  — including from crawled page titles or AI-derived text that happens to
  contain `<script>` or similar — gets escaped to inert text rather than
  rendered as live markup. Flipping this to `true` for any reason (e.g. to
  allow richer formatting in a future report) would reopen a real
  injection surface on the public `gh-pages` site — don't, without a real
  reason and a fresh audit.
- **Untrusted content in generated markdown still needs sanitization even
  though `markdown-it`'s `html:false` blocks script injection** — the two
  are different problems. `|` in a crawled title/URL/AI-derived string can
  silently truncate a markdown table row; an embedded newline can inject a
  fake heading or a fabricated clickable link into a report, which reads
  as content spoofing (treeline appearing to say something it didn't) even
  though it can't execute code. `packages/output/src/markdown-safety.ts`
  (`sanitizeMarkdownText`/`sanitizeMarkdownTableCell`, session 43) handles
  this — every report generator that splices crawled/AI-derived content
  into markdown output should go through it. If you add a ninth report
  generator, route its dynamic values through this too rather than
  assuming markdown-it's HTML protection is sufficient on its own.
- **Never let a model's freeform natural-language output serve as a
  matching/lookup key against structured, deterministic data.** A real bug
  in session 42's `proposedAssertion` feature: the model's own guessed
  `accessibleName` for a form field was used to match that field back to
  the real captured `DomInteractiveElement[]` array. On a page with
  genuinely unlabeled inputs, the model invented plausible-sounding labels
  instead of describing what it actually saw, so the match silently
  failed and generated code pointed at nothing (and, worse, used the wrong
  interaction type — `.fill()` instead of `.check()` for checkbox/radio
  fields). Fix: identity/matching always traces back to real captured
  data; a model may propose values, scenarios, or descriptions, but never
  gets to serve as the key used to look something else up.
- **`performLogin`'s own login POST is never captured as a `NetworkEntry` —
  it happens on a separate browser context outside `capture.ts`'s network
  listeners, by design (session 54).** `--capture-request-bodies` only sees
  traffic that occurs during `capturePageWithBrowser`'s own page load; the
  authentication handshake itself (a real POST to
  `main_screen.php?auth=login&site=default` on OpenEMR, confirmed via a
  direct probe against the real target) never passes through that code path
  at all. Not a bug — `performLogin` and `capture.ts` are structurally
  separate on purpose (see "The structural constraint that shapes
  everything here" in CONTEXT.md's authenticated-crawling section) — but
  worth knowing before assuming `requestBody`/`requestHeaderNames` capture
  covers 100% of a crawl's real POST traffic. If a future session wants the
  login POST itself captured, that's a deliberate extension to
  `performLogin`, not something `--capture-request-bodies` already does.
- **A real authenticated crawl never submits a form — the only POST traffic
  `--capture-request-bodies` will ever see during ordinary crawling is
  whatever a page's own JavaScript fires automatically on load** (session-
  keepalive pings, notification-counter AJAX, CSRF-token-carrying
  background calls) — confirmed real against OpenEMR (session 54): four
  distinct real form-urlencoded POSTs captured across a real authenticated
  crawl (`dated_reminders.php`, `patient_tracker.php`, plus the login POST
  probed directly) ranged **83–244 bytes**, nowhere close to the
  65536-byte `--max-request-body-bytes` default. This is structural, not
  target-specific: since treeLine is read-only by design and never fills or
  submits a real form (see the "Do not" list), the request bodies it can
  ever observe are bounded by how small a page's own background AJAX calls
  are, not by how large that page's actual `<form>` elements could get if a
  human filled and submitted them. Don't be surprised if
  `requestBody`/real captured sizes stay small even on a target with huge
  admin forms — that's expected, not a sign the capture is broken.
- **A real `multipart/form-data` POST (session 54, OpenEMR's
  `dated_reminders_counter.php`) correctly returns `requestBody: null`, not
  a bug.** Only `application/json` and `application/x-www-form-urlencoded`
  are in scope for request-body field-name extraction (locked decision,
  `API-CAPTURE-BUILDOUT.md`) — confirmed a real target actually sends
  `multipart/form-data` traffic during ordinary authenticated page loads, so
  this isn't a hypothetical gap. If a future session wants multipart
  coverage, that's a new, separate scope decision — don't assume the
  content-type gate needs "fixing" if you see `null` against a real
  multipart request.
- **Content-type matching for request-body extraction must tolerate a
  trailing parameter (e.g. `application/x-www-form-urlencoded;
charset=UTF-8`), and `startsWith` already handles this correctly** —
  confirmed against real OpenEMR traffic (session 54), not just a fixture
  guess; a permanent regression test now covers this exact shape in
  `packages/acquire/src/capture-request-body.test.ts`. Don't switch this
  match to an exact string comparison — a real target sending a charset
  parameter is normal, not malformed.
- **`NetworkEntry` has no content-type field, so a `null` `requestBody`/
  `responseBodySchema` on a flag-on entry can't be attributed to a specific
  cause (multipart, non-JSON, oversized, non-object top-level JSON) — only
  to the general category "not eligible."** Found building
  `api-test-scaffold.md` (session 55), which needed to render "not
  applicable" (flag on, structurally ineligible) distinctly from "not
  captured" (flag off) per `API-REPORT-BUILDOUT.md`'s decision #7. The
  flag-off case is unambiguous (known from `CrawlConfig`, not inferred per
  entry). The flag-on-but-null case is not — `packages/output/src/
api-test-scaffold.ts` deliberately words its "not applicable" note as a
  category ("e.g. multipart/form-data, or a content type outside JSON/
  form-urlencoded") rather than asserting a specific cause it can't actually
  confirm from the persisted data. Don't "fix" this by having the report
  layer guess more specifically — if per-entry cause attribution is ever
  wanted, that's a new capture-layer field (a content-type or
  ineligibility-reason column on `NetworkEntry`), a deliberate scope
  decision for a future session, not something to infer at render time.
- **`pageExists` is status-blind — `markFailed` permanently poisons
  resumability for that URL, not just a same-run retry guard.**
  `packages/core/src/persistence.ts`'s `pageExists(url)` is `SELECT 1 FROM
pages WHERE url = ?` — true for any row, successful or failed. Any
  `HardPageReasonCode` written via `markFailed` therefore causes that URL
  to be silently skipped on every future resumed run, forever, even after
  the original cause is fixed. Existing `timeout`/`parse-error` already
  have this property; mostly harmless there since those aren't usually
  "fixable by re-running with different input." Found while designing the
  `auth-expired`/`auth-wall` reason codes (built and verified against a
  real target as of session 53 — see CONTEXT.md's "Authenticated crawling"
  section), both of which deliberately skip `markFailed` for exactly this
  reason. **Don't assume `markFailed` is the
  right default for a new `HardPageReasonCode`** — check whether the
  underlying cause is the kind a human would fix and re-run for, first.

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
  names but are separate types in separate packages. Both now include
  `proposedAssertion` (session 42, extended session 45) — kept in step
  with each other the same way the rest of their shared fields are.
  `ProposedAssertion` is a discriminated union
  (`FormFillAssertion | ContentPresenceAssertion`, on a `kind` field) —
  don't treat it as the single flat shape session 42 originally shipped.
- `PageInterpretation` does NOT include `interactiveElements` — removed in
  session 4.7. Per-element data belongs to `PageState.interactiveElements`
  (real DOM capture), not AI interpretation. Do not reintroduce it to
  `PageInterpretation`.
- **The `proposedAssertion` AI call always fires — exactly once per page,
  branching on `pageState.forms.length` rather than skipping.** Pages with
  a captured form call `proposeAssertion` (form-fill); form-less pages
  call `proposeContentAssertion` (content-presence, session 45) instead.
  This replaced session 42's original "skip entirely when
  `forms.length === 0`" gate — don't reintroduce a skip here, and don't
  let both calls fire for the same page (they're mutually exclusive by
  design, keeping the review surface at one proposal per page).

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
`auth-expired`, `low-confidence`, `parse-error`. `auth-wall`/`auth-expired`
are built, wired to real detectors, and verified against a real
authenticated target (OpenEMR, session 53) — see CONTEXT.md's
"Authenticated crawling" section for the full design and verification
history. `captureSnapshot` carries a truncated real
error message when available (session 5.97 fix) — do not hardcode this back
to always-`null`. A small reader for this manifest was added in
`packages/cli/src/orchestrate.ts` (session 38) so `coverage-report.md` can
surface unresolved entries as real parsed data rather than a raw file
count — this reader lives in `cli`, not `core`/`acquire`, kept scoped to
exactly where it's needed.

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
  check before building the next thing on top of it. This has caught real
  bugs unit tests missed repeatedly — AI-guessed testid unreliability, a
  swallowed exception hiding a config error, a malformed-JSON schema
  issue, axe silently failing on every capture, three more real-data
  limitations during flow map's verification (sessions 19-20), and the
  session 42 model-freeform-text-as-lookup-key bug (see "Operational
  gotchas" above) — see CONTEXT.md's "Open items".
- **Not every manual check needs to be a throwaway script that gets
  deleted afterward.** Session 40 deliberately kept its manual check as a
  permanent regression test rather than a deleted one-off, because
  "immediate element → `null`, delayed element → a real number in a sane
  range" is precisely, mechanically assertable — unlike a visual-diff
  pixel comparison on a real complex page, which genuinely needs human
  judgment to evaluate. The throwaway-script convention exists for cases
  needing human judgment; a controlled, mechanically-checkable property
  should just become a real test.
- When a manual check finds a real bug, fix it in its own small session
  before continuing, even if it means backtracking. Don't build the next
  feature on top of output you haven't verified.
- **A feature-scoped session isn't the only kind of session worth
  running.** Session 43 was a dedicated audit — not tied to any single
  V2.md item — specifically because a feature session only has reason to
  check what it's building, not accumulated risk across everything that
  came before it (e.g. escaping consistency across eight report
  generators built in eight different sessions). Worth running one of
  these periodically, scoped to one concrete question at a time (not "check
  everything"), rather than only ever adding new capability.

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
- Do not default `publish_to_pages` to `true`.
- Do not default `--insecure-certs` to `true` — same opt-in posture as
  every other flag that changes the crawl's trust/security surface
  (`--stealth`, `--detect-auth-wall`).
- Do not assume an authenticated crawl is read-only merely because
  treeLine itself never fills or submits a form — see the link-following
  GET-mutation gotcha above before running `--login-url` against any
  target where write access actually matters.
- Do not merge a `*.proposed.spec.ts` file's content into the trusted
  generated `.spec.ts`, and do not generate a proposed test that isn't
  wrapped in `test.skip(...)`.
- Do not use a model's freeform text output as a matching/lookup key
  against structured, deterministic data — see "Operational gotchas."
- Do not `echo` a raw `$ANTHROPIC_API_KEY` (or any other secret) value to
  a terminal that an agent session might read back — check presence, not
  content.
- Do not add login credentials, `storageState`, or any other authenticated-
  session data as `CrawlConfig` fields — `crawler.ts` persists the entire
  `CrawlConfig` into `crawl.sqlite`'s `crawl_meta` table via
  `db.insertMeta`, and that db file is uploaded wholesale as a public
  GitHub Actions artifact. See CONTEXT.md's "Planned: Authenticated
  crawling."
- Do not call `db.markFailed` for the planned `auth-expired`/`auth-wall`
  reason codes — see the `pageExists`-is-status-blind gotcha above.
- Do not give `--success-indicator` (planned authenticated-crawling flag)
  a URL-substring mode — selector-only, matches this repo's locator-first
  convention.
- Do not default `--detect-auth-wall` (planned authenticated-crawling
  flag) to `true`. Its trigger only ever fires on the no-auth crawl path,
  and any real existing target mixing public and gated content (a
  marketing site with a `/login` link, a docs site with a members area,
  `/wp-admin`) would have that page silently rerouted to `hard-pages/`
  instead of captured/reported as it is today. Default `false` keeps the
  no-auth path byte-identical with zero exceptions — see CONTEXT.md's
  "Resolved: auth-wall detection is opt-in."
- Do not wire authenticated crawling into `.github/workflows/crawl.yml`
  as part of building it — same deliberate-opt-in posture already
  established for `publish_to_pages`; CLI-only until a separate, later
  decision.
