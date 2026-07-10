<!-- astro-discuss: captured -->
# Context — Phase 4: GitFlow PRs, release and hotfix flows

Decisions and constraints to plan against (settled with the user 2026-06-11; builds
directly on phase 3's `lib/flow.mjs` and ADR-007/009/010).

## Decisions

- **PR backend = `pr:"none"` default + strictly opt-in `gh`/`glab`.** Default behavior
  is pure git: push the branch and print the compare/PR URL — works on any remote, no
  forge dependency. If `config.json` `gitflow.pr` is `"gh"` or `"glab"` AND that CLI is
  installed, create the PR via the forge CLI; when the CLI is missing, degrade
  gracefully to the URL with a `⚠` advisory (never fail the command). The canon's
  "never `gh`" constraint protects the *registry* — the registry remains pure git;
  forge CLIs never touch it. Rejected: pure-git-only (defers value), push-options
  (GitLab-only).
- **Release flow = develop→main PR + tag, NO `release/*` branches.** Under Option A the
  milestone feature branch already plays the stabilization role, so classic
  `release/<v>` branches are ceremony without benefit. `ac flow release` pushes
  `develop`, opens/prints the develop→main PR, and main is tagged after merge.
  Rejected: full `release start/finish` branch pair; deferring releases.
- **Tagging scheme = `v<milestone>`**, derived from the project-global milestone
  number — milestone 3 releases as `v3`. Hotfixes bump a patch suffix: `v3.1`, `v3.2`.
  Zero config, zero arguments, aligned with registry numbering. Rejected:
  user-supplied semver; no tagging.
- **Hotfixes consume NO registry numbers.** `hotfix/<user-slug>` is named directly by
  the user; nothing is claimed from the registry, so the emergency path works fully
  offline. Git push rejection already prevents cross-developer branch collisions, and
  the tag carries identity. Rejected: a `hotfix` claim type (adds a remote round-trip
  to an emergency path); consuming phase numbers.

## Scope (this phase = PRs + release + hotfix on top of phase 3)

In scope:
- **Milestone PR**: an `ac flow` subcommand (e.g. `ac flow pr`) that pushes the current
  `feature/m<N>-<slug>` branch and opens/prints the PR to `develop`. Per ADR-009 this
  stays a separate `ac flow` subcommand — do NOT extend `ac milestone complete`.
- **Release**: `ac flow release` — push `develop`, open/print the develop→main PR;
  tagging `main` as `v<N>` (see open question 2 for timing).
- **Hotfix**: `ac flow hotfix start <name>` (branch `hotfix/<name>` off `main`) and
  `ac flow hotfix finish` (land on BOTH `main` and `develop` per GitFlow, tag the
  patch `v<N>.<k>`).
- **PR plumbing shared by all three**: respect `gitflow.pr` (`none` | `gh` | `glab`);
  compare-URL construction parsed from the remote URL for github/gitlab hosts, falling
  back to printing branch names for unrecognized remotes; CLI-presence detection with
  graceful degrade.
- All logic in `lib/flow.mjs` (thin git wrappers, named exports, thrown Errors → `die()`
  in `bin/ac.mjs`); wired into the existing `case 'flow'` dispatcher.
- Tests extend `tests/flow.test.mjs` with a **real bare remote** (like
  `registry.test.mjs`): pr:none push+URL paths, hotfix start/finish dual-landing,
  tag derivation including patch-suffix increment, degrade paths (no remote, forge CLI
  absent, gitflow disabled). Forge-CLI success paths are NOT integration-tested
  (would require gh/glab + network) — test the detection/degrade logic instead.
- The orphan `astro-registry` branch guard from phase 3 applies to every new command:
  flow commands never read, write, or push the registry branch.

Out of scope (later phases / never):
- Moving the roadmap to the orphan registry branch (ADR-010 — separate later phase).
- Forge HTTP APIs, tokens, or webhooks — only the `gh`/`glab` CLIs, only opt-in.
- Auto-merging PRs, merge queues, branch-protection management.
- GitLab push-options (`-o merge_request.create`).

## Open questions (planner decides — user opted to capture at this point)

1. **`hotfix finish` mechanics under `pr:"none"`**: classic GitFlow does local
   dual-merge (`git merge` into `main` and `develop`, then push both). With branch
   protection that's impossible and PRs are required. Suggested resolution: follow the
   `pr` setting — `none` → local dual-merge + push; `gh`/`glab` → open two PRs (and
   tag only the `main` side once merged). Planner picks and documents.
2. **Release tag timing**: with `pr:"none"`/forge PRs, the develop→main merge happens
   on the forge, so `ac flow release` cannot tag at PR-open time. Likely shape: a
   follow-up invocation (e.g. `ac flow release --tag` or `ac flow tag`) run after the
   merge, which verifies `main` contains the merge and then tags + pushes the tag.
3. **Patch-suffix derivation**: next free `v<N>.<k>` should be computed from existing
   tags (`git tag -l "v<N>.*"`), not stored state — tags are the source of truth.
4. **No-remote degrade**: push-requiring commands in a remote-less repo should fail
   with a clear actionable message (or perform the local half and say what's left),
   never half-succeed silently.

## Canon reminders

ESM `.mjs`, named function exports, zero deps, `node:` builtins. `die()`/glyph output
in `bin/ac.mjs` only — `lib/flow.mjs` throws. `node:test` + real git temp repos.
Every flow function gates on `gitflow.enabled` and the registry-collision guard.
High-density "why" comments — match the voice of phase 3's `lib/flow.mjs` header.
