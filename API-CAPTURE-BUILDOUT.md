# API-CAPTURE-BUILDOUT.md

_Session brief for Claude Code. Companion to CONTEXT.md and CLAUDE.md — does
not replace either. Written before any code exists for this feature; treat
every "recommend"/"default" below as locked unless explicitly reopened by the
repo owner. Mirrors the grill-then-lock discipline CONTEXT.md's "Authenticated
crawling" section already used — read that section first if unfamiliar with
the pattern this repo expects._

## Purpose

UI capture (`interactiveElements`, POM generation, selector reports) is rich.
API capture is thin: `NetworkEntry` today is `url`, `method`, `status`,
`resourceType`, `durationMs`, plus session 47/47b's opt-in JSON response-body
sampling. That's enough to know an endpoint exists, not enough to scaffold a
real API test against it — no request body, no headers, no query-param
structure, no response shape summary, no signal on whether the endpoint
needed an authenticated session.

This session closes that gap **on the capture side only.** No new report, no
codegen. See "Explicit non-goals" below — this is deliberate, not deferred by
accident.

## Explicit non-goals for this pass

- **No new report.** `api-test-scaffold.md` (or whatever it ends up named) is
  a follow-on task. This session's output is richer persisted data, nothing
  rendered.
- **No API test codegen.** Not even a skeleton, unlike POM generation's
  `generateSpec`. That's a separate future session, same relationship
  session 42's form-fill proposals had to POM generation — capture first,
  prove the data's good, generate from it later.
- **No DB introspection of any kind.** Architecturally impossible from a
  browser-based crawler — Playwright sees only what crosses the
  browser↔server network boundary, never server-internal DB calls. A later
  follow-on task can derive "possible schema hints" from response body field
  names once those are captured, clearly labeled as inference, not fact —
  not this session's job.
- **Does not touch the session-53 GET-mutation risk.** That's about which
  requests happen during a crawl (unmitigated, still open). This session is
  about capturing more detail on requests that were already going to happen
  regardless. Don't conflate the two in review — richer capture here doesn't
  make that risk better or worse.

## Locked decisions

1. **Two independent CLI flags**, not one shared with response-body capture:
   `--capture-request-bodies` (new) alongside the existing
   `--capture-response-bodies` (session 47). A crawl may want one without the
   other — a POST payload and a GET response carry different risk profiles,
   especially on a target with real patient data.
2. **Request headers: names only, for every header, no exceptions.**
   `requestHeaderNames: string[]` never carries a value for any header —
   not just the sensitive ones. There is no flag or future path in this
   design that elevates any header to value-capture; if that's ever wanted
   it's a new, separate decision, not an extension of this one. The
   sensitive names called out below (`Authorization`, `Cookie`,
   `Set-Cookie`, `X-CSRF-Token`, and anything matching a case-insensitive
   `token|secret|auth|key` substring) aren't a special case of this rule —
   they're a reminder of _why_ it's names-only-always, not a shorter list
   that implies other headers are treated differently. This mirrors the
   auth-crawling design's "credentials never persisted, structurally, not
   by remembering to scrub" posture — same technique, applied to a new
   surface.
3. **Extend `NetworkEntry` directly** — new fields `requestBody`,
   `requestHeaderNames: string[]`, `queryParams: Record<string, string>`,
   `requiresAuth: boolean`. Do not create a parallel structure; everything
   already correlates by the existing per-request record.
4. **Response schema summary lives alongside the existing raw sample**, not
   in place of it. Session 47's raw pretty-printed sample stays exactly as
   built. Add a shallow `{field: inferredType}` summary next to it on
   `ApiSurfaceEntry` — deterministic, no AI call, same posture as every other
   report field in this codebase that doesn't need model judgment.
5. **New report, not an extension of `flow-map.md`** — deferred to the
   follow-on task, but locking the decision now so nobody bolts this onto
   `flow-map.md`'s API Surface table later out of convenience. That table
   already hit an overflow bug once (session 38); don't set up a repeat.
6. **Opt-in, default `false`**, both new flags. Same posture as `--stealth`,
   `--capture-response-bodies`, `--detect-auth-wall` — every capture that can
   touch sensitive data earns a default-off flag in this codebase, no
   exceptions made here.
7. **DB-hint derivation is out of scope for this session** (see non-goals) —
   locking the _posture_ now so the follow-on task doesn't have to relitigate
   it: any future schema-hint output must be in a clearly-separated,
   explicitly-labeled "unverified, inferred" section — same discipline as
   `proposed-assertions.ts`'s success-assertion caveat comments.
8. **Capture-layer groundwork only this pass** — no report renderer, no
   `packages/output` changes at all. Follow-on task owns the report.

### Two additional decisions, resolved by default rather than a second grill round

- **Content-type scope: `application/json` AND
  `application/x-www-form-urlencoded`**, not JSON-only. Session 47's
  response-body precedent was JSON-only because that's what the API-surface
  use case needed. Request bodies are different — the actual motivating
  target (OpenEMR) is a traditional PHP app posting form-urlencoded almost
  everywhere; JSON-only would capture close to nothing useful there. Parse
  form-urlencoded via `URLSearchParams` into key-value pairs (values still
  subject to decision below); JSON as-is.
- **Request body _values_: field names only, values redacted by default.**
  Symmetric extension of the headers decision, not a new principle — a
  crawl against a clinical target can genuinely have a real patient's data
  typed into a form mid-crawl (incidental, not something treeLine
  solicits). Store the field name (`patientDOB`, `ssn`, `notes`, whatever
  the form actually uses) so a human writing API tests knows the payload
  shape, never the value. If real fixture data is later needed for actual
  test bodies, that's a human decision made outside this tool, same as
  session 42's proposed-assertion fill values are deliberately synthetic
  (`"Test User"`) rather than anything captured.

Both of these are easy to flip later (one field, one function) if you want
different defaults once you see real output — flagged here so they don't get
silently assumed permanent.

### Two clarifications added on review, not new decisions

- **`queryParams` needs no redaction logic of its own.** The full `url`
  (query string included, unredacted) is already captured and rendered
  today, unchanged by anything in this session. Parsing that same string
  into a `Record<string, string>` exposes nothing new — it's the same
  already-accepted baseline, restructured. Do not add key-based redaction
  to `queryParams` that doesn't exist for `url` itself; that would be
  inconsistent, not safer.
- **All redaction happens in `packages/acquire`, at capture time** — before
  a `NetworkEntry` is ever constructed, never as a render-time filter in
  `packages/output` or later. Same reasoning as the auth-crawling design's
  credential handling: a value that's structurally never captured can't
  leak from a report generator that forgets to filter it. If a future
  report renderer needs to double-check this, that's defense in depth, not
  where the actual guarantee lives.

## Mechanics

- **Request body capture is simpler than response-body capture, not the same
  shape.** Playwright's `request.postData()` / `request.postDataJSON()` are
  **synchronous**, unlike `response.text()` which needed session 47's whole
  `bodyReads` / `Promise.all`-gated async plumbing. Do not port that async
  pattern over unnecessarily — grab the body directly in the existing
  `page.on('request', ...)` handler, no new tracking array needed for this
  part specifically.
- **Reuse the existing `sampledEndpoints` dedup Set** (`${method} ${url}`,
  threaded from `crawler.ts` through `AcquireOptions`, session 47) for
  request-body sampling too, gated independently by the new flag so a
  response-body-only crawl doesn't also pull request bodies. One endpoint,
  sampled once per crawl, same discipline already proven — including the
  session 47b fix (mark sampled only after a conclusive read, not before, so
  a transient failure doesn't permanently lock an endpoint out).
- **Size cap:** new `MAX_REQUEST_BODY_BYTES` constant, own CLI override
  (`--max-request-body-bytes`, mirroring `--max-response-body-bytes`
  threading exactly: CLI flag → `CrawlConfig` → `crawler.ts` →
  `AcquireOptions` → `capture.ts` fallback constant). Don't assume the same
  default value as response bodies is right — check real request-body sizes
  against a real target the way session 47b's `curl` check against
  `/api/jobs` caught the wrong default before shipping it. Do that check
  here too, don't skip it because response-body capture already did the
  analogous work once.
- **`queryParams` decomposition:** parse via `new URL(url).searchParams` →
  plain object. Leave the existing raw `url` field completely unchanged —
  `naming.ts` and the dedup logic in flow-map both key off the exact string
  today; don't risk a silent behavior change to something that already
  works.
- **`requiresAuth` is page-level, not truly per-request.** Derived from
  whether `AcquireOptions.authSession` was set for the page's capture at
  all (session 50's threading), applied uniformly to every `NetworkEntry` captured during that page. This is a known simplification: a page loaded
  under an authenticated session could theoretically fire one genuinely
  public request alongside authenticated ones, and this won't distinguish
  them. Document this as a known limitation in code, same as the
  `accessibleName` heuristic gap is documented rather than silently
  shipped — don't try to solve per-request auth detection this session,
  it's not cheap and wasn't asked for.

## Persistence

**Step 0 before writing any persistence code:** confirm the actual current
storage shape of `networkLog` in `packages/core/src/persistence.ts`. CONTEXT.md
documents the pattern used for `forms`/`axeViolations`/`colorPalette` (JSON
TEXT column, `JSON.stringify`/`parse` round-trip) but doesn't state
`networkLog`'s column name explicitly — verify directly before assuming it
follows the identical pattern. If it does, this is additive (new keys inside
the same JSON blob, no migration). If it doesn't, that's a real finding worth
recording honestly rather than papering over with an assumption, same as this
repo's own convention throughout CONTEXT.md's "Step 0 investigation" callouts
(sessions 38, 47, 48 all do this before writing code).

Add round-trip persistence tests for the new fields, same shape as the
existing `forms persistence` / color-report round-trip blocks: non-empty case,
empty/redacted case, isolation across multiple page rows.

## Session split (recommended, mirrors this repo's own multi-package practice)

Per CLAUDE.md's own note that multi-package sessions are the highest-risk
ones on this build (stated directly in the auth-crawling section above):

1. **`packages/acquire`** — `NetworkEntry` type extension, request-body
   read (sync `postData()`/`postDataJSON()`), header-name-only capture with
   redaction list, query-param decomposition, `requiresAuth` tagging, local
   fixture tests (a small local server posting both JSON and
   form-urlencoded, same "can't induce this against a live site" principle
   used for every other capture-layer feature in this repo — visual diff,
   appearance latency, response-body capture, auth expiry).
2. **`packages/core`** — thread new `CrawlConfig` fields (`captureRequestBodies?: boolean`, `maxRequestBodyBytes?: number`) →
   `crawler.ts` → `AcquireOptions`. Persistence extension per the Step 0
   verification above. Round-trip tests.
3. **`packages/cli`** — `--capture-request-bodies`, `--max-request-body-bytes` flags, wiring, help text. `README.md`/`CLAUDE.md` update noting
   the new opt-in flags and their redaction posture, same as how
   `--capture-response-bodies` and `--detect-auth-wall` are already
   documented.

`packages/output` is untouched this pass — no session for it here, by design
(see non-goals).

## Verification requirement

Not done until verified against a real target that actually exercises this —
a fixture proves the mechanism works, not that the real data is useful.
Recommend the same disposable OpenEMR Docker instance already used for
session 53 (`docker compose down -v && up -d` afterward, same as that
session's own cleanup discipline) — it's a real target with real
form-urlencoded POSTs, which is exactly the case JSON-only capture would have
missed. Confirm:

- A real login POST and at least one real clinical-form POST both produce a
  correctly-redacted `NetworkEntry` (field names present, values absent).
- The `MAX_REQUEST_BODY_BYTES` default is checked against real captured
  sizes on this target before being treated as final, not assumed correct
  by analogy to the response-body cap.
- `requiresAuth` reads `true` on requests captured during the authenticated
  portion of a crawl and `false` (or absent, pre-login) otherwise.

Do not treat this feature as done on fixture tests alone — every other real
capture-layer feature in this codebase (timing, appearance latency, color,
response bodies, auth) was fixture-built then real-target-verified as a
separate, explicit step. Follow that same discipline here.

## Open items carried forward (not this session's job, noted so they aren't lost)

- The follow-on report (`api-test-scaffold.md`) and any DB schema-hint
  derivation — both explicitly deferred, see non-goals.
- Session-53's GET-mutation risk remains unmitigated — orthogonal to this
  work, not touched or worsened by it.
- Per-request (not page-level) `requiresAuth` granularity — known
  simplification, not solved here.

## Before closing this session out

Update the docs — this isn't optional bookkeeping, it's how every other
session in this repo stays honest about what was actually built vs. planned:

- **CONTEXT.md** — add a new dated/numbered entry under the relevant section
  (or a new section, if this is a new capability) describing what was
  actually built, same "verified against real crawls, not just fixtures"
  discipline the rest of the file uses. Explicitly call out any deviation
  from this brief's locked decisions — don't fold a deviation silently into
  the description as if it had been the plan all along (see "Session 52 —
  implementation notes" for the pattern). If nothing deviated, say so
  explicitly rather than leaving it unstated.
- **CLAUDE.md** — add an entry to "Operational gotchas" for any real bug
  found during implementation, not a hypothetical one — same bar as every
  existing entry: found against real data or a real target. If a genuinely
  new lesson about this codebase surfaced (a wrong assumption, a fixture
  that didn't catch something only a real build did), record it so it
  isn't rediscovered later.
- **README.md** — update only if something user-facing changed: a new CLI
  flag, a new report in the output list, a changed Quick Start command, a
  changed Status section. Skip if this was purely internal.
- **V2.md** — if this closes out or partially closes a roadmap item, mark
  it done/in-progress. If this was reactive work rather than a planned V2
  item, note that explicitly rather than retrofitting it into the roadmap.
- **This file** — once implemented, this brief is historical, not living
  documentation. Don't keep editing it after the fact; CONTEXT.md is the
  source of truth going forward.

Do not consider this session done until the above is actually written, not
just intended — a build that works but isn't reflected in CONTEXT.md is the
exact gap this project has already had to catch itself on before (the
`screenshot: null` placeholder documented as "captured" when it wasn't is the
clearest prior example — don't add a second one).
