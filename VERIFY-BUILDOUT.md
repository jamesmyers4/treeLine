# VERIFY-BUILDOUT.md

_Session brief for Claude Code. Companion to CONTEXT.md and CLAUDE.md — does
not replace either. Written before any code exists for this feature; treat
every "recommend"/"default" below as locked unless explicitly reopened by the
repo owner. Mirrors the grill-then-lock discipline CONTEXT.md's "Authenticated
crawling" and `API-CAPTURE-BUILDOUT.md` sections already used — read one of
those first if unfamiliar with the pattern this repo expects._

## Purpose

treeLine has never had a test that checks whether a crawl's output is
_accurate_ against a real, complex, authenticated target — only that the
pipeline runs without crashing and that individual functions behave correctly
on fixtures. A real-world crawl of OpenEMR (via `OPENEMR-QA`, a sibling repo)
surfaced a concrete case of this gap: `OPENEMR-QA/CONTEXT.md` records that the
"Fees > Payment" URL treeLine's crawl captured
(`interface/billing/new_payment.php`) does not match where the real top-nav
actually navigates (`interface/patient_file/front_payment.php`).

This session builds `packages/verify`, a new, independent, target-agnostic
tool that logs into a live authenticated target, clicks through a
human-supplied map of nav labels, and reports where each one _actually_ lands
— then uses it for real against OpenEMR to find out whether the Fees > Payment
case is a one-off or a pattern, and whether it's a treeLine defect or
something else entirely (see "Step 0" below — don't assume the answer before
investigating).

## Important scoping clarification — read before touching `packages/core`

**This is not Phase 2 (interaction-reachable page discovery), and must not
become it.** `CLAUDE.md`'s "Do not" list is explicit: do not build Phase 2
yet. `packages/verify` never feeds anything it discovers back into a
`treeline crawl` frontier — it doesn't discover pages at all. It takes a
human-supplied list of {label, expected URL} pairs, independently confirms or
refutes each one via real navigation, and writes a report. It has no
dependency on the crawler's frontier logic and doesn't change crawl behavior
in any way. If a fix later turns out to require actual interaction-driven
discovery inside the crawler itself, stop and flag that to the repo owner
rather than building it under cover of this session — that's a standing
architectural decision, not a detail to route around.

## Explicit non-goals for this pass

- **No CI wiring.** This needs a live Docker target and real credentials; same
  posture as authenticated crawling's own explicit non-goals. Manual/on-demand
  only.
- **No per-element href auditing against `crawl.sqlite`.** `DomInteractiveElement`
  doesn't capture `href` today (existing open item in CONTEXT.md) — a fuller
  "does every captured link's recorded destination match reality" auditor
  needs that field first and is out of scope here. This pass audits a
  human-supplied nav-label map, not treeLine's internal per-element data.
- **No assumption that this is a treeLine code bug.** Step 0 (below) requires
  determining whether the Fees > Payment mismatch is a treeLine defect
  (e.g. a redirect not followed, URL normalization dropping something real)
  or a property of how that crawl's seed list was built (the `window.menu_objects`
  extraction technique CONTEXT.md's session 53 describes was a **manual
  workaround done outside treeLine**, not code this repo owns — feeding an
  unverified URL in as a seed and treeLine faithfully crawling exactly that
  seed is not, by itself, a treeLine bug). Do not write a "fix" before this is
  established. It's fully possible the correct outcome of this session is "no
  core code changes, but a real, reusable verification tool plus a documented
  finding" — that is a valid and valuable outcome, not a failure to find a bug.
- **No Tier 2 golden-master pipeline tests.** Separate follow-on file,
  `GOLDEN-MASTER-BUILDOUT.md` — don't start on it from this session.
- **No changes to OPENEMR-QA's own POMs/docs.** If real mismatches are found,
  they get written to this session's own report; correcting `OPENEMR-QA`'s
  `CalendarPage.ts`/`BillingPaymentPage.ts`/`CONTEXT.md` is the repo owner's
  call, made after reading the report, not something this session does
  automatically across a repo boundary.

## Locked decisions

1. **New package, `packages/verify`.** Same monorepo conventions as every
   other package: `@treeline/verify`, `tsconfig.json` extending
   `tsconfig.base.json`, `vitest` for its own fixture tests, `tsx` as its own
   devDependency (per CLAUDE.md's gotcha — `tsx` is never hoisted).
2. **Independent implementation of navigation, not a reuse of
   `packages/acquire/src/capture.ts`.** An oracle that reused the code under
   test could reproduce the same bug rather than catching it. The one
   exception: reuse `launchHardened` (from `packages/acquire`'s public
   surface, exported in `index.ts`) and `performLogin`/`LoginCredentials`/
   `StorageState`/`AuthExpiredError` for the login step only — that
   mechanism is already tested and login itself isn't in question here. All
   navigation/click/URL-comparison logic is new code in `packages/verify`,
   deliberately not shared with `capture.ts`.
3. **Primary capability: a nav-map auditor.** Input is a JSON file, a list of
   entries:
   ```
   { "label": "Fees > Payment", "expectedUrl": "https://localhost:9300/interface/billing/new_payment.php", "clickPath": ["Fees", "Payment"] }
   ```
   `clickPath` is an ordered list of accessible names to click through
   (top-nav items are often nested — confirm the real structure in Step 0,
   don't assume a flat menu). `expectedUrl` is whatever URL treeLine's crawl
   used or recorded for that logical destination — the thing being checked
   for accuracy, not a config value the tool trusts.
4. **Matching identity is the human-supplied `label`, not DOM occurrence
   index.** This is a deliberate departure from diff mode's
   role+accessibleName+occurrenceIndex matching (`packages/core/src/diff.ts`)
   — that scheme matches elements _between two treeLine crawls_ of the same
   structure; this tool matches a human's mental model of "the Fees > Payment
   link" against one specific real observation, so a plain label string is
   the right identity key here. Don't import or adapt the diff-mode matcher
   for this.
5. **Output: `verify-report.md`**, written to a caller-specified `--output`
   directory — **not** merged into `treeline crawl`'s own report set (no
   change to `packages/output`, no ninth/tenth report added there). Table of
   `label | expectedUrl | observedUrl | match/mismatch`, mismatches sorted
   first, same "regressions surfaced first" convention `diff-report.md`
   already uses. Route any human-supplied string (`label`) through
   `packages/output`'s existing `sanitizeMarkdownTableCell` — import it as a
   dependency rather than duplicating it; it's already exported from
   `@treeline/output`. Confirm that export exists before assuming it (Step 0
   below covers this).
6. **`--insecure-certs` is reused as-is**, same flag name and behavior as the
   crawler's (`ignoreHTTPSErrors: true` on every context) — OpenEMR's
   self-signed cert is the first real target either way.
7. **Not CI-gated.** A `verify` script in `package.json`, run manually:
   `pnpm --filter @treeline/verify verify -- <navMapFile> --base-url <url> --login-url <url> --username <user> --success-indicator <selector> [--insecure-certs]`.
   `TREELINE_LOGIN_PASSWORD` env var, exact same posture as `treeline crawl`
   — never a CLI flag, never persisted, never logged.
8. **Screenshot on mismatch, not on every check.** `page.screenshot()` saved
   next to `verify-report.md` (`verify-mismatches/<slugified-label>.png`) only
   for entries that don't match — a lightweight debugging aid, not a new
   dependency (no `pixelmatch`/visual-diff machinery needed, this is a plain
   capture for a human to look at, not a comparison).

## Mechanics

- **Step 0, before writing any navigation code:** confirm OpenEMR's real
  top-nav structure against the live container
  (`cd OPENEMR-QA/docker && docker compose up -d`, then `https://localhost:9300`,
  `admin`/`pass`). Specifically confirm: (a) whether top-nav clicks navigate
  the top-level page or load into a named iframe (`OPENEMR-QA/CONTEXT.md`
  already documents this as a tabbed frameset with named iframes — verify
  this is still true rather than trusting a doc from another repo at face
  value), (b) whether "Fees > Payment" is genuinely reachable without extra
  state (that same doc says it's disabled until a patient is selected, and
  posting requires an existing encounter) — the nav-map format may need an
  optional `precondition` note for entries like this, or such entries may
  need to be excluded from this pass's scope with the reason documented, not
  silently skipped.
- **Click-through implementation:** for each `clickPath` segment, use
  `getByRole('link', { name: segment })` or `getByRole('button', { name: segment })`
  scoped to whatever frame Step 0 determined is correct (top-level `page` or a
  named `page.frame({ name: ... })`), click, `waitForLoadState('networkidle')`,
  proceed to the next segment. After the full path, capture `page.url()` (or
  the relevant frame's URL if navigation stayed inside a frame — Step 0 again)
  as `observedUrl`.
- **Comparison:** exact string match after the same trailing-slash-tolerant
  normalization `packages/acquire/src/auth.ts`'s `normalizeForComparison`
  already implements — reuse that exported function rather than writing a
  second one; don't reach for `packages/core`'s `normalizeUrl` here either,
  same reasoning CONTEXT.md already gives for why `auth.ts` doesn't use it
  (fragment-stripping/query-sorting is overkill for this comparison and
  `core` must not become a dependency of `verify` just for one helper if
  `acquire`'s version already fits — confirm `verify`'s dependency graph
  stays one-directional, same discipline as every other package split in
  this repo).
- **One shared browser context per run**, not one per nav-map entry — after
  logging in once via `performLogin`, reuse the resulting `StorageState` for
  every entry via `browser.newContext({ storageState })`, same threading
  pattern session 50 already established. Re-verify login validity before
  each entry only if a prior entry's navigation looks like it landed on the
  login page (reuse `checkAuthStillValid` from `@treeline/acquire` for this
  check — same exported function the crawler itself uses).

## Session split

1. **`packages/verify` scaffolding + nav-map auditor, fixture-tested.** Build
   against a local fixture (a small Node/Fastify server, same "can't induce
   this against a live site" principle as every other capture-layer feature
   in this codebase) with a deliberately mismatched case — a nav link whose
   visible label leads somewhere different than a supplied `expectedUrl` —
   proving the tool correctly flags a mismatch, plus a matching case proving
   it doesn't false-positive. This is the mechanism proof, not the real
   finding.
2. **Real run against OpenEMR.** Step 0 investigation (above), build the
   actual nav-map JSON for OpenEMR's real top-nav (however many entries are
   reasonably reachable without complex precondition state — don't force
   every single item, especially ones gated behind other setup, into this
   first pass), run `verify`, read `verify-report.md`.
3. **Root-cause the Fees > Payment mismatch specifically** (and anything else
   `verify-report.md` turns up) against the "is this a treeLine bug or a
   seed-methodology issue" question in the non-goals section above. If it's a
   genuine treeLine defect: fix it in the smallest possible scope
   (`packages/core` or `packages/acquire`, wherever the actual defect lives —
   don't guess the location before finding it), with a regression test. If
   it's a seed-methodology issue: write the finding up plainly in
   `verify-report.md`'s own prose (not just the table) and stop there — do
   not invent a code fix for a problem that isn't in the code.

## Verification requirement

Same discipline as every other real-target feature in this codebase: fixture
first (step 1) proves the mechanism, then real-target (steps 2-3) proves it
against reality. Don't treat step 1 alone as "done." Confirm the OpenEMR
container is torn down and reset afterward (`docker compose down -v`) per the
same disposable-environment discipline session 53 already used — this repo
should never depend on a specific mutated OpenEMR state to keep working.

## Open items carried forward (not this session's job, noted so they aren't lost)

- `DomInteractiveElement.href` is still not captured — blocks a future,
  fuller per-element crawl-output auditor that could run directly off
  `crawl.sqlite` instead of a hand-built nav-map. Worth reconsidering once
  this session's simpler tool has proven the concept is useful.
- If step 3 finds the root cause is "unverified seed URLs get treated with
  the same confidence as organically-discovered links, with no way to tell
  them apart in output," a reasonable future fix is tagging captured pages
  with a discovery-source field (`'link' | 'sitemap' | 'seed'`) so reports
  can flag lower-confidence entries — noted here as a candidate, not decided,
  since whether it's warranted depends entirely on what step 3 actually
  finds.
- `GOLDEN-MASTER-BUILDOUT.md` — separate file, separate session track, not
  blocked by this one and can run before or after it.
