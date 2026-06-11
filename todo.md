# TODO

## GitFlow integration (ANALYSIS ONLY — not yet implemented)

> Goal: drive GitFlow (feature/release/hotfix branches) directly from astro-code so
> the planning lifecycle and the branching model are one thing. Captured here for
> later; **no code written yet.**

### The mapping question (the decision everything hinges on)

The user's proposal: **milestone = feature branch**, **close milestone = PR → develop**.
There's a more GitFlow-idiomatic alternative. Both below; we must pick one.

| astro-code | Option A — *milestone = feature* (user's) | Option B — *phase = feature, milestone = release* |
|---|---|---|
| new milestone | `feature/m<N>-<theme>` off `develop` | `release/<N>` cut from `develop` at milestone close |
| new phase | worktree/commits on the milestone branch | `feature/m<N>-p<K>-<slug>` off `develop`, PR per phase |
| verify phase | merge phase work into the milestone branch | PR `feature → develop` |
| complete milestone | PR `feature/m<N> → develop` | merge `release/<N> → main` + `develop`, tag `v<N>` |
| hotfix | `hotfix/<name>` off `main` → `main` + `develop` | same |

- **Option A** is simplest and matches the user's words. Risk: a milestone is a
  *version cycle* and can be large/long-lived — a long-lived feature branch drifts
  from `develop` and turns the final PR into a merge nightmare.
- **Option B** aligns the unit of branching/PR (feature) with the unit astro-code
  already parallelizes (phase), keeps PRs small, and uses `release/*` for the
  version cut. More idiomatic, slightly more ceremony.
- **Leaning B**, but A is viable if milestones are kept small. **Decide first.**

### Proposed commands (thin git wrappers, config-driven)

- `ac flow init` — ensure `main` + `develop` exist (create `develop` off `main`).
- `ac milestone new` — (extend) also create the milestone/release branch + switch.
- `ac phase add` — (extend, opt-in) create the phase feature branch off `develop`.
- `ac phase finish <p>` / `ac ship` — push branch, open PR to `develop`.
- `ac milestone complete` — (extend) open the release PR / merge to `main` + tag.
- `ac hotfix start <name>` — branch `hotfix/<name>` off `main`.
- `ac hotfix finish <name>` — PR/merge to `main` **and** `develop`, tag patch.

### Config additions (`.astrocode/config.json`)

```jsonc
"gitflow": {
  "enabled": false,
  "main": "main",
  "develop": "develop",
  "prefixes": { "feature": "feature/", "release": "release/", "hotfix": "hotfix/" },
  "pr": "none"   // none | gh | glab | push-option
}
```

### Key risks / open questions

1. **PR automation breaks "pure git, any remote".** Creating PRs needs a forge API
   (`gh`/`glab`) or push-options — a dependency we deliberately avoided for the
   registry. Mitigation: default `pr: "none"` (just push the branch + print the
   compare URL); make `gh`/`glab` strictly opt-in and degrade gracefully.
2. **Don't let flow commands touch the orphan `astro-registry` branch.** Numbering +
   shared canon live there; GitFlow branches are code branches. Keep them separate.
   (Synergy: the registry already records the `branch` of each claim — GitFlow gives
   those names real meaning.)
3. **Where does `.astrocode/` working state live across branches?** Per-feature state
   will conflict on merge. The roadmap is milestone-global — strong candidate to join
   the **shared canon on the orphan branch** (same rationale as DECISIONS.md) so all
   feature branches read one roadmap. Decide roadmap placement alongside this.
4. **Hotfix numbering.** Do hotfixes consume registry numbers (a separate sequence?)
   or none? Probably a `patch`/`hotfix` claim type or no number at all.
5. **Versioning/tagging** on milestone complete — scheme? (`v<milestone>`,
   semver, calver?) Needs a decision.
6. **Worktree interplay.** `execute-phase` runs one isolated worktree per task; those
   must branch from the correct base (the phase/milestone branch), not random HEAD.
7. **Lean ethos.** GitFlow adds ceremony — keep every command a thin, inspectable git
   wrapper; no heavy new state; reuse `config.json`.

### Suggested phasing (when we build it)

1. **Branch automation only** — `ac flow init`, branch create/switch on
   milestone/phase. Pure git, no forge. Lowest risk, immediately useful.
2. **Opt-in PRs** — detect `gh`/`glab`; create PRs if present, else print the URL.
3. **Release + hotfix flows** — `release/*`, `hotfix/*`, tagging, dual-merge.
4. Revisit moving the **roadmap** to the shared orphan branch (ties into canon).

## Self-healing parallel-wave integration (flagged 2026-06-11, phase 04 incident)

> Wave-2 integration of phase 04 failed and needed manual cherry-pick conflict
> resolution. This class of failure recurs — astro-code must recover from it
> itself instead of dumping a conflicted worktree on the user.

What happened (three compounding causes, all reproducible):

1. **Stale worktree fork base.** Wave-2 executor worktree (t5) forked from the
   pre-phase HEAD (`2b8ff2d`) even though wave-1 integration had already advanced
   the branch by 3 commits. The design assumes wave N+1 worktrees fork from the
   integrated tip (`execute-phase.mjs` comment, line ~193) — the harness's
   `isolation: 'worktree'` base does NOT guarantee that. Cherry-picks from a
   stale base conflict with everything integrated since.
2. **Executor scope overflow breaks file-disjointness.** t5 declared
   `tests/flow.test.mjs` but committed 188 lines into `lib/flow.mjs` too —
   test-first tasks whose imports crash without the implementation push
   executors to implement (ESM import of a missing export fails the whole test
   file, so "write failing tests" is structurally impossible without stubs).
   Wave co-scheduling trusted the declared file, so t5 collided with t2.
3. **The integrator is abort-only.** On ANY conflict it aborts the cherry-pick
   and fails the entire run — correct but maximally unhelpful; executor commits
   strand on `worktree-*` branches.

What astro-code needs (in rough priority order):

- **Integrator fallback ladder** instead of abort-only: on conflict, (a) try
  rebasing the branch onto the integrated tip; (b) if still conflicting, DROP
  the branch and re-run that one task sequentially on-branch at the integrated
  tip (always converges — the executor sees the real current code); (c) only
  fail if the sequential re-run fails. Mirrors the existing
  "worktree-unavailable → re-run on-branch" degradation that already works.
- **Fork-base guard:** record the wave-start SHA; before cherry-picking, the
  integrator checks each `worktree-*` branch's merge-base against it. A
  stale-base branch goes straight to the rebase/re-run ladder, never a raw
  cherry-pick.
- **File-ownership enforcement:** executor prompt must say "touch ONLY the
  declared file(s)"; the integrator should detect overflow commits (diff names
  vs the task's declared files) and route them to the sequential re-run path.
- **Done-detection on re-run:** the Discover step returns every PLAN.md task —
  re-running `/astro-execute` after a partial failure re-executes completed
  tasks. Stamp task ids in commit messages (e.g. `(phase 04 t2)` already
  happens ad hoc) and have Discover (or the script) filter tasks whose id
  already appears on the branch, making `/astro-execute` resumable/idempotent.
- **Planner guidance:** test-first task pairs that import not-yet-existing
  exports should either include minimal stubs in the test task's declared
  files, use dynamic import + skip, or be co-scheduled with their impl task in
  one sequential slot — never parallel-split across a wave boundary.
