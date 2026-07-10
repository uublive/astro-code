# Context — Phase 3: GitFlow branch automation (Option A)

Decisions and constraints to plan against (settled with the user; see ADRs).

## Decisions

- **GitFlow mapping = Option A** (ADR-007): milestone = feature branch off `develop`;
  phases commit on the milestone branch; milestone-complete = PR to `develop` (PR itself
  is phase 4, not here).
- **Command surface = separate `ac flow` commands** (ADR-009): do NOT extend
  `ac milestone new` / `ac phase add`. Branching is opt-in per action via explicit
  `ac flow …` subcommands, gated on `gitflow.enabled`. Lifecycle commands stay untouched.
- **State placement = keep `.astrocode` on the branch** (ADR-010): roadmap/state lives on
  the milestone feature branch and rides the eventual merge to `develop`. Do NOT move the
  roadmap to the orphan registry branch in this phase — that migration is a later phase.

## Scope (this phase = branch automation ONLY)

In scope:
- `ac flow init` — ensure `main` + `develop` exist (create `develop` off `main` if
  missing); idempotent; no-op cleanly when already set up.
- `ac flow` command(s) to **create + switch** to the milestone feature branch
  `feature/m<N>-<theme>` off `develop`, derived from the active milestone in the registry.
- Branch naming from config prefixes; `<theme>` slugified from the milestone name.
- A `gitflow` block in `config.json` (default **disabled**): `enabled:false`, `main`,
  `develop`, `prefixes:{feature,release,hotfix}` (release/hotfix used in phase 4),
  `pr:"none"`.
- Thin git wrappers over `lib/git.mjs` (`git(args)`); a small `lib/flow.mjs` for the
  flow logic, mirroring the single-responsibility lib module style.
- Tests in `tests/flow.test.mjs` using a **real git** temp repo (like `registry.test.mjs`):
  `flow init` creates develop; milestone-branch create/switch; idempotency; gracefully
  refuses/falls back when `gitflow.enabled` is false or `develop` missing.

Out of scope (later phases):
- PRs / forge integration (`gh`/`glab`), release branches, tagging, hotfix flows → phase 4.
- Moving the roadmap to the orphan branch → a later phase.

## Risks to address in the plan (from todo.md)

1. **Worktree base** (todo #6): `workflows/execute-phase.mjs` forks one worktree per task.
   In GitFlow mode those worktrees + the integrator must branch from / fold onto the
   **milestone feature branch**, not a random HEAD or `main`. The plan must at least
   document this interplay; ideally make the base explicit. (Execution already runs "on
   the current branch", so being *on* the feature branch when executing largely handles
   it — call this out.)
2. **Never touch the orphan `astro-registry` branch** (todo #2): GitFlow branches are
   code branches. Flow commands must not push/modify the registry/canon branch. The
   registry already records each claim's `branch` — feature-branch names give those
   meaning, but flow writes only normal git refs.
3. **Lean ethos** (todo #7): every flow command is a thin, inspectable git wrapper; no
   heavy new state; reuse `config.json`; ESM `.mjs`, named exports, `node:` builtins,
   zero deps (ADR-001). Degrade gracefully (clear error if `develop` missing → suggest
   `ac flow init`).
4. **Pure git, any remote** (ADR-002 ethos): no forge API in this phase. `ac flow init`
   and branch create/switch are local git only.

## Canon reminders

ESM `.mjs`, named function exports, `die()`/glyph CLI output, `node:test` +
`node:assert/strict` with real git, `tests/<area>.test.mjs` naming, high-density "why"
comments. New CLI subcommand wires into `bin/ac.mjs`'s `switch (cmd)` and delegates to
`lib/flow.mjs`.
