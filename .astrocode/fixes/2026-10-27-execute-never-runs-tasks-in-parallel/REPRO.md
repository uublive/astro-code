# Reproduction

Command: `node --test tests/waves.test.mjs tests/workflows.test.mjs`

Observed before the fix (3 failing):
- `a file line copied from the plan (backticks, (new) notes) claims only the paths`: claimedFiles kept the
  tokens as written (`` `lib/a.mjs` ``, `(new)`), so every task with a new file shared the claim `(new)`
  and buildWaves split three disjoint tasks into three waves.
- `a task whose file is the plan itself declares no file (wildcard)`: `file: "PLAN.md"` was a real claim,
  so every task claimed PLAN.md, all collided, and the run silently went sequential.
- `Discover defines file as the files the task edits, never the plan …`: the Discover prompt never said
  what `file` means, and the executor prompt labelled it `Plan/task file:`.

Live evidence: astro-code phase 52 run wf_f45d5a43-fa5 — PLAN.md uses singular `- **file:**`, Discover
returned `"file":"PLAN.md"` for all 12 tasks, buildWaves logged 28 same-file deferrals, and no warning fired
(the wildcard warning only counted an empty `file`).

# Diagnosis

Symptom: every multi-task phase executes one task per wave (sequential), on any machine.

Cause: `file` meant two things in workflows/execute-phase.mjs. buildWaves/claimedFiles read it as the
files a task edits; the executor prompt printed it as "Plan/task file" (the plan's location). Discover's
prompt and schema defined neither, so it returned the plan path — for both `file:` and `files:` plans.
The singular/plural difference in the report is not the cause (singular failed too, above). Second cause:
claimedFiles split the raw string on whitespace, so markdown leftovers became claims.

Ruled out: buildWaves' Kahn layering (correct given clean claims, existing tests); use_worktrees (only
decides whether a computed wave runs in parallel); the planner's spelling alone.

Fix at the cause: define `file` in the Discover prompt and schema; normalise claims in code (strip
backticks and notes, keep path-like tokens, treat the plan or any phase-dir file as no claim) so the
existing wildcard warning fires instead of a silent sequential run; drop the "Plan/task file" label.
