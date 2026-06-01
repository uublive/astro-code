# astro-code

A lean, multi-developer, **Claude Code 4.8-native** evolution of [GSD](https://github.com/glittercowboy/get-shit-done).

It keeps what makes GSD work — file-based planning, milestones/phases/roadmap, the
discuss → plan → execute → verify loop — and makes it **fast** and **collaborative**:

- 🧩 **Tiny core.** One zero-dependency Node CLI (`ac`) owns state. Everything else
  is short markdown commands/agents plus Workflow scripts Claude Code runs. No build
  step, no 68 KB monolith, no per-runtime installer to maintain.
- ⚡ **Parallel by default.** Phases plan and execute by fanning out many agents
  through Claude Code 4.8's **Workflow** tool — wave-based execution, one isolated git
  worktree per task.
- 👥 **Collision-proof numbering.** Milestone/phase numbers are allocated from a
  shared registry on an **orphan branch on origin**, in pure git. Two developers on
  the same project can never grab the same number — claim phase 8 when it's taken and
  you get 9, automatically.
- 🎛️ **Per-role model tiers.** Pick which model (opus/sonnet/haiku) runs each role
  (planner, researcher, executor, verifier) in `.planning/config.json`.

Requires **Node ≥ 22**. No other dependencies.

---

## Install (for you and your team)

```bash
git clone <astro-code repo url>
cd astro-code
npm install -g .     # puts `ac` on your PATH globally
ac install           # copies the slash commands + agents into ~/.claude
```

`ac install` is idempotent; re-run it after pulling updates. `ac uninstall` removes
the installed files. Because `ac` resolves its own framework directory, the workflow
scripts are found automatically from any project (`ac path workflows`).

> No npm registry needed — `npm install -g .` installs straight from the clone. To
> update: `git pull && npm install -g . && ac install`.

---

## The loop

Run these inside the project repo you're building (it should have an `origin` remote
so numbering is coordinated across the team).

```
/astro-new-project        scaffold .planning/, shape PROJECT.md + the initial roadmap
/astro-phase <name>       add a phase (claims its number from the registry)
/astro-plan <phase>       parallel research → executable PLAN.md
/astro-execute <phase>    wave-based parallel execution in isolated worktrees, then verify
/astro-verify <phase>     confirm the phase goal is actually met (goal-backward)
/astro-milestone          start the next milestone cycle (claims the milestone number)
/astro-complete-milestone archive the finished milestone + retire its numbers
/astro-status             where am I, and what's the best next move?
```

You can also drive the state layer directly with the CLI:

```bash
ac init --name my-project --vision "what we're building"
ac phase add "Foundation"      # claim + add a phase
ac status                      # project / milestone / phases
ac roadmap list                # the structured roadmap
ac registry show               # the shared numbering registry
ac milestone complete          # archive the current milestone
```

`ac help` lists everything.

---

## How numbering stays collision-proof

The registry is a single `registry.json` on an orphan branch (`astro-registry` by
default) on the project's `origin`. A claim is an atomic compare-and-swap done
entirely with git plumbing — no server, no lock files, no `gh`:

```
read   git fetch astro-registry → git show FETCH_HEAD:registry.json   (tip = T)
build  next = max(active claims of this type [+ milestone]) + 1
write  hash-object → mktree → commit-tree -p T → push commit:refs/heads/astro-registry
```

The push is a normal (non-force) fast-forward. If another developer claimed a number
meanwhile, the remote tip moved past `T`, the push is **rejected**, and `ac` re-reads
and recomputes the next free number. That rejection *is* the mutual exclusion.

Numbering is enforced **through the CLI** (`ac phase add` / `ac milestone new`), not
by hand-editing `ROADMAP.md` (which is generated). When there's no remote, `ac` falls
back to local numbering and warns that it isn't team-coordinated.

---

## Choosing models

`.planning/config.json` carries per-role model tiers. Unset a role to inherit the
session model.

```jsonc
"models": {
  "planner":   "opus",    // synthesizes the plan — quality matters most
  "researcher":"sonnet",  // parallel investigation
  "executor":  "sonnet",  // implements one task each
  "verifier":  "opus",    // goal-backward verification — be strict
  "discover":  "haiku"    // cheap mechanical task/dependency parsing
}
```

Change one without clobbering the rest:

```bash
ac config get models
ac config set models.executor opus      # max quality everywhere
ac config set models.researcher haiku   # cheaper/faster research
```

The plan/execute commands read this map and pass it to the Workflow, which applies
the tier per agent. See **Which models?** in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Layout

```
bin/ac.mjs       the CLI
lib/             engine (registry, state, roadmap, milestone, config, install) — unit-tested
commands/        Claude Code slash commands (the loop)
agents/          subagent role definitions
workflows/       Workflow 4.8 scripts (parallel plan + wave execution)
templates/       .planning/ scaffolding
tests/           node:test — engine units + a real git registry integration test
```

## Development

```bash
npm test     # 15 tests: engine units + a real bare-remote registry integration test
```

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design, the speed rationale,
and the MCP/model decisions.
