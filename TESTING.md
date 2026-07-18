# TESTING.md — treeline

_Written at the end of the `VERIFY-BUILDOUT.md` session (session 57). Read
`CONTEXT.md` and `CLAUDE.md` first — this file is a snapshot of where
testing actually stands, not a design doc. It will go stale; trust `pnpm -r
test` and this file's own "how to reproduce" commands over its prose if
they ever disagree._

## What exists today

Two layers of testing, doing two different jobs:

1. **Unit/fixture tests, one `vitest` suite per package, run locally on
   demand.** These are real — they launch real browsers against real local
   fixture servers (`node:http`/Fastify), not mocks of Playwright. Nothing
   in CI runs them yet; see "What's missing" below.
2. **`packages/verify`, a new, independent, manual/on-demand tool** (this
   session's deliverable) that logs into a real, live authenticated target
   and confirms real navigation destinations against a human-supplied
   expectation. Not a `vitest` suite, not CI-gated, not wired into `crawl`
   or `diff` — a standalone verification instrument, same posture as
   authenticated crawling itself.

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
| `@treeline/cli` | 2 | 26 | Full pipeline via `runTreelineCrawl`, real local fixtures |
| `@treeline/verify` | 1 | 2 | New this session — see below |
| **Total** | **43** | **428** | |

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

## What's missing (known, not this session's job)

- **No CI workflow runs any test suite at all yet.** `.github/workflows/
crawl.yml` is `workflow_dispatch`-only; nothing runs `pnpm -r test` on push
  or pull request. This is exactly `GOLDEN-MASTER-BUILDOUT.md`'s item 1 —
  a separate, independent session track, not started by this session, not
  blocked by it either.
- **No golden-master pipeline tests** — nothing asserts a full `treeline
  crawl` run's actual generated output (reports, POMs, specs) against a
  known-correct baseline; only that individual functions behave correctly
  in isolation and that a real crawl doesn't crash. This is
  `GOLDEN-MASTER-BUILDOUT.md`'s item 2, same status as above.
- **`packages/verify` is not CI-gated and not expected to become so** — it
  needs live Docker plus real credentials, same explicit non-goal
  authenticated crawling itself already has. Manual/on-demand by design,
  not a gap to close.
- **`packages/verify`'s two open real findings** (help-page redirect on
  `Fees > Posting Payments`; multi-entry state accumulation across `Admin >
  System > *`) are real, reproducible, and undiagnosed. Worth investigating
  if this tool sees continued real use, not blocking anything today.
