# Decisions — astro-code

> Append-only ADR-lite log. Each entry: what we decided, why, and what we rejected.
> Add entries with `ac decision add "<title>" --why "…" --rejected "…"` or
> `/astro-decision`. Agents read this so past decisions are respected, not relitigated.

## ADR-001 — Dependency-free ESM-only Node ≥22 substrate
_2026-06-05_

**Why:** Claude Code 4.8 runs the framework directly; no build/transpile/bundler and node: builtins only keeps it lean, auditable, and instantly runnable

**Rejected:** TypeScript + build step; runtime deps for CLI/arg parsing

## ADR-002 — Orphan-branch git compare-and-swap for all shared state
_2026-06-05_

**Why:** lib/shared.mjs transact() makes numbering, decisions, and canon collision-proof across developers using a non-force push whose rejection is the mutual exclusion — no server, no gh, works on any remote

**Rejected:** server-side coordination; local-only numbering; gh API

## ADR-003 — Project-global phase numbering (never restart per milestone)
_2026-06-05_

**Why:** registry claims allocate max+1 across the whole project to prevent the milestone-1-twice counter-reset drift

**Rejected:** per-milestone phase counters

## ADR-004 — Plain-file state owned by the CLI; ROADMAP.md generated
_2026-06-05_

**Why:** all .astrocode JSON is mutated only through lock-guarded lib helpers; the human-readable roadmap is rendered, never the source of truth

## ADR-005 — Workflow-tool execution: dependency waves + worktree isolation + sole integrator
_2026-06-05_

**Why:** parallel executors run in isolated worktrees; the integrator is the only git actor (Workflow scripts can't run git) and folds waves onto the branch; same-file tasks are never co-scheduled

**Rejected:** parallel agents committing to one working tree (caused integration collisions)

## ADR-006 — Two-gate phase closure: AI verifies, only humans accept
_2026-06-05_

**Why:** the AI verifier reaches verified at best; ac phase accept refuses unless verified, so a human UAT gate is required to reach complete

**Rejected:** AI auto-closing phases

## ADR-007 — GitFlow mapping: milestone = feature branch (Option A)
_2026-06-05_

**Why:** User-chosen model: each milestone is one feature/m<N> branch off develop, phases commit on it, milestone complete = PR to develop. Simplest and matches the original proposal

**Rejected:** Option B (phase = feature, milestone = release/<N>); long-lived milestone branches must be kept small to avoid develop drift

## ADR-008 — Without the Workflow tool, execution degrades to sequential — never parallel-without-isolation
_2026-06-05_

**Why:** The Workflow path is the only place parallel-safe execution is done deterministically (worktree isolation + integrator). When the Workflow tool is unavailable, the Agent-tool fallback runs tasks one-at-a-time in dependency order (one atomic commit each) so parallel agents can never commit to the same working tree — the root cause of the integration conflicts

**Rejected:** re-implementing the worktree+integrator orchestration in markdown prose (fragile); hybrid auto-strategy in the fallback

## ADR-009 — GitFlow exposed as separate 'ac flow' commands, not by extending lifecycle commands
_2026-06-05_

**Why:** Branching stays decoupled from the planning lifecycle (milestone new / phase add untouched); GitFlow is opt-in per action via explicit ac flow subcommands and gitflow.enabled config. Keeps each command a thin, inspectable git wrapper

**Rejected:** auto-creating branches inside ac milestone new / ac phase add (couples lifecycle to branching)

## ADR-010 — GitFlow Option A: .astrocode state stays on the milestone feature branch (defer orphan-roadmap migration)
_2026-06-05_

**Why:** Phase 3 is pure branch automation; .astrocode roadmap/state lives on the milestone feature branch and merges to develop at close. Moving the roadmap to the shared orphan branch is a separate, later phase (todo.md phasing)

**Rejected:** moving the roadmap onto the astro-registry orphan branch now (too big for branch-automation phase)

## ADR-011 — Opt-in forge CLI for PRs; pure-git pr:none default
_2026-06-11_

**Why:** PR creation defaults to push + compare URL (pure git, any remote); gh/glab run only when gitflow.pr opts in AND the CLI is installed, degrading gracefully to the URL. The never-gh canon constraint protects the registry, which forge CLIs never touch

**Rejected:** pure-git-only phase (defers value); GitLab push-options (forge-specific)

## ADR-012 — Releases are develop-to-main PRs tagged v<milestone>; no release/* branches
_2026-06-11_

**Why:** Under Option A the milestone feature branch already plays the stabilization role, so release branches add ceremony without benefit; tags derive from the project-global milestone number (v3, hotfix patches v3.1) with zero config

**Rejected:** full release start/finish branch pair; user-supplied semver; calver

## ADR-013 — Hotfixes consume no registry numbers
_2026-06-11_

**Why:** hotfix/<user-slug> is named directly so the emergency path works fully offline; push rejection already prevents cross-developer branch collisions and the v<N>.<k> tag carries identity

**Rejected:** a dedicated hotfix claim type (remote round-trip on an emergency path); consuming project-global phase numbers

## ADR-014 — Wave-conflict healing is drop-and-rerun at the integrated tip — never rebase
_2026-06-11_

**Why:** A conflicted worktree branch was written against a stale tip; rescuing it textually is the proven phase-04 trap (auto-merge stacked duplicate helpers with no conflict markers). Re-running the task sequentially on-branch is always semantically fresh and cannot conflict by construction; healed waves are test-gated before the next wave proceeds

**Rejected:** rebase rung with test gate (tests-green does not prove no stale/duplicated code); raw rebase acceptance; skip-and-continue on re-run failure

## ADR-015 — Stale fork-base branches always route to the heal ladder — clean cherry-picks prove nothing
_2026-06-11_

**Why:** Only the integrator advances HEAD, so HEAD at integration time IS the correct fork base; merge-base(HEAD, branch) != HEAD means stale. Phase-04 showed auto-merge can stack duplicate code with zero conflict markers, so textual cleanliness never overrides staleness

**Rejected:** cherry-pick stale branches behind a test gate; warn-only advisories; threading expected-base SHAs through the script

## ADR-016 — File-ownership enforcement is hard only on intra-wave collision
_2026-06-11_

**Why:** Overflow into a file claimed by another task in the same wave is the real co-scheduling hazard and routes to the heal ladder; overflow into unclaimed files integrates with a named warning advisory plus the wave test gate (legitimate out-of-file fixes like phase-04 t14 must not be rejected)

**Rejected:** blanket-hard enforcement (rejects legitimate fixes); warn-only (leaves the phase-04 t5 hazard open)

## ADR-017 — Task commits stamp '(phase NN tK)' in the subject; a found stamp means done on re-run
_2026-06-12_

**Why:** Codifies the suffix executors already converged on (visible in oneline logs, plain-grep matchable, retroactively compatible with pre-feature phases); Discover checks stamps and skips done tasks so /astro-execute is resumable, with the end-of-phase verifier as the backstop for wrongly-skipped work and a missing stamp merely re-running the task (safe-over-fast)

**Rejected:** git trailers (invisible in oneline, no retro match); pre-flight suite or file-touch checks before trusting a stamp

## ADR-018 — RED-test tasks never statically import missing symbols — dynamic-import is the canonical test-first pattern
_2026-06-12_

**Why:** A static import of a not-yet-existing export crashes the whole test file at module load, pushing executors to implement the export and overflow their declared file (the phase-04 t5 trap); await import inside async tests fails only the new tests at call time, preserving test-first cadence and one-file ownership. Test-after serialization stays allowed when explicitly chosen

**Rejected:** test tasks declaring the impl file (blurs ownership); abandoning test-first

## ADR-019 — Worktree-hostile environments: honor use_worktrees + adaptive sequential downgrade
_2026-06-15_

**Why:** The harness creates one git worktree per parallel agent; under wide waves the concurrent 'git worktree add' calls lose a lock race so a majority fail with 'not in a git repository' while a few succeed. The execute-phase workflow now (1) honors config.use_worktrees=false via args to force sequential up front, and (2) latches a sequential downgrade for the rest of a run once a parallel wave shows majority worktree failure — so the failure noise happens at most once and correctness (on-branch commits) is always preserved

**Rejected:** leaving use_worktrees as dead config; per-wave re-run only (repeats the failure noise every wave); throttling the harness's worktree creation (not controllable from the script)

## ADR-020 — M3 'trustworthy self-judgment' opened for the verify-hardening directive; P9 hardens astro-verify (goal-derived criteria + adversarial verification), P10 (per-phase effort dial) is QUEUED and must not start until P9 is accepted
_2026-07-11_

**Why:** Terminal-Bench 2.0 finding: internal verify PASSed work ground-truth scored 0.0; in real projects there is no external verifier so false-PASS silently ships broken work

