# Diagnosis

## Symptom vs cause

**Symptom (reported):** `ac phase add --milestone N` moves the project into milestone N.
**Symptom (reported, second):** `ac debt pay --as phase` files a new phase into an
already-completed milestone, with no `--milestone` flag anywhere in the command.

**Cause (one line, both symptoms):** `lib/roadmap.mjs:158`

```js
if (milestone) rm.milestone = milestone;   // rm.milestone is the PROJECT pointer
```

`addPhase` was handed the milestone *the phase belongs to* and wrote it to the field
that records *where the project currently is*. Two intents, one writer.

The second symptom is one hop downstream. `bin/ac.mjs:372` resolves the milestone for a
graduated debt item as `st.active_milestone || rm.milestone || 1` — **state wins**. And
`addPhase` was the only writer in the codebase that moved `rm.milestone` without also
moving `state.active_milestone`, so once it had fired, the two pointers disagreed and
`debt pay` read the stale one.

## Ruled out

- **`milestone || 1` as the debt-pay default** — the reporter's own hypothesis. Wrong:
  the fallback chain reaches `1` only when both pointers are absent. He saw `1` because
  `state.active_milestone` was still `1` (never advanced, since the project moved
  milestones via `phase add` rather than `milestone new`) while `rm.milestone` had been
  dragged to `2`. Patching the fallback would have left the drift intact and the first
  symptom untouched.
- **The registry** — claims record the right milestone throughout. Reporter confirmed
  this, and `ac phase check` prints it correctly. The registry was never wrong; only the
  local roadmap was.
- **`setMilestone` / `ac milestone new`** — correct. `bin/ac.mjs:586-587` writes both
  pointers together, which is exactly the behaviour `addPhase` was missing.

## Why the line existed

The comment block at `lib/roadmap.mjs:126-141` documents it: `ac milestone new` used to
lose the bumped number (it mutated a `loadRoadmap()` result that `renderRoadmap()` then
re-read from disk), and "the first `ac phase add` repaired it as a side effect." That
root cause was fixed by introducing `setMilestone` and calling it from `milestone new`.
The repair side-effect was never removed. **It was compensation for a bug that no longer
exists** — which is why removing it is a deletion, not a redesign.

## Fix, at the cause

1. `addPhase` records `milestone` **on the phase** and does not touch `rm.milestone`.
2. `setPhaseMilestone` + `ac phase milestone <phase> [<N>]` makes a wrong assignment
   correctable. Not a convenience: without it the tool can reach a state that its own
   `AGENTS.md` gives the operator no legal way to leave, and every project already
   broken stays broken.
3. An absent milestone field reads as absent. Pre-existing roadmaps have no such field
   and must not be given an invented one.

## Deliberately NOT fixed here

Grouping `ROADMAP.md` by milestone, and a backlog tier for a phase with no milestone.
Both are in the issue; neither is this defect. Rationale in `REPORT.md` § Scope taken.
