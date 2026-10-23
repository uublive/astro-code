# Reproduction

Test: `tests/fix_backlog_order.test.mjs` — two ideas captured the same day, 49 ms apart, the
first with a slug that sorts last ("zebra…" at 13:36:58.851, "apple…" at 13:36:58.900).

Command: `node --test tests/fix_backlog_order.test.mjs`

Observed before the fix: `openBacklog` returned "apple…" first — slug order, not capture order.

# Diagnosis

- Symptom: same-day ideas listed out of capture order under a header that says "oldest first".
- Cause: the list sorted on the id, which is `<date>-<slug>`, so within a day it is alphabetical.
- Ruled out: the stored order (the register file is sorted by id for stable diffs; that is not what
  the user reads and is left as is).

# Fix

`byCapture` (lib/backlog.mjs): `captured_at`, then the id. Used by `openBacklog` and by
`ac backlog list --all`.
