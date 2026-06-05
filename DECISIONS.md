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

