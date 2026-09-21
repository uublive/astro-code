# Conventions — astro-code

> The rules new code MUST follow. Keep this short and current — every planning and
> execution agent reads it before touching code. Vague canon = inconsistent code.

## Stack

- Language / runtime: Node.js **≥ 22**, **ESM only** (`"type": "module"`, every file `.mjs`).
- Frameworks / key libraries: **None.** Zero runtime deps, zero dev deps. `node:`
  builtins only (`fs`, `child_process`, `path`, `url`, `os`); tests use builtin `node:test`.
- Why this stack (one line): a lean, dependency-free substrate that Claude Code 4.8
  runs directly — no build step, no transpile, no bundler.

## Naming

- Files / modules: `lib/` modules are lowercase single-word (`registry.mjs`, `canon.mjs`,
  `shared.mjs`). Commands and agents are `astro-*` kebab-case (`astro-execute.md`,
  `astro-executor.md`). Workflow scripts are `*-phase.mjs`.
- Functions / variables: **named function exports only** — no classes, no default
  exports. Small pure helpers + `async` functions that wrap mutations in `withLock`.
  camelCase functions; `findRoot`, `atomicWriteJSON`, `transact`, `claim`.
- Tests: `tests/<area>.test.mjs`; descriptive sentence-form test names that read as the spec.

## Patterns

- Error handling: `die(msg)` for fatal CLI errors (prints `✖`, exits non-zero).
  Status lines use `✓` / `•` / `⚠` / `⊡` glyphs. Machine-readable output via `json()`.
- State / data flow: the `ac` CLI owns all state as plain files under `.astrocode/`
  (`state.json`, `config.json`, `roadmap.json`). **Never hand-edit that JSON in code
  paths** — go through the lock-guarded `update*` helpers in `lib/`. `ROADMAP.md` is
  *generated* (`ac roadmap render`), never a source of truth.
- Async / concurrency: same-machine parallelism is guarded by `withLock` (atomic
  `mkdir` mutex, 10s stale reclaim). Cross-machine/cross-developer safety comes ONLY
  from the orphan-branch git compare-and-swap in `lib/shared.mjs` `transact()` — a
  non-force push whose rejection *is* the mutual exclusion (retry on reject; always
  preserve sibling files in the tree). All numbering, decisions, and shared canon go
  through `transact`. Never reintroduce a silent local-only fallback.
- Config & secrets: `.astrocode/config.json` (`max_concurrent_agents`, `use_worktrees`,
  `registry_branch`/`registry_remote`, per-role `models` tiers). Git CLI only — never
  `gh` — so the registry works on any remote. No secrets in the repo.

## Testing

- Framework: builtin `node:test` + `node:assert/strict`. No mock framework.
- What must be tested: every engine change in `lib/` needs a test. The contract suite
  is `registry.test.mjs` (spins up a **real bare remote + two working copies** to prove
  cross-developer claims never collide). New shared-state behavior extends it.
- Style: real filesystem (`mkdtempSync`) and real git over stubs; behavior-focused;
  `workflows.test.mjs` guards that workflow scripts never shadow a Workflow hook name.

## File layout

- `bin/ac.mjs` — thin CLI dispatcher (`switch (cmd)`); delegates to `lib/`.
- `lib/` — the tested engine, one responsibility per module.
- `commands/*.md` — slash-command orchestration specs (frontmatter + short numbered
  steps); keep the graceful-degradation tiers: Workflow → Agent subagents → inline.
- `agents/*.md` — subagent role defs (researchers/verifier/mapper are read-only).
- `workflows/*.mjs` — Workflow-tool scripts (`phase()`/`agent()`/`parallel()`/`log()`
  hooks; **no semicolons**, Workflow-tool style; args stay small JSON scalars — agents
  read canon/CONTEXT from disk via absolute paths).
- `hooks/`, `templates/` — session hooks and `.astrocode/` scaffolding seeds.

## Voice

### Comments

Comments carry **high, explanatory density** — module headers say *why* and which bug a
choice prevents ("safe over fast", "the milestone-1-twice drift"), not just *what*.
Match this voice; comments are load-bearing here.

### Writing to a human

A report to a human **leads with the change or the decision** and keeps the evidence short
and beneath it.

Every reporting slot in a command states **how much it may emit** — "in one line, naming
the count" — or **when it emits nothing** — "say nothing when there is nothing to report".

The split that makes this decidable: *things that change what the reader does* versus
*evidence that work happened* — cut the second, and say where the full version lives
rather than pasting it. `astro-debt.md`'s "keep each item to its title plus one line of
why — use `ac debt show <id>` for detail" is exactly this shape.

Machine-read artifacts are exempt: `PLAN.md`, `CRITERIA.md`, and a verifier's structured
return and log stay as dense as they need to be — that detail is what catches bugs a
green suite misses.

Free-form narration (prose between tool calls) follows the same rule by convention, but
**nothing checks it**: `tests/commands.test.mjs` asserts that each reporting slot in the
seven loop commands (`discuss`, `plan`, `execute`, `verify`, `accept`, `status`, `debt`)
states a bound — shape only, never quality, never free prose.
