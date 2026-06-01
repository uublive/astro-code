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
