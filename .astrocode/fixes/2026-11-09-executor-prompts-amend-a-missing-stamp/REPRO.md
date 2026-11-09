# Reproduction

- The git behaviour is the reporter's own reproduction (in REPORT.md): amending a commit a post-commit hook
  already pushed leaves the branch ahead 1 / behind 1. (Re-running it here was blocked by the sandbox's
  process-group restriction on hooks; it is plain git semantics.)
- The defect in astro-code is the unconditional instruction: `tests/fix_no_amend_pushed_stamp.test.mjs` checks
  that every amend instruction carries the pushed-commit rule. Before the fix: `not ok 1`, `not ok 2`. After:
  both pass.
