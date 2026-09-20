# Report — verbatim

Reported by @luigi-lauro as **[uublive/astro-code#16](https://github.com/uublive/astro-code/issues/16)**
on 2026-09-19 against v0.21.0 (`b131bc6`). Confirmed still live at v0.23.0 (`64c7285`).

The reporter's own words follow, unedited — the issue body, then both follow-up
comments in the order they were posted.

---

## Issue body

# `ac phase add --milestone N` silently repoints the active milestone, and a phase's milestone can never be corrected afterwards

**Version:** astro-code v0.21.0 (`b131bc6`)

Two related problems in the same code path. The second makes the first unrecoverable without editing the registry by hand, which `CLAUDE.md` tells agents never to do.

## 1. `--milestone N` repoints the whole roadmap, not just the new phase

`lib/roadmap.mjs:132`, inside `addPhase`:

```js
export async function addPhase(root, { number, name, milestone }) {
  ...
  const rm = readJSON(p.roadmap) || { version: 1, milestone: milestone || 1, phases: [] };
  if (milestone) rm.milestone = milestone;      // <-- repoints the PROJECT, not the phase
```

`rm.milestone` is the project's *current* milestone — what `ac status` prints and what `ac milestone complete` acts on. So claiming a phase **for a future milestone** silently moves the whole project into that milestone.

### Reproduction

Project is mid-milestone 2, with unfinished phases:

```console
$ ac status | head -3
Milestone: 2   (active phase: 08-…)

$ ac phase add "PortMaster ingestion: …" --milestone 3
✓ phase 13 "PortMaster ingestion: …" (milestone 3) [registry: astro-registry]

$ ac status | head -3
Milestone: 3          # ← the project is now "in" M3; M2's phases 08–12 are unfinished
```

Nothing in the output mentions that the active milestone changed. I hit this twice in one session (phases 13 and 15) and only noticed the second time because I was checking for it.

### Why it matters

- `ac status` misreports the project state to every later session and to any statusline reading it.
- `ac milestone complete` archives *the current milestone*, so the wrong set can be archived and the wrong claims retired.
- It is silent. There is no warning, and `--milestone` reads naturally as "the milestone this phase belongs to" — which is also how `bin/ac.mjs:703` uses it when claiming.

### Suggested fix

`addPhase` should record the phase's milestone **on the phase**, and leave `rm.milestone` alone unless the caller explicitly asks to switch. A phase claimed for a future milestone is a normal backlog action and should not move the project.

Note that `roadmap.json` phases currently carry **no** per-phase `milestone` field at all — the milestone lives only on the registry claim and in the single global pointer. That is the root of both problems here.

## 2. There is no way to change a phase's milestone

Once `ac phase add` has run, nothing can correct the assignment:

```console
$ ac help | grep -E "phase|milestone"
  ac milestone new [--name "…"]       claim the next milestone number
  ac milestone check "<name>"         see if a milestone with a similar name exists
  ac milestone complete               archive the current milestone + retire its claims
  ac phase add <name> [--milestone N] claim the next phase number + add it
  ac phase check / context / verify / accept / reject / effort / note
  ac claim <milestone|phase> [m]      raw number claim (prints the number)
```

There is no `ac phase milestone <phase> <N>`, no `--milestone` on any other subcommand, and no remove-and-re-add (the number is already spent in the shared registry, so re-adding would burn a second one).

The only remaining option is hand-editing the registry — which is exactly what a team-coordinated numbering registry exists to prevent, and which this project's own agent instructions forbid.

### Two real consequences from one session

- A phase was claimed under the wrong milestone because the requirement was clarified a minute later. The claim still says the wrong milestone; the correction lives in a prose note.
- **There is no way to express "backlog, not scheduled".** A parked design that should sit in the roadmap purely so it is not forgotten must still be claimed under *some* numbered milestone, which then reads as scheduled work. The note has to say "read the claim as unscheduled", which a tool reading the registry cannot.

### Suggested fix

Either an explicit `ac phase milestone <phase> <N>` that updates the claim and the roadmap together, or accept a phase with **no** milestone (a backlog tier), or both. The backlog case seems common: a roadmap that cannot hold an unscheduled item pushes that information into prose, where tooling cannot see it.

## Environment

- astro-code v0.21.0 (`b131bc6`), Node 26.8.2, Fedora 44
- Registry: local bare repo on an orphan `astro-registry` branch, team-coordinated numbering live
- Single developer, 15 phases across 3 milestones


---

## Follow-up comments

A third symptom of the same root cause, and the one a user notices without knowing internals: **`ROADMAP.md` renders phases from other milestones under the current milestone's heading.**

This project has 15 phases: 1–12 and 14 in milestone 2, and 13 and 15 in milestone 3 (the registry claims are correct). The rendered roadmap is:

```console
$ grep -c "^\*\*Milestone" .astrocode/ROADMAP.md
1
$ grep -n "^\*\*Milestone" .astrocode/ROADMAP.md
3:**Milestone 2**
$ grep -n "^- \[ \] Phase 1[345]" .astrocode/ROADMAP.md
17:- [ ] Phase 13 — PortMaster ingestion: …      # milestone 3
18:- [ ] Phase 14 — Milestone 2 closing review…  # milestone 2
19:- [ ] Phase 15 — RG-STATUS: …                 # milestone 3
```

One heading, every phase beneath it. `ac status` is the same flat list with no milestone column. So a phase deliberately claimed for a **future** milestone is presented as **current-milestone work** in both views, and the only record of the truth is the registry claim — which neither view reads.

This follows directly from the missing per-phase `milestone` field noted above: `renderRoadmapMd` has only the single global `rm.milestone` to print as a heading, so it cannot group even when the claims would allow it.

Practical consequence, and why this is more than cosmetic: there is no way to express "parked, do not schedule this yet". We have a designed-but-deliberately-deferred piece of work that must live somewhere so it is not forgotten. It has to be claimed under some numbered milestone, and then renders as if it were scheduled. The only fix available to us was prose — the phase note now begins "NOT PART OF ANY PLANNED MILESTONE … do NOT pick it up when planning M3" — which no tool can read.

If the per-phase `milestone` field is added for the two problems above, grouping the render by it would resolve this as a side effect. A phase with **no** milestone rendering under a `Backlog` heading would additionally cover the parked case.

## Further evidence: `ac debt pay --as phase` hits the same path, and lands the phase in a *completed* milestone

Same project, 2026-09-19, astro-code v0.21.0. This one is worse than the original report in two ways, and I hit it without touching `ac phase add` at all.

### What I ran

The project was mid-milestone 2. I graduated a technical-debt item into a roadmap phase, which is the documented way to schedule debt as planned work:

```console
$ python3 -c "import json;print(json.load(open('.astrocode/roadmap.json'))['milestone'])"
2

$ ac debt pay 2026-09-19-the-permission-model-asks-about --as phase
✓ debt 2026-09-19-the-permission-model-asks-about → phase 16 "The permission model asks about
  harmless work and so spends the attention it needs for the dangerous kind" (milestone 1)
  it closes when you run `ac phase accept 16` (or /astro-accept)

$ python3 -c "import json;print(json.load(open('.astrocode/roadmap.json'))['milestone'])"
1
```

`ac status` went from `Milestone: 2 (active phase: 08-…)` to `Milestone: 1`.

### Why this is worse than the `ac phase add` case

1. **No `--milestone` flag was passed.** The original report is about a flag whose effect is broader than its name suggests — a user at least typed a milestone number. Here nothing in the command names a milestone, so there is no point at which the user could have suspected the project pointer was in play. `ac debt pay --as phase` has no documented milestone behaviour at all (`ac help`: `ac debt pay <id> [--as fix|phase]   graduate it into a fix (default) or a roadmap phase`).

2. **It repoints the project *backwards*, into a milestone that is already complete.** Milestone 1's seven phases are all `complete`. The new phase 16 was filed into it, so the roadmap now shows a completed milestone containing a `pending` phase, and the project claims to be working on the milestone it finished days ago. Every subsequent `ac status` — which `CLAUDE.md` tells agents to run *first, to orient* — now orients them wrongly.

3. **Recovery is still impossible through the CLI**, which is problem 2 of the original report, and this is a second way to reach it. `ac help` exposes `milestone new`, `milestone check` and `milestone complete`; none sets the current milestone, and none moves a phase between milestones. The only repair is hand-editing `.astrocode/roadmap.json`, which `CLAUDE.md` explicitly forbids:

   > **Never hand-edit `.astrocode/roadmap.json`, `state.json`, or the registry.**

   So the tool puts the project into a state that its own documented rules forbid the operator from leaving. That is the part worth fixing first, independently of which command caused it.

### Suggested shape of a fix

- `addPhase` should take the phase's milestone and the project's current milestone as **separate** concerns; assigning one should never write the other. That is the one-line change in the original report.
- `ac debt pay --as phase` should file the phase into the **current** milestone by default, or accept an explicit `--milestone`, and say which one it used. Defaulting to `1` looks like `milestone || 1` from the same `readJSON` fallback in `lib/roadmap.mjs:132` leaking into a path that never had a milestone to pass.
- Whatever else changes, please add a way to correct it: `ac phase milestone <phase> <N>`, or `ac milestone set <N>`. Without one, every occurrence of this bug is permanent for anyone who follows the no-hand-editing rule.

### Frequency

Four occurrences in this project now — phases 13 and 15 via `ac phase add --milestone N`, and phase 16 via `ac debt pay --as phase`. The first three were noticed only because the reporter happened to re-run `ac status`; nothing in any of the outputs mentions the active milestone changing.


---

## Scope taken (decided 2026-09-20, before diagnosis)

The issue bundles one defect with three requests. Only the defect and the two things
required to make fixing it useful are in this fix.

| Ask | In this fix | Why |
|---|---|---|
| `addPhase` must not repoint `rm.milestone` | **yes** | the defect |
| Record the milestone on the phase | **yes** | the fix needs somewhere to put it |
| A way to correct an existing wrong assignment | **yes** | without it, everyone already broken stays broken, and `AGENTS.md` forbids the only exit (hand-editing `roadmap.json`) |
| Group `ROADMAP.md` by milestone | no | separate, and a rendering change is not this defect |
| A backlog tier (a phase with **no** milestone) | no | a new concept the registry, `milestone complete`, the loop and the statusline would all have to learn. `ac phase note` (ADR-044) already carries parking intent; if it must become machine-readable later, a `status` value is far cheaper than a milestone-less tier |

One correction to the reporter's second comment: `ac debt pay --as phase` does **not**
default to 1 via `milestone || 1`. `bin/ac.mjs:372` reads
`st.active_milestone || rm.milestone || 1` — state wins over the roadmap. It read `1`
because `state.active_milestone` was stale, and it was stale because `addPhase` is the
only writer in the codebase that moves `rm.milestone` without also moving
`state.active_milestone`. The divergence is a second symptom of the same line, not a
separate fallback bug.
