# GOLDEN-MASTER-BUILDOUT.md

_Session brief for Claude Code. Companion to CONTEXT.md and CLAUDE.md — does
not replace either. Same locked-unless-reopened discipline as
`VERIFY-BUILDOUT.md` and `API-CAPTURE-BUILDOUT.md`. Independent of
`VERIFY-BUILDOUT.md` — can run before or after it, no shared code between
them._

## Purpose

Two gaps, closed together because they're the same underlying need — a
trustworthy, automatic check that the pipeline still produces correct output:

1. **No CI workflow runs the test suite at all today.** `.github/workflows/crawl.yml`
   exists (manual `workflow_dispatch` only) but there is nothing that runs
   `pnpm -r test` on push or pull request. The ~36 existing Vitest files across
   6 packages only run when a human remembers to, locally.
2. **Nothing checks that a full `treeline crawl` run's _output_ is
   correct**, only that individual functions behave correctly in isolation.
   session 31's filename-collision bug and the invalid-TypeScript-identifier
   issue `OPENEMR-QA/CONTEXT.md` reports were both real-output problems a
   golden-master (run the real pipeline, diff against known-correct output)
   test would have caught directly.

## Explicit non-goals for this pass

- **No AI-interpretation-path golden coverage.** Every golden test runs with
  `skipInterpretation: true` — real API calls aren't free, aren't
  deterministic, and CI shouldn't depend on a stored `ANTHROPIC_API_KEY`
  secret to pass. Mocking the Anthropic SDK boundary to cover the
  interpretation path deterministically is real, separately-scoped future
  work — noted in "Open items," not attempted here.
- **No GitHub Pages publish (`@treeline/pages`) golden coverage this pass.**
  Separate rendering pipeline, separate future session if wanted.
- **No changes to `VERIFY-BUILDOUT.md`'s `packages/verify`.** That tool is
  explicitly not CI-gated (needs live Docker + credentials) and stays that
  way — don't fold it into the workflow this session creates.
- **No attempt to golden-test exact timing numbers** (`timing-report.md`'s
  ms values, `pageLoadMs`, `durationMs`, `appearedAtMs`). These are
  legitimately non-deterministic even on a local fixture. Normalize them out
  of the comparison (see "Mechanics") rather than trying to pin them down.

## Locked decisions

1. **New workflow, `.github/workflows/test.yml`.** Triggers: `push` and
   `pull_request` targeting `main`. Separate file from `crawl.yml`, not a
   second job bolted onto it — different trigger model
   (`workflow_dispatch` vs. `push`/`pull_request`), different purpose.
2. **Step 0, before writing the workflow YAML:** confirm what `pnpm -r test`
   actually requires to run clean outside a machine that already has
   Playwright/Patchright browsers installed. Several existing fixture tests
   (`packages/acquire/src/capture.test.ts` and others) launch real browsers
   against local Node fixture servers — confirm whether they need
   `pnpm exec playwright install --with-deps chromium` (and the Patchright
   equivalent, if it maintains a separate browser channel) and whether they
   need Xvfb the way `crawl.yml`'s headed capture path does, or whether test
   fixtures already force `headless: true` internally. Don't assume either
   answer — run `pnpm -r test` in a fresh environment without pre-installed
   browsers and observe what actually fails, the same "confirm, don't
   assume" discipline `CLAUDE.md`'s own verification steps already model.
3. **Golden fixtures and expected output live under `packages/cli/test/`**
   (`packages/cli/test/fixtures/<scenario>/server.ts`,
   `packages/cli/test/golden/<scenario>/`), checked into git as real files,
   not generated at test-run time. `packages/cli` is the right home — it's
   already the orchestration entry point, and `vitest.config.ts`'s existing
   `treeline-output/**` exclusion already lives there.
4. **Drive the pipeline through `runTreelineCrawl` directly** (`packages/cli/src/orchestrate.ts`), not by spawning a CLI subprocess — same reasoning
   `orchestrate.test.ts` already demonstrates (faster, easier to assert
   against, already the established pattern for exercising the whole
   pipeline from a test). Set `skipInterpretation: true` on every golden
   test's `TreelineCrawlOptions`.
5. **Comparison is exact-match after normalization, not fuzzy/semantic
   diffing.** Before comparing a generated file to its golden counterpart,
   regex-replace known-nondeterministic substrings with a fixed placeholder
   token (ISO timestamps, `pageLoadMs`/`durationMs`/`appearedAtMs` numeric
   values) in a shared test helper (`packages/cli/test/normalize-golden.ts`),
   applied identically to both the freshly-generated file and the checked-in
   golden file before `expect(...).toBe(...)`. Do not hand-normalize per
   test — one shared function, reused, so a new nondeterministic field
   discovered later only needs fixing in one place.
6. **Three fixture scenarios, locked:**
   - **`static-site`** — a handful of plain pages, some duplicate nav links,
     no forms, no XHR. Baseline happy path: `atlas.md`, `selector-report.md`,
     `testid-audit.md`, `coverage-report.md`, POM/spec files.
   - **`form-and-api`** — one page with a real `<form>` and a page that fires
     an XHR/fetch call the fixture server responds to. Exercises
     `flow-map.md`'s forms table and API surface table together, the thing
     session 18 originally built.
   - **`duplicate-destinations`** — several links sharing identical visible
     text but pointing at genuinely different URLs. This deliberately locks
     in the documented, known limitation (CONTEXT.md's "Open items": POM
     property naming doesn't disambiguate same-text/different-destination
     links) as an **intentional, explained golden case** — the test's own
     description should say plainly that the `.nth()`-scoped-but-
     undifferentiated-name output is the current, accepted, documented
     behavior, not a bug this session is expected to fix. If a future
     session adds `href` capture and fixes this, this golden file is
     expected to change deliberately at that point — leave a code comment
     saying so isn't needed per this repo's no-comments convention, but the
     test's own `describe`/`it` name should make the intent legible.
7. **Golden-compare POM/spec `.ts` output too, not just markdown reports.**
   POM/spec generation is this project's stated primary deliverable
   (CONTEXT.md's "Primary deliverable priority" #1) — leaving it out of
   golden coverage would be a real gap, not a reasonable scope cut.
8. **On mismatch, print both full normalized contents to the test output**,
   not just a pass/fail — a bare `toBe` failure on a multi-hundred-line
   markdown file is nearly undiagnosable without seeing what actually
   changed. A small diff helper (even a naive line-by-line compare) is
   worth the code; don't ship this without it.

## Mechanics

- **Fixture servers** follow the exact pattern `orchestrate.test.ts` already
  uses: `node:http`'s `createServer`, started in `beforeAll`, closed in
  `afterAll`, bound to an ephemeral port (`server.listen(0)`) so parallel
  test files never collide on a fixed port.
- **First-run golden generation:** when a golden file doesn't exist yet for a
  new scenario, the test should fail loudly with a clear message rather than
  silently writing one — golden files get created deliberately by a human
  reviewing real output once, then checking it in, not auto-generated by a
  passing test run. A `UPDATE_GOLDEN=1` env var convention (common in this
  kind of testing) is fine if you want a controlled regeneration path, but
  default behavior must be "compare and fail," never "write and pass."
- **Directory-independent assertions:** don't assert on the absolute
  `outputDir` path itself (it'll differ per machine/CI run) — assert on file
  _contents_ read from whatever `TreelineCrawlSummary.outputDir` the run
  actually returned, same as existing tests already do.

## Session split

1. **Step 0 investigation + minimal `test.yml`** running only the _existing_
   test suite (no new golden tests yet) — get today's real, already-written
   tests green in CI first. This isolates "did CI infrastructure work" from
   "did new golden tests find a real bug," same separation-of-concerns
   discipline the rest of this codebase already follows (mechanism-fixture
   first, real-target/real-environment second).
2. **`static-site` fixture + golden files + the normalization helper.** Get
   the comparison mechanism itself proven correct on the simplest case
   before adding complexity.
3. **`form-and-api` and `duplicate-destinations` fixtures**, extending golden
   coverage. If `duplicate-destinations` turns up anything _beyond_ the
   already-documented naming limitation (a crash, a truly wrong selector, not
   just an undifferentiated name), stop and flag it — that would be a new
   finding, not the expected case this fixture is built to lock in.
4. **Confirm the new golden tests run under the `test.yml` workflow from step
   1 with no additional wiring** — they should, as ordinary `*.test.ts` files
   under `packages/cli`, but verify for real rather than assuming.

## Verification requirement

Don't call this done on "passes locally." Push a real branch, open a real PR
(or trigger the workflow directly), and confirm `test.yml` actually goes
green in GitHub's own UI — same "verified against real crawls," not just
fixtures, discipline CONTEXT.md applies to every other feature in this
codebase, applied here to CI itself rather than to a crawl target.

## Open items carried forward (not this session's job, noted so they aren't lost)

- AI-interpretation-path golden coverage, deferred pending a decision on how
  to mock the Anthropic SDK boundary deterministically.
- `@treeline/pages` (GitHub Pages rendering) golden coverage.
- `DomInteractiveElement.href` capture — shared open item with
  `VERIFY-BUILDOUT.md`; would also let `duplicate-destinations`-style
  fixtures assert on true destination correctness, not just selector
  disambiguation.
- Whether `packages/verify`'s fixture-tested (non-live) suite from
  `VERIFY-BUILDOUT.md` step 1 should also run under this session's new
  `test.yml` — reasonable, but decide after both sessions exist rather than
  guessing at `packages/verify`'s test-script shape here before it's built.
