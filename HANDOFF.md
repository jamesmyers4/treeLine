# HANDOFF.md — treeline (as of session 43)

_Written for a fresh Claude Code session, or a fresh conversation with
Claude, picking this project up with zero memory of the 43-session history
that built it. Read `CONTEXT.md` and `CLAUDE.md` next — both were
synced to reflect real repo state as of this same session, so they should
be trustworthy as of right now. Still: verify real repo state over
trusting any document, including this one — that's been the single most
consistent lesson of this entire project._

## What treeline is, briefly

An AI-powered site comprehension engine. Crawls a site with a hardened
Playwright/Patchright browser, captures real DOM + accessibility-tree
state, runs tiered AI interpretation (Claude Haiku 4.5 / Sonnet 5), and
generates Page Object Models, Playwright specs, and eight markdown reports
(selector stability, testid audit, atlas, axe accessibility, flow map,
coverage gaps, timing/flakiness, proposal coverage). For pages with a form, it can also
propose — never auto-run, never auto-commit — a fill-and-assert test
scenario as a separate, `test.skip`-wrapped file. Also supports diffing
two crawls against each other, including visual (screenshot pixel-diff)
comparison, with a `--fail-on-regression` CI-gate flag. All of this runs
in CI via a real GitHub Action, which can optionally publish rendered
output as a live, browsable website. Full architecture and rationale:
`CONTEXT.md`.

## Verify the repo is actually in the state described

Don't assume — confirm, in order. This list is longer than earlier
versions of this document because there's genuinely more surface area now
— don't skip steps because an earlier HANDOFF.md had fewer of them.

```
pnpm install
pnpm --filter @treeline/acquire build && pnpm --filter @treeline/acquire test
pnpm --filter @treeline/core build && pnpm --filter @treeline/core test
pnpm --filter @treeline/interpret build && pnpm --filter @treeline/interpret test
pnpm --filter @treeline/output build && pnpm --filter @treeline/output test
pnpm --filter @treeline/pages build && pnpm --filter @treeline/pages test
pnpm --filter @treeline/cli build && pnpm --filter @treeline/cli test
```

All six should build and pass cleanly. If `packages/cli`'s tests show a
wall of unrelated failures importing `@playwright/test`, check
`packages/cli/vitest.config.ts` excludes `treeline-output/**` (see
CLAUDE.md's gotchas).

Then confirm the real CLI still works end to end:

```
cd packages/cli
pnpm exec tsx src/index.ts crawl https://example.com --max-pages 2 --output ../../treeline-output/handoff-verify --skip-interpretation
```

Check `treeline-output/handoff-verify/reports/` for all **eight** report
files (`proposal-coverage-report.md` is new since the last time this
document was written). Then confirm diff mode
(including visual diffing):

```
pnpm exec tsx src/index.ts crawl https://example.com --max-pages 2 --output ../../treeline-output/handoff-verify-2 --skip-interpretation
pnpm exec tsx src/index.ts diff ../../treeline-output/handoff-verify ../../treeline-output/handoff-verify-2
```

Should produce `diff-report.md` with a Visual Changes section, and an
eighth section, `## Page Load Timing Changes` — a real timing regression
won't show up between two identical fast `example.com` crawls, but the
section header and "No timing regressions found." empty-state copy should
still be present.

If you want to confirm the AI-proposed-assertion path too, run a small
crawl against `httpbin.org/forms/post` **with** interpretation enabled
(a real `ANTHROPIC_API_KEY` set, no `--skip-interpretation`) and check for
a `.proposed.spec.ts` file alongside the generated specs — every test in
it should be `test.skip`-wrapped. As of session 45 there are two possible
shapes: a form-fill proposal (`.fill()`/`.check()`/`.selectOption()` calls
plus a submit click) for a page with a captured form, or a
content-presence proposal (one or more `toBeVisible()` assertions) for a
form-less page — crawl a form-less content page (e.g. a docs or article
page) separately to see the second shape. Check
`reports/proposal-coverage-report.md` too (session 46) — it's a crawl-wide
index of which pages got a proposal, of which kind, and which eligible
pages didn't, derived entirely from already-captured data (no new
persistence).

Also confirm `.github/workflows/crawl.yml` exists and has a
`publish_to_pages` input (not just `url`/`max_pages`/
`skip_interpretation`) — this workflow has grown substantially since
Stage A alone.

If any of this doesn't match what's claimed below, stop and figure out
why before writing new code — something regressed.

## What's actually done

**v1 (sessions 1-20) — complete.** Crawler, hardened capture (DOM ground
truth + axe-core), 2-tier AI interpretation with retry, all five base
reports, POM + spec generation, `hard-pages/` escalation, diff mode
(sessions 11-14), form/flow map (sessions 16-19).

**Visual diffing (sessions 21-27) — complete.** Real screenshot capture,
disk persistence, pixel-diff comparison at an empirically-derived 0.1%
threshold, diff-image generation, rendered into `diff-report.md`.

**GitHub Action, Stage A (session 28) — complete.** `workflow_dispatch`
trigger, `url`/`max_pages`/`skip_interpretation` inputs, runs under Xvfb,
uploads output via `actions/upload-artifact`. Proven against two real
sites.

**Process-lifecycle fix (session 29) — complete.** A real CI run once
hung ~1.5 hours from an unclosed browser on an error path. Fixed with a
`finally` block plus a `process.exit()` backstop plus a workflow timeout.

**Real-output review + two bugs found and fixed (sessions 30-32) —
complete.** A POM/spec filename collision bug (two URLs slugifying to the
same name, silently overwriting each other) and a redirect-origin scope
bug (same-origin filtering rejecting real content after a 301 redirect),
both found by actually reading real crawl output, not by unit tests.

**GitHub Pages publish, Stage B (sessions 34-35b) — complete.** New
package `@treeline/pages` renders a crawl/diff output directory to static
HTML (markdown-it + shiki). Publishes to `gh-pages` under
`runs/<run_number>/`, opt-in via `publish_to_pages` (default `false`).
Found and fixed a real boolean-input type-coercion bug in the workflow
YAML along the way — six gated steps silently never ran regardless of the
input, for one session, before being caught by actually triggering the
workflow and watching nothing happen.

**Root landing page (session 37) — complete.** The bare Pages URL 404'd
even with the branch and Settings correct, because nothing wrote a root
`index.html` — only `runs/index.html` existed. Fixed with a static
meta-refresh redirect file, written on every publish run so it's
self-healing.

**Coverage-gap report (session 38) — complete.** Sixth report,
`coverage-report.md`: zero-coverage pages, high-skip pages, forms without
a generated test (found to be universally true today, stated as such),
unresolved `hard-pages/` entries. Bundled in the same session: a real
flow-map table-overflow CSS fix, found via a real published run.

**Timing/flakiness signal, first cut (sessions 39-41) — complete.** New
capture: page-load time, per-request duration, per-element appearance
latency (the last one narrowed to only mean something for elements that
render in after initial load). Seventh report, `timing-report.md`, three
sections with empirically-derived thresholds (two solid, one — appearance
latency — on a genuinely thinner basis, stated as such). Diff-mode timing
regression detection deliberately deferred — needs real run-to-run noise
data to design against, which now exists but hasn't been used yet.

**AI-proposed test assertions, first cut — forms only (session 42) —
complete.** Proposes a fill-and-assert scenario for pages with a captured
form, as a separate `*.proposed.spec.ts` file, every test `test.skip`-
wrapped, values obviously synthetic, success assertion explicitly labeled
an unverified guess. A real bug (model's freeform text used as a
structured-data lookup key) found and fixed via the mandated manual
check.

**Escaping/injection audit (session 43) — complete.** Not a V2.md item —
reactive hardening, prompted by a direct question about whether a
dedicated review pass would find things feature-scoped sessions wouldn't.
It did: an `escapeHtml` gap (missing `'`), a real markdown/table content-
spoofing bug (crawled content with `|` or embedded newlines could corrupt
report tables or inject fake headings/links — not code execution, but
real integrity damage), and a comment-breakout risk in the proposed-
assertion generator. All fixed, all covered by a new permanent regression
test verified against raw HTML bytes, not just assertions.

**AI-proposed test assertions, extended beyond forms (session 45) —
complete.** Widened `ProposedAssertion` into a discriminated union:
`FormFillAssertion` (session 42's shape, `kind: 'form-fill'`) and a new
`ContentPresenceAssertion` (`kind: 'content-presence'`), mutually
exclusive on `pageState.forms.length`. Two additive changes: (1) removed
session 42's blanket search-box exclusion, so a search/filter-primary
form now gets a results-appear/URL-changed success assertion instead of
being skipped outright; (2) form-less pages now get a content-presence
proposal referencing already-captured `interactiveElements` by
bounds-checked index — never freeform body text, same
never-trust-model-as-lookup-key discipline session 42 established.
`test.skip`, synthetic-data, and `toSafeComment` escaping discipline
carried over unchanged to the new path. Verified against two real
targets: `en.wikipedia.org` (search-form phrasing) and
`www.gnu.org/software/bash/manual/bash.html` (form-less content-presence,
including a spot-check that a generated locator traced back to a real
captured `cssPath`); both generated specs confirmed `skipped` under a
real `npx playwright test` run.

**Proposal coverage summary report (session 46) — complete.** Closed
item 5's last deferred piece. Eighth report, `proposal-coverage-report.md`
— derives five mutually-exclusive per-page categories (form-fill proposal,
content-presence proposal, form without a proposal, content-eligible
form-less page without a proposal, no eligible elements at all) purely
from data already captured on `CrawledPage` plus the joined
`proposedAssertion` — no new persistence, `packages/interpret` untouched.
Same structural model as `coverage-report.ts`. Verified against two real
crawls (`httpbin.org/forms/post`, `example.com`, both
`--skip-interpretation`) confirming category counts sum to the
captured-page count; the proposal-bearing branches themselves rely on
unit-test coverage and the existing mocked `orchestrate.test.ts`
interpretation fixture, since a real `ANTHROPIC_API_KEY` wasn't available
this session.

## Known staleness — read this before trusting anything older

`CONTEXT.md` and `V2.md` were synced in the same session this paragraph
was last updated in (session 45); `CLAUDE.md` was last synced session 43
and was not touched session 45 (no operational/convention change this
session, only a data-shape extension already covered by `CONTEXT.md`'s
"Model routing"/interpretation sections). As of right now, all three
should be accurate. If you're reading this significantly after it was
written, treat that sync as a snapshot, not a guarantee — check dates/
session numbers in each file's header against whatever the real latest
session turns out to be, the same way this document itself keeps telling
you to verify rather than trust.

**One thing this sync could not do: `README.md` was not included** in
what was available when this sync happened, so it was left untouched. It
may be stale relative to everything above — worth a look before treating
it as accurate, especially since it's the file most likely to be read by
someone outside this project (a portfolio reviewer, a hiring contact).

## What's left — options, not a directive

**Item 5 remaining extension (AI-proposed assertions).** Session 45 closed
the "scenarios beyond forms" gap (search-form phrasing, form-less
content-presence assertions); session 46 added the summary report
(`proposal-coverage-report.md`). Still open, not scoped: a lightweight
"promote this reviewed proposal into the trusted spec" workflow (plain
copy-paste may already be sufficient — untested).

**Item 4's remaining piece: diff-mode timing regression detection.**
Deliberately deferred until real report output and real run-to-run noise
existed to design against. That data exists now (sessions 39-41 produced
real crawls with real timing data) — this is the most "ready to pick up"
unfinished piece on the whole list, in the sense that its own stated
blocker is resolved.

**Item 6 — multi-step flow test generation.** The biggest remaining item
by a wide margin. Depends on interaction-reachable page discovery (a real
new capability, not an extension), which itself has never been started.
Don't begin this without real appetite for a diff-mode-or-bigger
multi-session arc, and expect the estimate to be a floor, not a ceiling —
every ambitious V2 item so far has taken longer than its first guess.

**Item 7, Stage C — a real hosted frontend.** Stages A and B are done.
Stage C (URL-triggers-a-run web UI, Monaco-based output browser) needs its
own real scoping pass on hosting/triggering architecture before any
session prompt gets written — don't treat it as a quick continuation of
Stage B just because the number is close.

**Item 8 — auto-file bugs to an external tracker.** Just an idea,
captured, not scoped at all. The one real open question it raised on its
own (how would treeline tell "a real site bug" apart from "my own
generated test is stale or wrong," which is the actual precondition for
this being safe to build at all) needs answering before this gets any
closer to a session prompt.

**Three more audit types were named but never run**, alongside the
escaping/injection one that was: a cross-session consistency check
(specifically: do the null/missing-data conventions established
independently in sessions 39, 40, and 42 actually agree with each other,
or did three different sessions each invent a slightly different
convention for "this value is missing"?), a genuine docs-accuracy pass
beyond "what changed since the last sync," and a dead-code hunt
specifically for more cases like the `pageLoadMs ?? 0` fallback that
turned out to be unreachable — that one was caught by accident, in
conversation, not by a dedicated search for the pattern.

## Known gotchas from sessions 37-43 (folded into CLAUDE.md, repeated here

for visibility)

- The GitHub Pages root URL now works (session 37) — this was a real,
  previously-documented gap, now closed. Don't re-investigate it as if
  it's still open.
- `markdown-it`'s `html: false` setting is load-bearing for safety, not
  just a formatting choice — don't flip it without a fresh audit.
- Any dynamic/untrusted value going into generated output needs the
  escaping technique matched to its destination — `JSON.stringify` for a
  quoted string literal, `toSafeComment()` for a `//` comment,
  `sanitizeMarkdownText`/`sanitizeMarkdownTableCell` for markdown,
  `escapeHtml` for hand-written HTML templates. There is no one universal
  safe function.
- Never `echo` a raw secret value to a terminal an agent might read back
  — check presence (`${VAR:0:8}...` or a presence test), not content. A
  real key got exposed this way earlier in this project's history and had
  to be rotated.
- Never use a model's freeform text as a lookup/matching key against
  structured data — a real bug in session 42 traced directly back to this.

## Judgment calls worth knowing the reasoning behind, not just the outcome

- **Pixel-diff, not AI-vision, as the primary visual-diff mechanism.**
  Deterministic, free, fast; an AI-description layer was considered as a
  future addition, gated to only fire on pages pixel-diff already flagged
  — not built.
- **Warn-with-a-fix, not auto-widen, for the origin-mismatch case.**
  Session 32 deliberately preserved strict same-origin enforcement rather
  than treating www/non-www as automatically equivalent.
- **No new CLI flags added without a clear need**, throughout this whole
  project — the GitHub Action's input surface has grown, but only ever by
  one input at a time, each time tied to a specific, real need
  (`publish_to_pages`), never speculatively.
- **`publish_to_pages` defaults to `false`, and this isn't just abstract
  caution.** A real crawl of a company the repo owner was actually
  interviewing with (goldenpetbrands.com) got published to the public run
  history mid-project, with the (reasonable, well-intentioned) idea of
  possibly sharing the link with the hiring contact there. On reflection
  it was pruned instead — the crawl itself was technically and legally
  fine, but a permanent, public, unsolicited scan of a real company's
  site, while a hiring relationship might still be live, was judged not
  worth the risk, especially given that particular crawl wasn't even a
  strong demonstration of treeline's real strengths. Full detail in
  `CONTEXT.md`. The takeaway that should outlive this specific incident:
  treat `publish_to_pages` as being for targets you own or have real
  standing to publish about, not a default toggle for whatever you happen
  to be crawling that day.
- **`test.skip` plus a separate file, not prose-only and not
  enabled-by-default code, for AI-proposed assertions.** Considered and
  rejected: prose-only (safe but loses almost all value — every proposal
  becomes a from-scratch rewrite) and enabled-by-default code (real
  industry precedent strongly against this — no serious test-generation
  tool defaults to "runs against production automatically," and this
  would have been the first time treeline's own default behavior could
  cause a real side effect on someone else's live system). `test.skip` +
  separate file gives real, useful, editable code with two independent
  safety layers (file separation and runtime skip) instead of relying on
  either alone.
- **A dedicated audit session is a real, distinct category of session,
  not just "more of the same."** Session 43 wasn't scoped to build
  anything — it existed to check a specific question (does untrusted
  content ever reach published HTML unescaped) across everything built so
  far, something no single feature-scoped session had reason to do on its
  own. It found three real things a feature-by-feature approach hadn't
  caught. Worth treating as a periodic practice, not a one-time event —
  see "What's left" above for three more audit questions raised but not
  yet run.
