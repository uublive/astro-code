# Reproduction

Test: `tests/fix_canon_collision_fixes.test.mjs` — real bare remote; alice publishes ADR-001, bob
hand-writes a different decision under the same id, then `ac canon pull` runs in bob's copy.

Command: `node --test tests/fix_canon_collision_fixes.test.mjs`

Observed before the fix: the output held "⚠ DECISIONS.md was NOT overwritten — a same-id decision
collision was found. Fix: ." (assertion "no empty fix list" failed).

# Diagnosis

- Symptom: a refusal sentence ending in an empty "Fix: .".
- Cause: `canonPull` (lib/canon.mjs) built the DECISIONS.md refusal with `fixes: []`, and the CLI
  printed `Fix: <list>.` unconditionally. The CONVENTIONS.md refusals carry real lists, which is why
  only this one read as broken.
- Ruled out: `decision add` — its collision is reported through its own message, not this refusal.

# Fix

The refusal now lists the ways out (`ac canon check` to see both versions; `ac decision add` the
local one under a new id; `ac decision amend <id>` if it edits the published one), and the CLI omits
the "Fix:" sentence whenever a refusal carries no fixes.
