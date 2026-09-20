# Reproduction

**Test:** `tests/phase_milestone.test.mjs`
**Run:** `node --test tests/phase_milestone.test.mjs`
**Observed at:** v0.23.0 (`64c7285`), before any change.

```
ℹ tests 9   ℹ pass 1   ℹ fail 8
```

## The defect, observed

```
✖ addPhase with a future milestone leaves the project pointer alone
  AssertionError: claiming phase 2 for milestone 3 must not move the project into milestone 3
  3 !== 1

✖ addPhase records the milestone on the phase
  AssertionError: undefined !== 1
```

A project sitting at milestone 1 in both pointers, after
`addPhase({ number: 2, name: 'beta', milestone: 3 })`:

- `roadmap.json.milestone` is **3** — the project was moved into milestone 3 by the act
  of scheduling a phase *for* milestone 3. This is the reported symptom, and it fails
  for exactly the stated reason: `lib/roadmap.mjs:158`, `if (milestone) rm.milestone = milestone;`
- the phase object is `{ number, name, slug, status }` — **no `milestone` field at all**,
  which is why nothing downstream can group, render or correct the assignment.
- `state.active_milestone` is still **1** while `roadmap.json.milestone` is **3**: the
  pointers have diverged, which is the mechanism behind the second reported symptom
  (`ac debt pay --as phase` resolving a stale milestone at `bin/ac.mjs:372`).

## The missing recovery path, observed

```
✖ ac phase milestone <phase> reads the phase’s milestone
  ✖ usage: ac phase <add|check|context|verify|accept|reject|effort|note> …
```

There is no subcommand that can correct an assignment, confirming the reporter's second
problem: the only repair is hand-editing `roadmap.json`, which `AGENTS.md` forbids.

## Honest note on the one passing case

`ac phase milestone on an unknown phase fails loudly` **passes before the fix** — but for
the wrong reason: the whole subcommand is unrecognised, so every invocation exits
non-zero. It is a real post-fix contract, not evidence of anything today.
