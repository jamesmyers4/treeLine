# API-REPORT-BUILDOUT.md

_Session brief for Claude Code. Companion to CONTEXT.md, CLAUDE.md, and
API-CAPTURE-BUILDOUT.md — that file is **closed but stays on disk
permanently**, same as every other session brief in this repo. "Closed"
means stop treating it as a live spec to edit or extend, nothing more —
it does not mean archive it, remove it, or otherwise take it off disk. Read
it first for exact field names: `NetworkEntry` gained `requestBody`,
`requestHeaderNames`, `queryParams`, `requiresAuth`, `responseBodySchema` in
that session, all already persisted, all already verified against a real
OpenEMR target. This file governs the follow-on task that brief explicitly
deferred: turning that captured data into a rendered report. Same
grill-then-lock discipline — treat every "recommend"/"default" below as
locked unless reopened by the repo owner._

## Purpose

The capture-layer session left rich data sitting in persisted `NetworkEntry`
rows with nothing rendering it. This session closes that gap: a new report,
`api-test-scaffold.md`, giving a human enough to actually write API tests
against — endpoint, method, auth requirement, request shape, response shape
— plus a clearly-labeled, low-confidence DB schema-hint section derived from
field names already captured, not newly introspected.

## Explicit non-goals for this pass

- **No API test codegen.** Still true, still deferred — same reasoning as
  the capture brief: prove the report is useful before generating from it.
- **No new capture-layer work.** Everything this report needs already
  exists on `NetworkEntry`. If something turns out to be missing, that's a
  finding to report back, not a reason to quietly add capture code here —
  this session reads persisted data, it doesn't gather more of it.
- **No changes to `flow-map.md` or `ApiSurfaceEntry`.** This is a new,
  separate report. Locked in the capture brief, restated here so it isn't
  relitigated.

## Locked decisions

1. **Per-endpoint sections, not a table.** `flow-map.md`'s API Surface
   table already hit an overflow problem (session 38) with far fewer
   columns than this needs — query params, header names, request fields,
   response schema, and auth flag together are unreadable as a single table
   row. One heading per unique endpoint (`method` + path), fields listed
   underneath.
2. **Conditional generation, no new file when there's nothing to say.**
   Only write `api-test-scaffold.md` if the crawl had
   `--capture-request-bodies` and/or `--capture-response-bodies` set. If
   neither was on, skip writing the file entirely — don't emit an empty or
   near-empty report. This is the first report in the pipeline that
   wouldn't always have something to render; treat that as a real
   condition, not an edge case to paper over.
3. **DB schema-hint section included**, clearly labeled "possible schema
   hints — inferred, unverified" per decision #7 of the capture brief.
   Scope expanded from that decision's original wording (response field
   names only) to **both request and response field names, deduplicated
   per endpoint** — a POST field actually being written is at least as
   strong a schema signal as a GET field being read, and both are now
   captured. Flagging this expansion explicitly since it wasn't the
   original scope; narrow it back to response-only in one edit if you'd
   rather keep it conservative.
4. **No new CLI flag.** Ties directly to #2 — this report is not
   independently toggleable, it renders (or doesn't) based on whether the
   underlying data exists, using the same two flags already threaded in the
   capture session. Adding a third flag here would let someone request a
   report with nothing behind it.
5. **Small explicit mapping step, not inline rendering off `NetworkEntry`.**
   New type, `ApiTestScaffoldEntry`, built by a dedicated function from
   `NetworkEntry[]`, mirroring however `ApiSurfaceEntry` is actually built
   today for `flow-map.md` — **Step 0: confirm that build step is already a
   separate function before assuming it's a pattern to mirror; if it's
   inline in `flow-map.ts`, mirror the _intent_ (renderer stays dumb, all
   NetworkEntry-shape-knowledge lives in one mapping function) rather than
   copying inline code.** Renderer takes `ApiTestScaffoldEntry[]`, never
   reaches into `NetworkEntry` fields directly.
6. **Partial-data rendering, not silent omission.** When only one of the
   two capture flags was on, render whatever sections have data and
   explicitly label the missing ones — e.g. "response schema not captured
   this crawl (`--capture-response-bodies` was off)" — rather than leaving
   a blank line or dropping the endpoint. A report that looks incomplete
   without saying why reads as broken, not as working correctly on partial
   input.
7. **Distinguish "not applicable" from "not captured."** Verification of
   the capture session found `requestBody` returns `null` for two different
   reasons: the flag was off, or the request was `multipart/form-data`
   (null by design, unrelated to the flag). The report must render these
   differently — something like "not applicable (multipart/form-data)" vs.
   "not captured (`--capture-request-bodies` was off)" — not the same blank
   value for both. This is a real distinction already proven to exist
   against a real target; losing it in rendering would be a regression in
   usefulness, not a simplification.

## Mechanics

- **`ApiTestScaffoldEntry` shape** (draft — confirm against actual
  `NetworkEntry` field names in `API-CAPTURE-BUILDOUT.md` / the real type
  before implementing): `endpoint` (method + path, no query string),
  `queryParams`, `requiresAuth`, `requestFields` (names only, tagged
  not-applicable/not-captured per #7), `responseSchema` (the
  `{field: type}` summary, same not-captured distinction if
  `--capture-response-bodies` was off), `schemaHints` (deduplicated field
  names from both request and response, per #3).
- **Dedup at the report level**, not by re-deriving from raw
  `NetworkEntry` rows — the same `${method} ${url}` key already used for
  sampling dedup in the capture session is the right key here too, for
  consistency with how the rest of the pipeline already thinks about
  "one entry per unique endpoint."
- **The DB schema-hint section requires no new derivation logic** — it's
  a relabeling of field names already sitting on `requestBody` and
  `responseBodySchema`. If this session's mapping function is doing
  anything more complex than collecting and deduplicating strings for
  this section, that's scope creep past what was asked for.
- **Step 0 before writing any orchestration code:** find where the
  existing reports (`flow-map.md` and others) actually get decided-and-written after a crawl completes — which file holds that list, and whether it's in `packages/cli` or `packages/core`. The capture brief's session
  split didn't need this because it added no report; this one does.
  Confirm the real location before adding conditional logic to it, don't
  assume based on package boundaries alone.

## Persistence

None. This session reads already-persisted `NetworkEntry` data — no schema
changes, no migration, no new columns. If implementation reveals a gap
(some field the report needs isn't actually persisted the way
API-CAPTURE-BUILDOUT.md describes), that's a finding to report back before
proceeding, not something to patch silently in this session.

## Session split

1. **`packages/output`** — new file (likely
   `packages/output/src/api-test-scaffold.ts`, matching whatever the
   existing `flow-map.ts` convention is for co-locating builder + renderer,
   confirmed via the Step 0 above), containing the `ApiTestScaffoldEntry`
   type, the mapping function, the markdown renderer including the
   schema-hint section, and fixture tests using synthetic `NetworkEntry`
   objects — including explicit test cases for #6 (partial-flag rendering)
   and #7 (multipart-null vs. flag-off-null) since both are easy to get
   silently wrong and both are proven-real cases now, not hypotheticals.
2. **Report orchestration wiring** (location per Step 0 above) — the
   conditional gate from decision #2: call the new report writer only if
   `captureRequestBodies` or `captureResponseBodies` was true for the
   crawl's `CrawlConfig`.

## Verification requirement

Same disposable OpenEMR target used for the capture session
(`docker compose down -v && up -d` after, same as every prior session).
Confirm, against real crawl output, not just fixtures:

- Both flags on → full report renders, including populated schema hints
  from the real `authUser`/`clearPass`/`messages.php`/`patient_tracker.php`
  endpoints already proven to capture correctly.
- Only one flag on → report renders with the other section correctly
  labeled "not captured," not blank.
- Neither flag on → `api-test-scaffold.md` is not written at all, and
  nothing else in the crawl's output changes.
- A multipart endpoint renders "not applicable," not "not captured," even
  when `--capture-request-bodies` was on for that crawl.

## Open items carried forward

- API test codegen from this report — still deferred, no session planned
  yet.
- Whether the DB schema-hint section's scope (#3, request+response
  combined) turns out to be too broad or too noisy in practice on a real
  report — worth a second look once you can actually read a rendered
  `api-test-scaffold.md` against OpenEMR, not something to pre-judge here.

## Before closing this session out

Same doc-update expectations as every session in this repo — CONTEXT.md
entry with any deviation called out honestly, CLAUDE.md gotchas if a real
bug surfaced, README.md only if something user-facing changed.

Once implemented, this file — like every session brief in this repo,
including API-CAPTURE-BUILDOUT.md — moves from "live spec" to "historical
record." That means stop editing it to reflect new decisions; it does
**not** mean delete it, move it out of the repo, or treat it as disposable.
It stays on disk exactly where it is, permanently, as the record of what was
decided and why — same role CONTEXT.md's older session entries already
play. If a later session needs to change something this file locked, that
change gets recorded in CONTEXT.md's own dated entry, not by editing or
removing this file.
