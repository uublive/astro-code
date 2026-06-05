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

