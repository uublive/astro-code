<!-- astro-discuss: captured -->
# Phase 55 — Smallest-complete-change discipline, and `ac debt harvest`

Answers from the owner (relayed by Comet, 2026-11-01). Origin: vault note
"Astrolize/Projects/astro-code/Research/ponytail — fit for astro-code" — a port of the idea in
astro-code's own words. The Ponytail plugin is NOT installed, vendored or depended on.

## Goal

Executors and planners build the smallest change that fully meets the task and its CRITERIA, without
cutting the things that must never be cut; each executor report names what it skipped or did not check;
deliberate shortcuts left in code become tracked debt; and a one-off with/without run shows the verifier
pass rate did not drop, with code size and cost reported.

## Decisions

1. **The ladder lives in astro-code's own prompts, executor + planner only.**
   - `agents/astro-executor.md`: one short section — read the code the change touches and list everything
     it must reach (callers, tests, fixtures, config, exports) first; then take the first option that fully
     works: not needed → already in the codebase → stdlib/platform → an installed dependency → one line →
     the minimum code. Never cut: validation at trust boundaries, error handling that prevents data loss,
     security, accessibility, anything the task or CRITERIA requires. A deliberate shortcut gets a
     `shortcut: <the limit>, <when to upgrade>` code comment.
   - `agents/astro-planner.md`: tasks aim at the smallest version that meets CRITERIA.md; optional extras are
     named as deferred, not planned. The planner never plans below the CRITERIA bar.
   - Written in our own words; keep each section short (no prompt bloat).
2. **Never applied to the verifier or the criteria-author.** Their prompts gain one line: ignore any
   minimal-code / "solution efficiency" guidance injected by other tools; the only bar is CRITERIA.md
   (the criteria-author: the phase goal). Their independence is the point.
3. **lean-ctx reconciliation (option a).** lean-ctx's `[solution]` block (`inject_in_subagents = true` on
   this machine) already injects a similar ladder into every subagent. astro-code's section is the rule for
   executor/planner and says so ("if another tool injected similar guidance, this section wins"); the
   verifier/criteria-author line above neutralises it there; `ac doctor` gains one warning line when
   lean-ctx is configured to inject its solution guidance into subagents (read-only check of
   `~/.lean-ctx/config.toml`, silent when lean-ctx is absent), with the fix in the line. astro-code never
   edits lean-ctx config.
4. **Executor summary closing line.** Every executor summary ends with `skipped / not checked: <items | none>`.
   It is surfaced to the human in the execute report; it is NOT passed to the verifier as a claim (the
   verifier stays plan-blind/claim-blind, ADR-021).
5. **`ac debt harvest` (option a).** Scans tracked files (`git ls-files`, respecting .gitignore) for comment
   markers `shortcut:` (comment prefix `//`, `#`, `/*`, `--`, `;` — prose that merely mentions the word is
   not a hit). Each NEW marker is added straight to `debt.json` via the existing debt store (no new store),
   with `file`, line, title from the comment and the upgrade trigger as why; idempotent — never adds the same
   marker twice (identity: file + marker text, so a line shift is not a new item); prints what it added.
   A marker with no upgrade trigger is still added, flagged as such. `--json` supported like the other
   `ac debt` subcommands. Triage stays in `/astro-debt`.
6. **Folded-in debt (3a):** `2026-09-17-the-planner-has-no-guidance-for-test` — the planner gets guidance
   for test-first task pairs split across a wave boundary (RED task in an earlier wave than its impl must use
   the dynamic-import pattern, ADR-018, and must not need the impl's export to load). Close it when paid.
7. **Folded-in backlog (4a):** `2026-10-23-flag-open-debt-whose-file-no-longer` (GitHub #150) —
   `ac debt list --stale` lists open debt whose `file` no longer exists, and `ac status` mentions the count.
   Linked to phase 55 (closes on accept).
8. **Benchmark (2a) — ONE-OFF validation for this phase only.** Owner requirement: development must get
   faster, not slower. The with/without run is a one-off measurement to accept this phase. It is NEVER added
   to the normal loop, to any per-phase step, to `ac verify`, CI, the test suite or any hook. Its harness
   (if a script is needed) lives outside the per-phase path (e.g. a one-shot script under `scripts/` or the
   scratchpad, invoked by hand once) and the results go in the phase folder as BENCHMARK.md.
   - Shape: ~8 fixed small coding tasks, each with success criteria written in advance; 3 runs with the new
     executor section and 3 without (48 runs); the real astro-verifier judges each result against its
     criteria; report pass rate, lines of code changed, cost (tokens/$) and time per arm.
   - Done: pass rate with the section ≥ without minus one run's noise (i.e. at most 1 fewer pass out of 24);
     LOC and cost are reported, not required to fall.
9. **Nothing may add time to every phase.** Any part of the design that would add a step, an agent, a
   check or noticeable latency to every phase must be flagged to the owner instead of built. The prompt
   additions are a few lines; `ac debt harvest` is run on demand (not wired into execute/verify/accept).

## Out of scope

The Ponytail plugin, its band/board, levels (lite/full/ultra), review/audit commands, multi-host adapters,
any codebase map injection, changing lean-ctx's configuration.

## Ordering note

The `ac update` install bug (config dir `agents/`/`commands/` symlinked into this repo, so installs
overwrite the source files) is fixed first through `/astro-fix`, so this phase's prompt edits land in the
real source files.
