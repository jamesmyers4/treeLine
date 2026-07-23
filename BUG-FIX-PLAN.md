# BUG-FIX-PLAN.md — external QA feedback + ZBUGS.md

Source: feedback filed by a Claude Code agent that consumed a real treeline
crawl of Hacker News (5 pages: /, /front, /newest, etc.) to write test
automation, plus one repo-owner observation in `ZBUGS.md`. Eight issues
total. Scheduled below as small, single-package sessions per this repo's
session-splitting practice (CLAUDE.md). Each session ends with the standard
verify loop: build + test the touched package, then build + test
`@treeline/cli` (its golden-master tests are the cross-package tripwire).
**Any session that changes generated output must regenerate goldens
deliberately (`UPDATE_GOLDEN=1`) and review the diff as part of the session
— never blind-update.**

Status legend: `[ ]` not started · `[x]` done (committed by repo owner).

---

## Session 1 — `[x]` POM identifiers can start with a digit (feedback #1a)

**Severity: highest — generated code doesn't compile.** An element named
"3 minutes ago" becomes `readonly 3MinutesAgoLink1: Locator`, a TS syntax
error. Same bug exists for class names: a URL path like `/3d-printers`
produces `class 3dPrintersPage`.

- Package: `packages/output` only.
- Fix: a `sanitizeIdentifier` helper in `naming.ts`, applied at the end of
  `elementToPropertyName` and `urlToClassName` — prefix `_` when the first
  character is a digit. Downstream naming steps (`deduplicatePropertyNames`,
  `assignUniqueNames` collision suffixes) append at the end, so they can't
  reintroduce the bug; `generateSpec`'s instance name (`lowerFirst` of the
  class name) passes `_` through unchanged.
- Tests: digit-leading accessibleName → `_3MinutesAgoLink`; digit-leading
  URL segment → `_3dPrintersPage`; non-digit names unchanged.
- Goldens: expected unchanged (no fixture has digit-leading names) — verify
  by running `@treeline/cli` tests, don't assume.

**Completed this session (2026-07-22).** Goldens confirmed unchanged.

## Session 2 — `[x]` Syntax gate on generated artifacts (feedback #1b)

"A proposal that doesn't parse wastes the reviewer's time budget."

- Package: `packages/output` (gate helper + wiring is one call site each in
  the generators' consumers; if wiring must land in `orchestrate.ts`, that's
  a deliberate second package, kept to the one call).
- **Constraint discovered during planning, resolve in-session:** full
  `tsc --noEmit` cannot type-check generated artifacts at generation time —
  they import `@playwright/test`, which is not installed in the output
  directory or in this repo's own test setup (that's exactly why
  `vitest.config.ts` excludes `treeline-output/**`). The achievable gate is
  a **parse/syntax check** via the TypeScript compiler API
  (`ts.createSourceFile` + parse diagnostics) — this catches the Session-1
  class of bug (illegal identifiers, comment breakout, unbalanced tokens)
  without module resolution. `typescript` is already a workspace
  devDependency; making it a real dependency of `@treeline/output` is a
  decision for this session to confirm.
- Apply the gate to every generated `.ts` artifact: POMs, specs,
  `*.proposed.spec.ts`. On failure: fail loudly with the file name and
  diagnostic (a generated artifact that doesn't parse is a treeline bug,
  never valid output).
- Test: feed a known-bad render (e.g. force an unsanitized identifier
  through) and assert the gate rejects it; assert all current golden
  scenario artifacts pass it.

**Completed this session (2026-07-22).** `syntax-gate.ts` in
`packages/output` (parse check via `ts.transpileModule` +
`reportDiagnostics` — public API, same syntactic diagnostics as
`createSourceFile`'s internal `parseDiagnostics`), wired inside
`generatePOMsAndSpecs` (POMs + specs) and `generateProposedAssertionSpecs`
(proposed specs) so no `packages/cli` change was needed; `typescript`
promoted from devDependency to real dependency of `@treeline/output`.
Golden scenarios all pass with the gate active in the generation path;
goldens unchanged.

## Session 3 — `[x]` Stability ranking trusts entity-id selectors (feedback #2)

The 30 CSS selectors rated "stable" on /newest are all `#up_<storyid>` vote
anchors — unique and stable across a re-crawl of the same snapshot, but the
least stable selectors on the page across time (the story id is a per-item
entity id).

- Package: `packages/core` (`selector-candidates.ts`).
- Fix: extend `isCssStable` to treat entity-shaped tokens as unstable by
  construction — an id or class segment in the `cssPath` containing a long
  digit run (threshold to be derived in-session; start from real data:
  `up_45201358` yes, `col2`/`h1` no) marks the CSS candidate `stable: false`.
  Same normalization insight as `isHashLikeClass` (already there), applied
  to digit-run ids. Check `elementId` too, since `computeCssPath` builds
  from ids.
- Ripple: selector-report stable counts, POM generation (these elements may
  now fall back to role or be skipped), diff-mode classification. Goldens
  may change — regenerate deliberately and review.
- Test: `#up_45201358`-style path → unstable; a semantic id (`#main-nav`) →
  still stable; boundary cases at the chosen digit-run threshold.

**Completed this session (2026-07-22).** Threshold chosen: a run of **4+
consecutive digits** in an id or class token (`up_45201358` → unstable;
`col2`, `h1`, `error404` → stable; boundary tested at `error404` vs.
`item-1000`). Checks `elementId` and every `#id`/`.class` token in
`cssPath` (covers entity tokens in ancestor segments). Role candidates
unaffected, so POMs fall back to role for these elements. New
`selector-candidates.test.ts` (the file previously had no dedicated
tests). Goldens confirmed unchanged — no fixture carries a 4+-digit
token.

## Session 4 — `[x]` Proposed specs must verify actions against captured DOM (feedback #4)

The proposed /newest spec clicks `getByRole("button", { name:
/submit|create|save|continue|send/i })`, but HN's search form has no submit
button — it submits on Enter. The element wasn't in treeline's own captured
snapshot, so the generator could have known.

- Package: `packages/output` (`proposed-assertions.ts`, `buildSubmitLine`).
- Fix: the guessed-regex fallback in `buildSubmitLine` violates this repo's
  own rule in spirit — it emits an action targeting an element treeline
  never captured. When `findSubmitField` finds no button among the captured
  form fields, check `page.interactiveElements` for a submit-shaped button;
  if none exists in the captured DOM either, emit
  `await <lastFilledFieldLocator>.press('Enter')` with an honest comment
  (via `toSafeComment`) stating the form had no captured submit button.
  Never emit a locator for an element absent from the capture.
- Test: form with a real submit button → click (unchanged); form with no
  button anywhere in the capture → `press('Enter')` on the last filled
  field, no `/submit|create|save/i` regex anywhere in output.

**Completed this session (2026-07-22).** `buildSubmitLine` now falls back
form button → submit-shaped button (`role === 'button'` + name matching
the old pattern) among *captured* `interactiveElements` (locator built
from the real element via `buildContentElementLocator`) →
`press('Enter')` on the last filled field with an honest `toSafeComment`
note → comment-only line when there's also no fillable field (still
passes the session-2 syntax gate, tested). The guessed-regex locator is
gone from generated output entirely. Goldens unaffected (they skip
interpretation); cli suite green.

## Session 5 — `[ ]` Entity extraction inconsistent across pages (feedback #6)

Atlas abstracts /newest's entities cleanly ("Story title", "Points",
"Submission time") but lists thirty individual story titles as
`keyDataEntities` for / and /front. Same site, same crawl, different
abstraction level.

- Package: `packages/interpret` (prompt in `interpret.ts`).
- Fix: prompt guidance — `keyDataEntities` are entity *types*, never
  instances; if the page shows a repeating list, name the entity type once
  plus its fields, don't enumerate items. Consider a defensive cap/warning
  when the model returns a long list of near-identical entries (but per the
  repo rule, never post-process model text into a lookup key — cap/flag
  only, don't rewrite).
- Verify against a real crawl of a list-heavy page (the golden-master
  fixtures skip interpretation, so this needs a real API-key run — HN
  /newest vs / is the exact reported case).

## Session 6 — `[ ]` ZBUGS.md: HN's orange not captured by color report

`ZBUGS.md`: "hacker news website has some orange — treeLine is not
capturing that correctly."

- Package: `packages/acquire` (`extractColorPalette` in `capture.ts`).
- Likely cause (verify in-session, don't assume): HN is a table-layout site
  — the site-defining `#ff6600` lives as a `bgcolor` on a `<td>` (and on a
  1px `<img>` spacer). `extractColorPalette`'s fixed structural selector
  (`body, header, nav, main, footer, h1–h6, p, a, button, input,
  [class*="btn" i]`) contains no table elements, so the orange is never
  sampled.
- Fix: reproduce first with a local fixture mimicking HN's table layout
  (real-fixture-not-live-site discipline), then extend the sampling
  selector minimally (`table, td, th` — measure the DOM-walk cost on a
  large table page before accepting; the `MAX_COLOR_SWATCHES` cap bounds
  output, not walk cost).
- Goldens: `color-report.md` is deliberately excluded from golden
  comparison, so no golden churn expected — still run the cli suite.
- Close `ZBUGS.md` entry (delete or annotate) when done.

## Sessions 7-9 — `[ ]` Repeating regions → row component + deduped selector report (feedback #3 + #7)

These two share one underlying capability — detecting that thirty sibling
`tr.athing` rows have identical internal structure — so they're sequenced
as one arc, detection first. Highest-leverage change for the consuming QA
engineer; also the largest, hence scheduled after the small fixes.

- **Session 7 — detection utility** (`packages/output`, new
  `repeating-regions.ts`): group a page's `interactiveElements` into
  repeating patterns — same (role, tagName) sequence under sibling parent
  paths (cssPaths differing only in an index/entity segment; Session 3's
  entity-token normalization is reusable here). Output: pattern groups with
  a structural signature, instance count, and member elements. Pure
  function + unit tests against an HN-shaped fixture (30 identical rows)
  and a negative case (heterogeneous page → no groups). No consumer changes
  yet, so no golden churn.
- **Session 8 — POM row component** (`packages/output`,
  `pom-generation.ts`): for a detected repeating region, emit one
  `StoryRow`-style class (one Locator per within-row element, scoped to a
  row root locator) plus an indexed accessor on the page class
  (`storyRow(index)`), instead of ~230 per-instance fields. Non-repeating
  elements keep today's treatment. Generated-code formatting stays normal/
  readable per CLAUDE.md. Goldens will change — regenerate deliberately;
  `duplicate-destinations` scenario needs a careful look (its two
  same-text links must not be misclassified as a repeating region — only
  structural repetition of sibling containers qualifies, minimum instance
  count to be decided in-session, e.g. ≥3).
- **Session 9 — selector report dedup** (`packages/output`,
  `selector-report.ts`): report each repeating pattern once with an
  instance count and one representative entry (410 KB → order of magnitude
  smaller). Non-pattern elements render as today. Goldens change —
  regenerate deliberately.

## Sessions 10-12 — `[ ]` Assertable data sources report (feedback #5)

The `.age` span's `title` attribute carries the exact timestamp a test
wants to assert on, and no report mentions it. New capability: surface
elements carrying machine-readable values (`title`, `datetime`, `data-*`).
Follows the proven capture → persist → render+wire session split
(flow-map, sessions 16-19).

- **Session 10 — capture** (`packages/acquire`): new extraction pass in
  `capture.ts` (shape it like `extractColorPalette`: fixed selector
  `[title], [datetime], time, [data-*]`-equivalent — note `[data-*]` isn't
  a real CSS selector, so attribute enumeration per element is needed;
  bound the walk and cap entries per page). New
  `PageState.assertableAttributes` field — decide the exact shape
  field-by-field in the session brief before coding. **Shared-type
  fallout warning:** adding a required `PageState` field breaks fixtures
  in all six packages and only `build` catches it — budget for the full
  build sweep (CLAUDE.md gotcha, confirmed 4x).
- **Session 11 — persistence** (`packages/core`): new JSON TEXT column on
  `pages`, same pattern as `colorPalette` (round-trip tests: non-empty,
  empty-as-`[]`, isolation across rows).
- **Session 12 — report + wiring** (`packages/output` + one call in
  `packages/cli/orchestrate.ts`): `assertable-data-report.md` — per page,
  a table of element / attribute / value / suggested locator, every
  dynamic value through `sanitizeMarkdownTableCell`. Wire in as an
  automatic report (always-on, same posture as color-report: attributes
  are visible to any human viewing source). Update CLAUDE.md's report
  count/list.

---

## Standing rules for every session above

- One package per session where possible; flag any forced second-package
  touch instead of silently expanding scope.
- After a shared-type change, `pnpm --filter <pkg> build` for **every**
  package — vitest does not type-check.
- Golden changes are always deliberate: run the cli suite, inspect the
  diff, regenerate with `UPDATE_GOLDEN=1` only when the change is the
  intended one, and say so in the session summary.
- No comments in treeline source; generated-code templates stay readable.
- All dynamic values into generated code/markdown go through the escaping
  strategy matched to the destination (CLAUDE.md conventions).
- Stop after each session for a manual commit by the repo owner; update
  this file's checkbox + a one-line outcome note as part of the session.
