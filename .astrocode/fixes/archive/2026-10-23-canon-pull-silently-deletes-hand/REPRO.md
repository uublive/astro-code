# Reproduction

Test: `tests/fix_canon_pull_prose.test.mjs` — real bare remote, two working copies (alice, bob).
Alice records a decision and pushes; bob pulls, then writes a paragraph into his DECISIONS.md and
pulls again.

Command: `node --test tests/fix_canon_pull_prose.test.mjs`

Observed before the fix (commit 8262182 tree):
- paragraph **before the first ADR** (preamble): FAIL — "the paragraph is either kept or reported as
  discarded — never lost silently". The file no longer held it and the pull returned ok with no
  report; the CLI printed only "✓ DECISIONS.md: updated from astro-registry".
- paragraph under a non-ADR heading at the end: passes (it rides inside the last ADR block's text).

# Diagnosis

- Symptom: a pull reports a plain "updated" while a hand-written paragraph disappears.
- Cause: `mergeDecisions` (lib/canon.mjs) builds the result as the registry's text plus the local
  entries found by the `^## ADR-` heading scan. Text before the first ADR heading (the preamble) is
  never consulted — the registry's preamble always wins, and nothing reported what was replaced.
- Ruled out: the ADR entry merge itself (every ADR block, including trailing prose inside the last
  one, is carried or reported as preserved/collision); CONVENTIONS.md handling (separate path).
- Not changed: the registry's preamble still wins — that is the mirror semantics every copy
  converging needs (phase 18). The fix makes the replacement visible and recoverable.

# Fix

`mergeDecisions` returns `discarded`: local preamble paragraphs the registry's preamble lacks.
`canonPull` saves them to `.astrocode/.local/decisions-discarded-<timestamp>.md` (git-ignored)
before writing, and returns `discarded` + `discardedFile`; `ac canon pull` warns, quoting the first
paragraph and naming the saved file.
