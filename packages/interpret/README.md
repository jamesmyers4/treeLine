# @treeline/interpret

AI interpretation layer. Routes each captured page to Haiku 4.5 or Sonnet 5
and produces a `PageInterpretation`.

## Why `PageInterpretation` has no `interactiveElements`

`PageState` (from `@treeline/acquire`) already carries `interactiveElements`
sourced directly from DOM/aria-tree capture — exact roles, accessible names,
and testid presence, with no chance of hallucination. Having the model
re-derive the same list added tokens and a second, less reliable source of
truth for data the pipeline already had. `PageInterpretation` now sticks to
judgments only capture can't produce on its own: page type, purpose, key
data entities, and confidence. Selector/testid reporting in `packages/output`
should read `PageState.interactiveElements`, not anything from this package.
