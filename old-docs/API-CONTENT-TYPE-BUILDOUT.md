# API-CONTENT-TYPE-BUILDOUT.md

_Session brief for Claude Code. Companion to CONTEXT.md, CLAUDE.md,
API-CAPTURE-BUILDOUT.md, and API-REPORT-BUILDOUT.md — all three closed, all
three **stay on disk permanently**, same rule as last time: "closed" means
stop editing them to reflect new decisions, it does not mean archive, move,
or delete them. Read the capture brief first for exact `NetworkEntry` field
names and the report brief for how `api-test-scaffold.md` currently labels a
null request body. This file is a small, targeted follow-on to a specific
gap the report session found and documented honestly rather than papering
over: a flag-on-but-null request body currently can't be attributed to a
specific cause (multipart, unsupported content type, or oversized) — only to
"null." Same grill-then-lock discipline as every prior file — treat every
"recommend"/"default" below as locked unless reopened by the repo owner._

## Purpose

`NetworkEntry` has no content-type signal today. When `--capture-request-bodies`
is on and `requestBody` comes back null, the report session correctly
identified this as "not applicable" but couldn't say _why_ — multipart,
oversized, and any other unsupported content type all collapse into one
bucket. This session adds the two small, factual fields needed to tell them
apart, and updates the report to actually say which one applies.

## First: this does not reopen decision #2 from the capture brief

Decision #2 locked "headers: names only, for every header, no exceptions" —
no header value is ever persisted, full stop. This session is not an
exception to that and shouldn't be read as one. What's being added here is
not the `Content-Type` header's value — it's a small, closed-set **category**
(`'json' | 'form-urlencoded' | 'multipart' | 'other'`) computed by inspecting
that header once, at the same point `capture.ts` already inspects it today
to decide whether to attempt a body parse at all, and discarding the actual
string immediately. If this feels close to the line: it's intentionally
narrow and justified by that closed set being small and non-sensitive
(unlike `Authorization`/`Cookie`/tokens, `Content-Type` carries no PII or
credential risk) — not a precedent for capturing other header values later.
If you find yourself wanting to persist more than the category (e.g. a
`charset` suffix, a `boundary` value from multipart), that's out of scope
here and a new decision, not an extension of this one.

## Locked decisions

1. **Two new fields on `NetworkEntry`, not one combined status enum.**
   `requestBodyContentTypeCategory: 'json' | 'form-urlencoded' | 'multipart' | 'other' | null`
   and `requestBodyExceededSizeCap: boolean`. Keep `NetworkEntry` limited to
   factual, capture-time observations — "the flag was off" is already a
   report-layer concern derived from `CrawlConfig` (that's how "not
   captured" is produced today) and stays that way. Don't add a
   flag-awareness field to `NetworkEntry` itself.
2. **No new CLI flag.** Both fields are only populated when
   `--capture-request-bodies` is already on — this refines data already
   being inspected within that existing opt-in surface, it isn't a new
   surface that needs its own gate.
3. **The category set is closed and small.** Do not add finer-grained
   categories (e.g. `multipart/mixed` vs. `multipart/form-data`, or
   specific `'other'` subtypes) without a concrete reason grounded in
   something actually observed on a real target — same discipline used to
   justify every prior capture-layer format decision in this repo.
4. **The two fields are orthogonal and both required for a correct label.**
   A JSON or form-urlencoded body can be null purely from exceeding
   `MAX_REQUEST_BODY_BYTES`, independent of its content type. The report
   layer needs to check both fields together, not either one in isolation.
5. **The report-layer update is in scope for this same session, not a
   third follow-on file.** This data has no purpose if nothing renders it —
   same lesson as the last session (capture without a consumer is
   incomplete). **Step 0 before writing this half:** confirm whether a
   multipart body would ever also trip the size cap (i.e. are the two
   conditions actually mutually exclusive in the real code path, or can
   both be true at once). If they're exclusive, the label logic is simple
   either/or. If not, lock an explicit precedence — recommend multipart
   first, then size cap, then generic "unsupported content type" — and
   document why in the code, don't leave the order to whichever `if` was
   written first.

## Mechanics

- **No new inspection work** — `capture.ts` already reads `Content-Type` to
  decide whether to attempt a JSON or form-urlencoded parse at all (this is
  the same logic that already correctly handles the `charset=UTF-8` suffix
  case proven against real OpenEMR traffic in the capture session). Reuse
  that existing matching logic to derive the category; do not write a
  second, parallel content-type parser.
- **Category derivation as a small pure function**, easily unit-tested in
  isolation: closed-set string in, closed-set string out. Test the same
  edge cases already proven to matter — bare `application/json`,
  `application/json; charset=UTF-8`, `multipart/form-data` with a boundary
  parameter, and at least one genuinely unrecognized content type mapping
  to `'other'`.
- **`requestBodyExceededSizeCap`** should be set at the same point the
  existing size-cap check already runs for `requestBody` capture — this is
  a byproduct of a check the code already performs, not new logic to
  detect the condition, only new logic to record it.

## Persistence

**Step 0 before writing persistence code:** confirm this is additive to the
same JSON-blob pattern already used for every prior `NetworkEntry` field
addition — should be, but confirm rather than assume, same discipline as
both prior briefs.

## Session split

1. **`packages/acquire`** — the two new fields, category derivation reusing
   existing content-type matching logic, size-cap flag as a byproduct of the
   existing check. Unit tests for all four categories, the null case, the
   charset-suffix case, and an oversized-JSON case.
2. **`packages/output`** — update wherever `api-test-scaffold.ts` currently
   produces the coarse "not applicable" label to use both new fields for a
   specific reason string (e.g. "not applicable (multipart/form-data)",
   "not applicable (exceeds size cap)", "not applicable (unsupported
   content type)"), per the precedence locked in decision #5. Tests for
   each specific label, using fixture `NetworkEntry` combinations covering
   every category × size-cap-boundary combination.

## Verification requirement

Same OpenEMR instance, still running per your last instruction — no
cleanup assumption here either, confirm its state with the repo owner
before this session if it's been a while since the last one. Confirm
against real data:

- The real login POST and the `messages.php`/`patient_tracker.php`
  background POSTs from the capture session's own verification correctly
  report `'json'` or `'form-urlencoded'` as appropriate — cross-check
  against what that session already found about their actual content
  types.
- If a real multipart endpoint exists on this OpenEMR instance (a
  document/file upload page is the likely candidate — check during
  crawling rather than assuming one exists), confirm it now renders the
  specific multipart label, not the old generic one.
- A synthetic oversized-body case (fixture-only is fine here — a real
  target giving you a >64KB form POST isn't something to go hunting for)
  confirms the size-cap label renders correctly and takes precedence per
  decision #5's locked ordering.

## Open items carried forward

- None expected — this was scoped specifically to close the one gap found
  in the report session. If implementation surfaces something else missing
  for full attribution, report it back rather than expanding this session's
  scope to cover it.

## Before closing this session out

Same doc-update expectations as every session in this repo — CONTEXT.md
entry, CLAUDE.md gotcha update (this one should probably _close out_ the
gotcha the report session added, not just add a new one, since this session
exists specifically to resolve it), README.md only if something
user-facing changed. This file follows the same permanent-retention rule
as every session brief before it once implemented — stays on disk, stops
being edited.
