# HANDOFF.md — treeline

_Written after sessions 1 through 15, for a fresh Claude Code session (or a
new chat with Claude) picking this project up with no memory of how it got
here. This file is transitional — once form/flow map is done, fold
anything still relevant into `CONTEXT.md` and delete this file._

## Read these two files first, in full

1. `CONTEXT.md` — what treeline is, its architecture, and a "Status" section
   listing exactly what's built/verified vs. remaining.
2. `CLAUDE.md` — conventions, commands, and a set of hard-won operational
   gotchas from the actual build. Read the "Do not" section especially —
   several of those are real mistakes that already happened once and got
   fixed; reintroducing them would be a regression, not a fresh idea.

Both files were rewritten alongside this handoff (session 15) to reflect
reality, not the original plan — trust them over any older memory of this
project you might have.

## Verify the repo is actually in the state described, before doing anything

Don't assume — confirm. Run, in order:

```
pnpm install
pnpm --filter @treeline/acquire build && pnpm --filter @treeline/acquire test
pnpm --filter @treeline/core build && pnpm --filter @treeline/core test
pnpm --filter @treeline/interpret build && pnpm --filter @treeline/interpret test
pnpm --filter @treeline/output build && pnpm --filter @treeline/output test
pnpm --filter @treeline/cli build && pnpm --filter @treeline/cli test
```

All five should build and pass cleanly. If `packages/cli`'s test run shows a
wall of unrelated failures importing `@playwright/test`, check that
`packages/cli/vitest.config.ts` exists and excludes `treeline-output/**` —
see CLAUDE.md's "Operational gotchas."

Then confirm the real end-to-end crawl command still works:

```
cd packages/cli
echo $ANTHROPIC_API_KEY
```

If that's blank, set it (`export ANTHROPIC_API_KEY=sk-ant-...`) before the
next command, or add `--skip-interpretation` to run for free without it.

```
pnpm exec tsx src/index.ts crawl https://example.com --max-pages 2 --output treeline-output/handoff-verify
```

Should complete with a summary showing pages captured, POMs/specs generated,
and (if interpretation wasn't skipped) an axe violations/needs-review count.
Check `treeline-output/handoff-verify/reports/` for all four base report
files: `selector-report.md`, `testid-audit.md`, `atlas.md`, `axe-report.md`.

Then confirm diff mode still works — run a second small crawl into a
different `--output` path, then:

```
pnpm exec tsx src/index.ts diff treeline-output/handoff-verify treeline-output/handoff-verify-2
```

Should write `reports/diff-report.md` into the second directory and print a
summary of pages added/removed, title changes, and selector regressions/
improvements/other. Try it once with `--fail-on-regression` too and confirm
with `echo $?` that the exit code behaves as documented in CLAUDE.md.

If any of this doesn't match what CONTEXT.md's "Status" section claims,
stop and figure out why before writing new code — something regressed.

## What's actually done (see CONTEXT.md "Status" for full detail)

Crawler, hardened capture (DOM ground truth + axe-core), 2-tier AI
interpretation with retry, four base reports (selector stability, testid
audit, atlas, axe accessibility), POM + spec generation, full CLI wiring,
`hard-pages/` escalation — all built, tested, and verified against real
crawls of a real site (goldenpetbrands.com).

**Diff mode (sessions 11-14) — also done.** Page-level diff (pages added/
removed, title changes), selector-candidate regression detection (each
element's top-ranked candidate compared across two runs, classified as
regression/improvement/other based on whether it crosses the
`stable && uniqueOnPage` safe-to-bake-in line), a markdown report with
regressions surfaced first, and `treeline diff <baselineDir> <currentDir>
[--output dir] [--fail-on-regression]` wired into the CLI. Along the way,
`computeSelectorCandidates` was moved from `packages/output` into
`packages/core` (`selector-candidates.ts`) since core had no dependency on
output — same shape as the existing `StoredInterpretation`/
`PageInterpretation` split, see CLAUDE.md. All verified against real
crawls, including `echo $?` exit-code checks for both `--fail-on-regression`
states.

## What's left

From the original v1 output list, one item remains:

- **Form & flow map** — every form, its fields, validation, submit target.
  This needs new capture data (forms aren't currently captured as a
  grouped structure — `DomInteractiveElement` captures individual
  `input`/`select`/`textarea` elements, but not which `<form>` they belong
  to, validation attributes like `required`/`pattern`, or the form's
  `action`/`method`). Follow the same pattern that worked well for
  axe-core: capture in `packages/acquire` + persist in `packages/core`
  first (own session, own manual sanity check against a real site with an
  actual form), then render in `packages/output` (second session).
- **Network/API report** — decided, no longer open: folds into flow map's
  "API surface" angle rather than becoming its own standalone report. The
  raw data (`PageState.networkLog`) has existed since session 1 and is
  already persisted; flow map's output session should render it alongside
  form submit targets rather than treeline gaining a separate report
  generator for it.

## How work has actually happened in this repo (keep doing this)

Small, single-package-scoped Claude Code sessions, each with a detailed,
explicit prompt (types spelled out field-by-field, exact function
signatures, exact test cases to write) rather than open-ended asks. After
any session whose output feeds a later one, a manual sanity check — a
throwaway script run against a real crawl, read by a human, then deleted —
before trusting it and building further. This caught real bugs multiple
separate times that unit tests alone missed, most recently the
core/output dependency-direction issue during diff mode (see CLAUDE.md's
"Do not" section for the full list). Don't skip the manual check step to
save time; it's been the single highest-value habit in this build.

## Known rough edges (not blockers, just worth knowing)

See CONTEXT.md's "Open items" section for the full list — accessible-name
computation gaps, POM property naming for same-text/different-destination
links, axe report's single-example limitation, atlas's skipped-vs-failed
ambiguity. None of these are broken, they're just less complete than they
could be. Don't "fix" any of them as a surprise side effect of unrelated
work — if one becomes worth addressing, treat it as its own small, scoped
session like everything else.
