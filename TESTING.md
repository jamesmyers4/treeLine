# TESTING.md — treeline

_Written at the end of the `VERIFY-BUILDOUT.md` session (session 57);
updated at the end of the `GOLDEN-MASTER-BUILDOUT.md` session (session 58)
to reflect CI and golden-master tests landing. Read `CONTEXT.md` and
`CLAUDE.md` first — this file is a snapshot of where testing actually
stands, not a design doc. It will go stale; trust `pnpm -r test` and this
file's own "how to reproduce" commands over its prose if they ever
disagree._

## What exists today

Three layers of testing, doing three different jobs:

1. **Unit/fixture tests, one `vitest` suite per package, run locally and in
   CI.** These are real — they launch real browsers against real local
   fixture servers (`node:http`/Fastify), not mocks of Playwright.
   `.github/workflows/test.yml` (session 58) now runs `pnpm -r test` on
   every push/PR to `main`.
2. **Golden-master pipeline tests, `packages/cli/test/`** (session 58) —
   three real end-to-end crawls against real local fixture servers, each
   compared byte-for-byte (after normalizing known-nondeterministic
   values) against checked-in golden output. Catches real-output
   regressions unit tests miss by construction, since a unit test only
   proves an individual function's isolated behavior. See below.
3. **`packages/verify`, an independent, manual/on-demand tool** (session 57)
   that logs into a real, live authenticated target and confirms real
   navigation destinations against a human-supplied expectation. Not a
   `vitest` suite, not CI-gated, not wired into `crawl` or `diff` — a
   standalone verification instrument, same posture as authenticated
   crawling itself.

## Per-package unit/fixture test status (confirmed this session)

Ran `pnpm --filter @treeline/<pkg> build && pnpm --filter @treeline/<pkg>
test` for all seven packages, in dependency order, right before writing this
file. All green:

| Package | Test files | Tests | Notes |
| --- | --- | --- | --- |
| `@treeline/acquire` | 8 | 70 | Real browsers, real local fixture servers |
| `@treeline/core` | 9 | 82 | Includes crawler + authenticated-crawling suites |
| `@treeline/interpret` | 3 | 40 | Mocked Anthropic SDK boundary (real API calls aren't run) |
| `@treeline/output` | 15 | 187 | Includes `injection-safety`-style escaping tests |
| `@treeline/pages` | 5 | 21 | GitHub Pages HTML rendering |
| `@treeline/cli` | 5 | 29 | Full pipeline via `runTreelineCrawl`, real local fixtures, incl. 3 golden-master scenarios (session 58) |
| `@treeline/verify` | 1 | 2 | Built session 57 — see below |
| **Total** | **46** | **431** | |

Reproduce with the exact sequence `CLAUDE.md`'s "Verify the repo is
actually in the state described" section already documents:

```
pnpm install
pnpm --filter @treeline/acquire build && pnpm --filter @treeline/acquire test
pnpm --filter @treeline/core build && pnpm --filter @treeline/core test
pnpm --filter @treeline/interpret build && pnpm --filter @treeline/interpret test
pnpm --filter @treeline/output build && pnpm --filter @treeline/output test
pnpm --filter @treeline/pages build && pnpm --filter @treeline/pages test
pnpm --filter @treeline/cli build && pnpm --filter @treeline/cli test
pnpm --filter @treeline/verify build && pnpm --filter @treeline/verify test
```

## `packages/verify` — what it is and what it proved

Built per `VERIFY-BUILDOUT.md` (full locked-decision brief there; this
section is the outcome summary, not a re-derivation of the design).

**Mechanism, fixture-proven (`packages/verify/src/verify.test.ts`, 2 tests,
against a local `node:http` fixture server with real login + real nav
links):**
- A nav link whose visible label leads somewhere different than its
  supplied `expectedUrl` is correctly flagged `mismatch` — with a
  screenshot written to `verify-mismatches/`.
- A genuinely matching nav link is correctly reported `match`, proving the
  mechanism doesn't false-positive.
- A nav item rendered as a plain, role-less `<div>` (not a real `<a>`/ARIA
  button) is still clicked correctly via the tool's CSS-text fallback,
  proving the mechanism isn't limited to semantically-correct markup —
  which turned out to matter immediately against the real target below.
- An entry with a `precondition` note is correctly skipped (never clicked)
  and surfaced in its own report section rather than silently dropped or
  forced into a false pass/fail.

**Real run, against a live, disposable OpenEMR container
(`OPENEMR-QA/docker`), reproduced twice with identical results:**

```
13 entries checked: 6 match, 1 mismatch, 1 skipped, 5 error.
```

Full table, screenshots, and prose findings:
`treeline-output/openemr-verify/verify-report.md` (gitignored, same as
every other `treeline-output/` crawl artifact — reproduce with the command
below rather than expecting it checked in).

**The actual motivating question — is "Fees > Payment" a treeLine defect —
is answered: no.** `OPENEMR-QA/CONTEXT.md` flagged that treeLine's
authenticated crawl recorded `interface/billing/new_payment.php` for the
"Fees > Payment" workflow, when the real top-nav lands on
`interface/patient_file/front_payment.php`. Confirmed via both OpenEMR's
own `window.menu_objects` client-side navigation data and a real live
click-through (real patient, real today's encounter) that
`new_payment.php` is not orphaned or fabricated — it's the correct,
real destination of a different, adjacent top-nav item, `Fees > Batch
Payments`. This is a one-off mislabeling in the manual seed-list-building
process session 53 already documents as a workaround done *outside*
treeLine, not a treeLine code defect, and not a systematic pattern (twelve
other logical-label-to-URL pairs from that same crawl all check out).
**No code fix was made or was needed** — see `VERIFY-BUILDOUT.md`'s own
non-goals section, which explicitly names this as a valid outcome.

**Two real problems found and fixed along the way, both generalizable
beyond OpenEMR** (full detail in CONTEXT.md's "Nav-map verification"
section):
- `performLogin` + a fresh `browser.newContext({storageState})` — the
  pattern `VERIFY-BUILDOUT.md` originally specified — cannot reach a
  target gated by a per-login URL nonce (`token_main`), even with a
  genuinely valid session. Fixed with a new, additive
  `performLoginSession` export in `packages/acquire/src/auth.ts` that
  keeps its login context/page open rather than closing it.
- A pure `getByRole('link' | 'button', ...)` click strategy silently
  fails against menu items with no real ARIA role (most of OpenEMR's own
  submenu items). Fixed with a generic `:text-is(...):visible` CSS
  fallback, applying this repo's own locator-ranking convention one rung
  further than the original brief assumed necessary.
- A smaller fix: `sanitizeMarkdownTableCell` existed in
  `packages/output/src/markdown-safety.ts` since session 43 but was never
  re-exported from `@treeline/output`'s `index.ts` — `VERIFY-BUILDOUT.md`
  assumed it was already exported and told Step 0 to confirm rather than
  assume. Confirmed false, fixed with one export line.

**Two real findings left open, not root-caused this session** (documented
plainly rather than silently smoothed over, matching this repo's existing
"know when to stop" discipline for OpenEMR's template-diverse admin
surface): `Fees > Posting Payments` lands on a help-documentation page
instead of its real destination; `Admin > Config` and every `Admin > System
> *` entry after it in the same run failed, despite each working correctly
when retried in isolation. See `verify-report.md`'s own "Findings" section
for the full writeup.

**Reproduce the real run** (needs a live, disposable OpenEMR container —
credentials never touch a CLI flag, only `TREELINE_LOGIN_PASSWORD`):

```
cd OPENEMR-QA/docker && docker compose up -d
# wait for the openemr service to report healthy (first boot: several minutes)
cd ../../treeLine
export TREELINE_LOGIN_PASSWORD=pass
pnpm --filter @treeline/verify verify -- \
  treeline-output/openemr-verify/nav-map.json \
  --base-url "https://localhost:9300/interface/main/tabs/main.php" \
  --login-url "https://localhost:9300/interface/login/login.php" \
  --username admin \
  --success-indicator '[data-bind*="logout"], [onsubmit*="restoreSession"], [onclick*="restoreSession"], input[type=hidden][name*=csrf i]' \
  --dismiss-selector "text=Ask again later" \
  --insecure-certs \
  --output treeline-output/openemr-verify
cd OPENEMR-QA/docker && docker compose down -v
```

## Golden-master pipeline tests and CI (session 58, `GOLDEN-MASTER-BUILDOUT.md`)

Both items this file previously listed under "What's missing" are now
built.

- **`.github/workflows/test.yml`** — new, separate from `crawl.yml`.
  Triggers on `push`/`pull_request` targeting `main`, runs `pnpm -r test`
  under Xvfb with a cached Playwright chromium install, mirroring
  `crawl.yml`'s existing browser/display setup. Step 0 confirmed this is
  necessary, not assumed: `launchHardened` (`packages/acquire/src/
launch.ts`) hardcodes `headless: false` for the non-stealth path with no
  test-time override, and no fixture test anywhere in the workspace sets
  `stealth: true`, so every real-browser test — not just `crawl` — needs a
  display. A single `playwright install --with-deps chromium` covers both
  `@treeline/acquire` and `@treeline/verify` (confirmed via `pnpm-lock.yaml`:
  both resolve the same `playwright@1.61.1`). Patchright's `channel:
'chrome'` path is never exercised by any test, so no separate browser
  install is needed for it.
- **Golden-master fixture tests, `packages/cli/test/`** — three locked
  scenarios (`static-site`, `form-and-api`, `duplicate-destinations`),
  each with a real `node:http` fixture server, driven through
  `runTreelineCrawl` directly (same pattern as `orchestrate.test.ts`), with
  checked-in golden files under `test/golden/<scenario>/` compared via a
  shared `test/normalize-golden.ts` helper.
  - **A real nondeterminism found beyond the brief's own named list:**
    every fixture server binds `server.listen(0, ...)` for a random
    ephemeral port (deliberately, so parallel test files never collide on
    a fixed port — same reasoning `orchestrate.test.ts` already
    established). That port number lands in every report table, every POM
    locator's `goto()` call, and every spec's `toHaveURL` assertion — an
    exact-match comparison without normalizing it would never pass twice
    in a row. Fixed by adding an `https?://127\.0\.0\.1:\d+` → `<BASE_URL>`
    replacement to `normalizeGoldenContent`, alongside the brief's own
    named timestamp (`Generated: <ISO>` → `<TIMESTAMP>`) and
    `pageLoadMs`/`durationMs`/`appearedAtMs` table-cell normalizations.
    Verified for real, not assumed: ran each golden test twice back to
    back and confirmed a pass both times despite a different real port
    each run.
  - **A second real bug found by actually running the full `@treeline/cli`
    suite together, not just the three new files in isolation:** the
    checked-in golden `specs/*.spec.ts` files (real generated Playwright
    spec code, same as `treeline-output/**`'s generated specs) got picked
    up by vitest's own default test-file glob and failed importing
    `@playwright/test` — the exact class of bug this file's sibling
    section already documents `treeline-output/**`'s exclusion for.
    Fixed the same way: `packages/cli/vitest.config.ts`'s `exclude` array
    gained `'test/golden/**'` alongside the existing `'treeline-output/**'`
    entry.
  - **Mismatch detection and first-run-failure behavior both verified for
    real, not just asserted correct by construction:** deliberately
    corrupted a checked-in golden file's content and confirmed a real,
    informative line-level diff (plus full normalized before/after) rather
    than a silent pass; deliberately renamed a golden directory away and
    confirmed a clear "no golden file, run with `UPDATE_GOLDEN=1`" failure
    rather than an auto-write. Both restored before proceeding.
  - **Report scope deliberately narrower than "every report," matching the
    brief's own per-scenario list rather than the full nine-report set:**
    `static-site` compares `atlas.md`/`selector-report.md`/
    `testid-audit.md`/`coverage-report.md` plus every POM/spec file;
    `form-and-api` compares `flow-map.md` plus POM/spec files;
    `duplicate-destinations` compares `selector-report.md` plus POM/spec
    files. `axe-report.md`, `color-report.md`, and `timing-report.md` were
    deliberately left out of exact-match comparison — all three depend on
    real browser rendering (accessibility-tree computation, computed
    style, paint timing) that golden files generated once on one OS/GPU
    combination have no guarantee of reproducing byte-for-byte on a
    different one (these goldens were generated on Windows locally; CI
    runs Ubuntu). The four report types actually compared are pure DOM/
    accessibility-tree structural output with no visual-rendering
    dependency, matching what the brief named per scenario.
- **Reproduce:** `pnpm --filter @treeline/cli test` (or `pnpm -r test` for
  the whole workspace) runs the three new golden files automatically,
  alongside every existing suite, with no additional wiring — confirmed by
  running the full `@treeline/cli` suite (not just the three new files)
  and the full workspace `pnpm -r test` after the fix above.

## What's missing (known, not this session's job)

- **`packages/verify` is not CI-gated and not expected to become so** — it
  needs live Docker plus real credentials, same explicit non-goal
  authenticated crawling itself already has. Manual/on-demand by design,
  not a gap to close.
- **`packages/verify`'s two open real findings** (help-page redirect on
  `Fees > Posting Payments`; multi-entry state accumulation across `Admin >
  System > *`) are real, reproducible, and undiagnosed. Worth investigating
  if this tool sees continued real use, not blocking anything today.
