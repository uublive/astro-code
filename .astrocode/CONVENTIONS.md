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
- Wave-green planning (ADR-020): every task must leave the build green on its own,
  because the wave model integrates and gates at every wave boundary. A destructive edit
  (deleting/renaming a module or symbol) and the updates to every consumer it breaks
  (barrel/`index` re-exports, importers, type references) are **one atomic task** that
  declares all those files — never split a deletion from the barrel/import fixups it
  forces, and never lean on `depends_on` ordering to keep an intermediate boundary green.
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

Comments carry **high, explanatory density** — module headers say *why* and which bug a
choice prevents ("safe over fast", "the milestone-1-twice drift"), not just *what*.
Match this voice; comments are load-bearing here.
