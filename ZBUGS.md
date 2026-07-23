hacker news website has some orange - treeLine is not capturing that correctly

**Resolved (BUG-FIX-PLAN.md Session 6, 2026-07-23).** Root cause confirmed:
HN's orange (`#ff6600`) is set via a `bgcolor` attribute on table rows/cells,
not an author stylesheet color, and `extractColorPalette`'s structural
selector had no table elements in it, so those elements were never sampled.
Reproduced first with a local fixture (not the live site) mimicking HN's
table layout, confirmed the fixture test failed against the old selector,
then fixed by extending `COLOR_SELECTOR` in `packages/acquire/src/
capture.ts` to include `table, tr, td, th`. See `packages/acquire/src/
capture.test.ts`'s "table-layout bgcolor, ZBUGS.md HN orange" test.
