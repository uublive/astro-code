# astro-code

## Vision

A lean, multi-developer, Claude-Code-4.8-native planning & execution framework — the
evolution of GSD. It runs a `discuss → plan → execute → verify → accept` loop over
milestones and phases, keeps **all state as plain files in the repo**, and adds real
multi-agent parallelism plus collision-proof cross-developer coordination. The `ac` CLI
owns deterministic state; the "thinking" lives in markdown commands/agents and Workflow
scripts that Claude Code runs in isolated contexts — so the main session stays lean and
`/clear`-safe. Consistency comes from a prescriptive **canon** (conventions + decisions)
injected into every agent, not from a maintained codebase map.

## Milestone 2 — Self-healing parallel-wave integration

Make parallel-wave execution recover from its own failure modes instead of stranding
conflicted `worktree-*` branches on the user (the phase-04 incident; full analysis in
`todo.md` → "Self-healing parallel-wave integration"). Strengthens REQ-005. Goals:
the integrator heals conflicts via a fallback ladder (rebase → drop-and-rerun
sequentially at the integrated tip → only then fail), stale fork bases and
out-of-declared-file commits are detected rather than trusted, `/astro-execute`
re-runs are idempotent (done-detection from task-id commit stamps), and the planner
stops emitting test-first task splits that force executors to overflow their files.

## Requirements

<!-- One line per requirement. Use stable IDs (REQ-001) so phases can map to them. -->

- REQ-001 Dependency-free substrate: ESM `.mjs`, Node ≥ 22, `node:` builtins only — no
  build step, no runtime/dev deps.
- REQ-002 Plain-file state under `.astrocode/`, mutated only through lock-guarded `lib/`
  helpers; `ROADMAP.md` is generated, never source of truth.
- REQ-003 Collision-proof cross-developer coordination via an orphan-branch git
  compare-and-swap (`lib/shared.mjs` `transact`) — project-global numbering, shared
  decisions, no server, no `gh`.
- REQ-004 Multi-surface invocation: `ac` CLI, slash commands, Workflow-tool scripts,
  and subagents — each command degrades gracefully (Workflow → Agent → inline).
- REQ-005 Safe parallel execution: dependency waves + file-disjointness guard, worktree
  isolation, a sole git-actor integrator, and goal-backward verification.
- REQ-006 Two-gate phase closure: AI verifier reaches `verified` at best; only human
  `/astro-accept` reaches `complete`.
- REQ-007 Per-role model tiers (opus/sonnet/haiku) configurable per role.
- REQ-008 Reversible install: copy to `~/.astro/code`, symlink into every Claude profile,
  additively wire `settings.json` (skip unparseable rather than clobber).

## Constraints

- No runtime or dev dependencies; no build/transpile step. ESM only, Node ≥ 22.
- Git CLI only (never `gh`) so the registry works on any remote.
- The orphan-branch CAS is inviolable: non-force push, retry-on-reject, preserve sibling
  files, phase numbers project-global (never restart per milestone).
- The framework dogfoods itself — this repo is also an astro-code project.

## Out of scope

- A maintained always-on codebase map (a stale map is worse than none; the mapper runs
  on-demand for adopt only).
- Server-side coordination, hosted state, or any non-git transport for shared state.
