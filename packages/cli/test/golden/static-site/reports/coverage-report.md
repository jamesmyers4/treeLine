# Coverage Gap Report

Generated: 2026-07-18T21:27:32.627Z

0 pages with zero POM coverage, 0 pages with high skip rates, 0 forms without field-level test coverage, 0 pages with an HTTP error status, 0 unresolved hard-pages entries

## Zero-coverage pages

Every interactive element on these pages was skipped — no POM locators were generated at all.

None found.

## High-skip pages

More than 50% of interactive elements were skipped (excludes zero-coverage pages, listed above).

None found.

## Forms without a corresponding test

Generated specs are page-level skeletons — a single `toHaveURL` assertion after `goto()` — and never reference individual form fields (see `pom-generation.ts`'s `generateSpec`). Every form found during the crawl therefore has no field-level test coverage today; this is a known gap, not a per-form defect. See V2.md item 5 ("AI-proposed test assertions") for planned work to close it.

No forms were found.

## Pages that returned an HTTP error status

These pages were captured (their content is in the other reports) but returned a 4xx/5xx status, so no POM or spec was generated for them — a test asserting that a broken page loads would be wrong. Usually a broken link or a removed page.

None found.

## Unresolved hard-pages entries

No unresolved hard-pages entries.
