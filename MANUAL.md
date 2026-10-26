# astro-code — Manual

The complete reference. For a five-minute orientation, read [`README.md`](./README.md);
for an interactive walkthrough, open the
[field manual](https://claude.ai/code/artifact/80291435-e40c-4029-a933-8fbdf2d69539).
For *why* it is built this way, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

- [Install and hosts](#install-and-hosts)
- [The loop](#the-loop)
- [Two gates close a phase](#two-gates-close-a-phase)
- [Mutation testing (test-strength criteria)](#mutation-testing-test-strength-criteria)
- [Numbering and duplicate detection](#numbering-and-duplicate-detection)
- [Bugs are not phases](#bugs-are-not-phases)
- [Technical debt](#technical-debt)
- [Backlog](#backlog)
- [Principles](#principles)
- [The fast lane](#the-fast-lane)
- [Canon](#canon)
- [Models, thinking and effort](#models-thinking-and-effort)
- [GitFlow branching (opt-in)](#gitflow-branching-opt-in)
- [Astro kits](#astro-kits)
- [External knowledge graph (retired)](#external-knowledge-graph-retired)
- [Command reference](#command-reference)
- [Layout and development](#layout-and-development)

---

## Install and hosts

```bash
git clone git@github.com:uublive/astro-code.git
cd astro-code
npm install -g .     # puts `ac` on your PATH
ac install           # populates ~/.astro/code and publishes to every harness it finds
```

Requires **Node ≥ 22**.

`ac install` keeps the files in `~/.astro/code` and publishes them to **every agent
harness present on the machine**, each in that harness's own format, from one command.
It's idempotent; `ac uninstall` reverses it everywhere.

| Harness | Where | How you invoke a command |
|---|---|---|
| **Claude Code** | symlinked into the base `~/.claude` **and every jean-claude profile** (auto-detected from `~/.claude/.jean-claude/profiles.json`) | `/astro-plan 3` |
| **Codex CLI** | skills under `~/.codex/skills/` | `$astro-plan 3` |
| **Cursor** | commands `~/.cursor/commands/`, agents `~/.cursor/agents/` (`$CURSOR_CONFIG_DIR` honoured) | `/astro-plan 3` |

**Updating** is one command: `/astro-update` (or `ac update`) — it pulls the latest,
refreshes the global CLI, and re-links across every profile. The first time, if it
can't find your clone, run `ac update <path-to-clone>` once and it remembers it. It ends by
running `ac doctor` and printing only what is wrong, nothing when the install is consistent.
`ac --version` prints the version you are running, for a bug report.

### Is the install consistent? `ac doctor`

`ac doctor` (or `/astro-doctor`) reads the install and names every known drift, one line per
problem, each ending with the exact command that fixes it:

```
⚠ claude /home/me/.claude: additionalDirectories does not grant /home/me/.astro/code → ac install  # grants /home/me/.astro/code
```

A consistent install prints one `✓` line and exits 0; any problem exits 1. It never writes
and never repairs: it reads files, spawns no package manager and does not run `claude`.
Only hosts that are installed are reported. The ten checks, by the `id` each row carries:

| id | looks at |
|---|---|
| `version` | the installed version against the clone it came from |
| `update-cache` | the update-check cache: older than 30 days is stale; a missing one is fine |
| `settings` | a `settings.json` (or Cursor `hooks.json`) that is not valid JSON, so its hooks could not be checked |
| `hook-interpreter` | every astro hook command's interpreter exists and runs, per config dir (#126) |
| `hook-registration` | a guard's `ac mods` switch against its registration (switch on but not registered, or registered while off) |
| `hook-script` | every hook script a registration names exists |
| `links` | each host's commands and agents: missing, dangling, or stale `astro-*` entries, including in a Claude dir install no longer targets |
| `grant` | `permissions.additionalDirectories` holds the resolved `ac path` (#15) |
| `registry` | `ac canon check`'s verdict, inside an astro-code project; skipped elsewhere and when the registry is unreachable |
| `plugin` | the astro-mods plugin version Claude Code recorded against astro-code's |

`ac doctor --json` prints the same report as one object per row, `{ id, host, dir, ok, detail,
fix }` (`fix` is set on every failing row): attach it to a bug report. A skipped check is an
`ok: true` row whose `detail` starts `skipped —`. `ac install` records every config dir it
publishes into in `~/.astro/code/published.json`; that is how the doctor finds stale entries in a
dir install no longer targets, so dirs last published into by an earlier version are not seen.

### Letting Claude Code run the shipped workflows

`/astro-plan`, `/astro-execute` and `/astro-fast` run workflow scripts that live in
`~/.astro/code/workflows`, outside your project. Claude Code only reads a `scriptPath`
outside the project when that directory is granted. `ac install` and `ac update` grant it for
you: they add the resolved `ac path` to `permissions.additionalDirectories` in every Claude
config dir's `settings.json`, keeping your own entries, and `ac uninstall` removes exactly that
entry. `ac doctor` flags a profile where it is missing.

To grant it for one project only, put the same entry in that project's
`.claude/settings.local.json`:

```json
{ "permissions": { "additionalDirectories": ["<output of: ac path>"] } }
```

Use what `ac path` prints, not a hand-typed `~/.astro/code`: it resolves symlinks, and
on systems where `/home` is a link (`/var/home` on Fedora Silverblue, Bazzite and other
ostree distros) only the resolved form matches. Don't copy the scripts into the project
instead — a local copy silently goes stale after `ac update`.

### Extra tools for astro-code's agents

Each shipped agent has a fixed `tools:` list, and Claude Code enforces it, so an astro agent
can't call an MCP tool astro-code didn't list, such as lean-ctx's read-only `ctx_read`.

**The easy way: `/astro-config tools`.** It lists the MCP servers your session actually has,
recommends their read-only tools, asks which agents get them, and applies your choice. You
never type a tool name. From a shell, `ac agent-tools` does the same by hand:

```bash
ac agent-tools                                   # what each agent gets now (--json too)
ac agent-tools add '*' mcp__lean-ctx__ctx_read   # every agent; or name one, e.g. astro-executor
ac agent-tools remove '*' mcp__lean-ctx__ctx_read
ac agent-tools clear                             # drop them all
```

Each change is validated, keeps every other key in the file, and is applied to the installed
agents at once. Restart a Claude Code session that is already running to pick it up.
Underneath, it is one key in **`~/.astro/config.json`**:

```json
{ "agent_tools": {
    "*": ["mcp__lean-ctx__ctx_read", "mcp__lean-ctx__ctx_search", "mcp__lean-ctx__ctx_tree", "mcp__lean-ctx__ctx_glob"],
    "astro-executor": ["mcp__lean-ctx__ctx_edit"]
} }
```

`ac install` and `ac update` merge them into each agent's `tools:` line every time, so the
setting survives updates where a hand edit would not. It's per user, not per project,
because the agents are installed once per machine. Only MCP tool names (`mcp__<server>` or
`mcp__<server>__<tool>`) are accepted, so a role's built-in permissions stay as designed:
the verifier can't be given `Write` this way. A bad entry is reported and skipped; it never
breaks an install. A config dir whose `agents/` *is* the source checkout (a self-hosted dev
setup) reads the shipped files directly, and `ac install` says so.

### Enforcement mods (optional, Claude Code)

astro-mods is an optional layer that *enforces* rules the canon already states, such as keeping
the verifier plan-blind or refusing an unscoped destructive `git` command. It is **off by
default**, one switch per feature, and nothing in the loop depends on it: no command or agent
needs it, and on Codex, Cursor or a Claude Code without the plugin everything works as before
(ADR-071). If a mod fails, it lets the action through and says so once.

| feature | kind | lands in | does |
|---|---|---|---|
| `canon-guard` | hook | phase 37 (built) | refuse hand edits to generated and registry-owned state |
| `git-guard` | hook | phase 38 (built) | refuse unscoped destructive git in the shared tree |
| `blindfold` | mod | phase 39 (built) | keep the verifier and criteria-author plan-blind |
| `spawn-policy` | mod | phase 40 | refuse a parallel executor spawned without worktree isolation (ADR-008) |
| `witness` | mod | phase 41 (built) | tell a human acceptance from an agent's |
| `brief-section` | mod | phase 42 (built) | principles brief as one cached system-prompt section |
| `phase-band` | mod | phase 43 (built) | phase band with next-command buttons and id autocomplete |
| `live-capture` | mod | phase 44 (built) | offer principle capture from human-typed prompts |

`canon-guard`, `git-guard`, `blindfold`, `witness`, `brief-section`, `phase-band` and
`live-capture` are built; `spawn-policy` is **not built yet** (parked): today you can switch it on and
`ac` records it, and it takes effect when it lands. A `hook` is a plain settings hook
(Cursor imports it too); a `mod` is part of the `astro-mods` Claude Code plugin.

**canon-guard** refuses hand edits to files the `ac` CLI owns or generates. The deny reason is two
lines: the `ac` verb to use for that file (with the rule's source as a short tag), then the escapes:

- Protected: `.astrocode/{roadmap,state,debt,backlog,fixes}.json`, `.astrocode/ROADMAP.md`,
  `.astrocode/DECISIONS.in-force.md`, and the personal principle store (`~/.astro/principles/`).
  `config.json`, `CONVENTIONS.md`, `DECISIONS.md`, `PROJECT.md` and phase files stay editable.
- Tools: Write, Edit, MultiEdit and NotebookEdit always; Bash for the obvious write forms
  (`>`, `>>`, `sed -i`, `perl -i`, `tee`, `cp`/`mv`/`rm`, `truncate`, `dd of=`), checked segment by
  segment. It is a mistake-catcher, not a sandbox: `python -c` or `node -e` writes, globs and
  variables are not seen, and an `ac` or `git` segment is never refused.
- Escapes: a protected file that is mid-merge (conflict markers, or unmerged in `git status`) may be
  edited by hand; for anything else run `ac mods disable canon-guard`, edit, then re-enable. There
  is no environment-variable escape.
- Where it is enforced: every Claude Code profile (a settings hook); on Cursor, a native
  `preToolUse` hook when Claude Code is absent, or Claude's own entry through Cursor's import when
  it is present; Codex has no hooks, so there it stays a prose rule. `ac mods status canon-guard`
  shows each place and whether the entry is really there.
- The switch is the registration: `ac mods enable canon-guard` writes the entry into each profile,
  `disable` removes exactly it, and `ac install` / `ac update` re-sync the entries to the switch (a
  profile added later gets it; a stale entry is removed).

**git-guard** refuses unscoped destructive git, the rule ADR-035 and ADR-038 put in every
executor prompt. The refusal reason is two plain lines: what the command would do (e.g. "throws away
every uncommitted change in the repo"), then the scoped alternative and the off switch:

- Refused: `git stash` with no `-- <path>` pathspec (bare, `-u`/`-a`/`-k`, `save`, `push` without
  `--`), `git clean` unless `-n`/`--dry-run`, `git reset --hard`, and a whole-tree
  `git checkout`/`git restore` (`.`, `-- .`, `HEAD -- .`, `--staged .`). The same in an agent
  worktree: the stash stack is repository-wide.
- Allowed: `git stash push -- <path>…`, `stash pop|apply|list|show|drop`, `git clean -n`, every other
  `reset`, path-scoped `checkout`/`restore`, and all other git (force push, `branch -D` and
  `worktree remove --force` are out of scope without an ADR).
- Parsing: a mistake-catcher, not a sandbox. Compound commands, `cd`/env/`command`/`exec`/`sudo`
  prefixes, `git -C/-c/--git-dir`, `sh -c`/`bash -c`, `<(…)` and the lean-ctx `-c` wrapper are seen;
  scripts, a subcommand that is an expansion (`git $SUB`), a shell fed on stdin, nesting three
  shells deep and lean-ctx's `ctx_shell` are not, and those run. A git command merely quoted
  in `echo`, `grep` or a commit message never trips it. A variable set once in the same command to
  a plain path (`F=src/a.js; …; git checkout -- $F`) is read as that path, a loop over plain paths
  (`for f in a.md b.md; do …; git checkout -- $f; done`) is judged path by path, and a glob below a named
  folder (`git checkout src/components/*.css`) counts as scoped; any other expansion in a destructive call is refused.
- Not refused when nothing can be lost. A refused call goes through when git, asked
  read-only, shows it would destroy nothing: no uncommitted change for `reset --hard` (bare or to
  `HEAD` only; a reset to another commit can drop commits), `stash`, a whole-tree
  `checkout`/`restore` or `-f`; no untracked file for `git clean` (no ignored file either with
  `-x`/`-X`). The same holds for a scratch repo whose git data lives under the temp directory
  (`TMPDIR`, else `/tmp`), or whose `.git` holds an `astrocode-scratch` file: a throwaway copy that must
  live where the host can see it is marked on purpose (`touch .git/astrocode-scratch`, which the
  verifier does for its probe copies). A worktree of a real project still counts as the project.
  Only the plain shape qualifies, `git <subcommand> …` alone or after literal assignments and
  `cd <literal path>` segments, optionally inside one `lean-ctx -c`/`bash -c`. In a scratch repo the
  segments after it may run too (a probe resets, then runs its test), unless one is refused itself; with
  prefixes, global options, other segments, unreadable words, or git not answering, it is refused.
- Verdict: it **denies**, on Claude Code and Cursor alike, and never asks (ADR-082). An ask from
  a Workflow agent waits for you, so an unattended run stalled until you came back; a deny
  reaches the agent at once with the scoped form to use instead. `ac mods status` says
  `denies` per place.
- Escapes: run the command yourself if you meant it (`! <command>` in the prompt), or
  `ac mods disable git-guard`. There is no environment-variable escape.
- Where it is enforced, and the re-sync on `ac install` / `ac update`: as for canon-guard.
- Not seen: `ac`'s and the workflow's own git calls run through `child_process`, not the Bash tool.
  That is why `NO_BROAD_STASH` stays in the prompts.

**brief-section** puts the principles brief in front of the model once, as a single cached
system-prompt section, instead of as four SessionStart hook outputs plus a PreCompact note.
`ac mods enable brief-section` turns it on; `ac mods disable brief-section` puts everything back.

- On Claude Code: at session start the mod reads the brief (`ac principles brief`) and a one-line
  position (milestone, phase, state, next command) through `ac`, and appends them as one section
  that is cached with the system prompt and survives `/compact` and `/clear`. The brief is read at
  each session start and again on a compaction or `/clear` (so it follows the store); the position line changes only when the project state really changes, so the cache is
  not broken between turns.
- No second copy: the mod drops the SessionStart brief parts and the PreCompact position note when
  they are exactly what the hooks print (`ac mods feed brief-section` says what that is). The update
  banner and any other tool's hook output are never touched, and no hook entry in `settings.json` is
  edited. `ac install` installs the astro-mods plugin with every mod off (ADR-075), and Claude Code
  records that in `extraKnownMarketplaces` and `enabledPlugins`; `ac mods enable` and `disable`
  leave the file unchanged.
- If `ac` cannot build the brief, the mod adds no section, drops nothing and tells you once, so the
  session gets the hooks' brief as before.
- Cursor and Codex are unchanged: they keep the four hook parts. The `principles.sessionBrief: false`
  opt-out in `~/.astro/config.json` is honoured: with it set the mod adds nothing.
- A section has no 10,000-character cap, so a large brief costs its full size in every session's
  cached prompt; check it with `ac principles brief | wc -c`.

**blindfold** keeps the two plan-blind agents plan-blind, the rule ADR-021 and the agents' own prose
already state. Optionally, on Claude Code, `ac mods enable blindfold` enforces it per agent:

- Who it binds: `astro-verifier` (denied `PLAN.md`, `SPEC.md`) and `astro-criteria-author` (denied
  `PLAN.md`, `ACCEPTANCE.md`, `SPEC.md`). Nobody else: executors, planners, researchers, workflow
  agents, other agent types and the main session read the plan as before. An agent the plugin did not
  see being spawned is not identified, and an unidentified agent is allowed.
- Which files: those names, any letter case, inside any `.astrocode/phases/<dir>/`. A `PLAN.md`
  elsewhere (say `docs/PLAN.md`) is not a phase plan and stays readable; so do `CRITERIA.md`,
  `CONTEXT.md`, the canon, source and tests.
- Tools: Read, Edit and anything with a `file_path` or `notebook_path`; Bash commands that name a
  forbidden file (`cat`, `head`, `sed`, `grep`, `cp`, `git show HEAD:…`, a `cd` into the phase dir
  then a bare name, `bash -c '…'`, the lean-ctx `-c` wrapper); Grep, Glob and recursive shell searches
  (`grep -r`, `rg`, `ag`, `ack`, `fd`, `find`, `git grep`) whose root can reach `.astrocode/phases`.
- Narrowing: a search is allowed when it cannot select a forbidden file, such as a `glob` of `*.mjs`,
  a path outside the phases tree, a non-markdown `--type`, or an exclusion of `.astrocode`.
- Verdict: **deny, not ask**. A subagent cannot answer a prompt, and a Workflow agent never could. The
  reason quotes ADR-021 and the agent's own line, names the refused file and points at `CRITERIA.md`;
  it does not say how to switch the guard off, which is for you (`ac mods disable blindfold`).
- Fail open: if the plugin breaks, the action goes through, you get one notice, and every mod is off
  until the next session.
- Not seen (a mistake-catcher, not a sandbox): `$(…)`, backticks, `eval`, `xargs`, `python -c` or
  `node -e` reads; symlinks; a search rooted at a worktree the plugin cannot place; MCP search tools
  with no `path` or `command`.
- Reload: the plugin reads the switch at session start, so run `/reload-plugins` after
  `ac mods enable|disable blindfold`. Agents already running when it reloads are not identified.
- Codex and Cursor keep the prose rule in the agent files; the mod is Claude Code only.

**witness** records whether a gate was accepted by the human typing it. Optionally, on Claude Code,
`ac mods enable witness`:

- What counts as human: a main-loop `ac phase accept|reject` or `ac fix accept` whose ref matches the
  gate command the human typed in the composer this turn (`/astro-accept <n>`, `/astro-fix-accept <id>`).
  The gate table is `hooks/lib/gates.js` in the astro-mods plugin; it is not copied here.
- Rewrite, never block: a typed gate gets `--witnessed composer`; any other gate call gets
  `--agent claude` and any `--witnessed` the model supplied is stripped. A call that already says
  `--agent` is left as is. A command that names a gate only inside quoted text nothing can run
  (`echo "…"`, a `grep` pattern, a commit message) is a mention and is left exactly as written.
- The turn: who started it. A prompt the engine delivers into the running turn (a background
  task's notification, a peer's message, text typed mid-turn) does not start a new one, so a
  typed `/astro-discuss <n>` or `/astro-accept <n>` stays witnessed while a workflow finishes.
- `accepted_evidence`: `--witnessed composer` is stored as `accepted_evidence: "composer"`
  (`ac phase show <n> --json`). `ac` never detects; it records what the caller declares.
- Citing a decision made elsewhere: a gate (`ac phase accept|reject`, `ac fix accept`) takes
  `--evidence "<id or URL>"` (one line, at most 200 characters), stored as `cited_evidence` beside the
  record and shown by `ac phase show` and `ac fix list --all`. It is a citation, never a signer: it
  does not make the acceptance human (ADR-081), works with the mod off, and combines with `--agent` or
  `--witnessed composer`, which keep their own meaning.
- Machine-typed prompts: a prompt (or typed slash command) that starts with one of your
  `mods.machinePrefixes` (see the switches paragraph below) is a tool's, not yours, so a gate in that turn is
  signed `--agent claude` and a human CONTEXT.md marker becomes the agent marker.
- A `--witnessed` with no known turn (a fresh session, a reload, a typed gate with no id) is dropped; the call
  is otherwise left as declared. A gate verb held in a shell variable (`V=accept; ac phase $V 41`) and a Bash
  write of the human CONTEXT.md marker (`printf … >`, `sed -i`, a heredoc) are judged like their direct forms.
  A Bash call that can write a phase CONTEXT.md it names is also judged by its effect: if line 1 becomes the
  human marker during it, witness sets line 1 to the agent marker afterwards (the call's exit status is kept).
  Where splicing `--agent` into the text can miss (a verb in a variable, a nested `bash -c`, `eval`, `xargs`),
  witness also puts `export ASTRO_SIGNER_AGENT=claude;` in front: `ac` reads it as `--agent claude` on any gate
  call that names neither `--agent` nor `--witnessed`, so a nested call is signed however it is quoted. The
  variable can only make a signer an agent, never a human. Likewise, a call it cannot read that mentions
  `--witnessed` (which witness never adds there) gets `export ASTRO_WITNESS_DROP=1;`, and `ac` then ignores
  the flag however it is quoted.
- Fail open: an unknown turn, an empty typed id or a command it cannot parse is left declared, with
  one notice.
- Known gaps: a typed `! ac phase accept <n>` line (the host shows it to no hook, so it is never
  witnessed; use the slash command), MCP shell tools (`ctx_shell`), an `ac` alias or script, a subagent's call (never
  witnessed), and Remote Control (`bridge`, counts as no signal so it is recorded as agent). The UAT
  question's answer is not attestable (phase 41 `PROBE.md`). A CONTEXT.md path held in a variable or reached by
  a `cd` and a bare `CONTEXT.md` gets no effect check, and a verb fed through `xargs` stdin or a script is not
  read: witness is a record, not a sandbox (ADR-074).

**phase-band** draws a quiet band above the prompt in an astro-code project, and offers ids as you
type. Optionally, on Claude Code, `ac mods enable phase-band` (off by default; headless `-p` and any
directory outside an astro-code project draw nothing):

- The band, under a full-width `── ✦ astro-code ──── M<n> ▰▰▱▱▱ 3/5 ──` banner:
  - `ROADMAP`: every phase of the milestone as a chip, `✓` done, `◉` verified (waiting for your
    accept), `▸` planned, `◌` discussed, `○` to do, `✗` rejected, `⚙` being executed, `✎` being
    planned; the current phase is underlined, and more than three finished phases fold into `✓ N done`.
  - `RUNNING` (only while something runs): each astro-code workflow in flight with its live crew,
    for example `⚙ execute 110 · 3 executors   ✎ plan 112 · 2 researchers`. A run starts at its
    Workflow call, each agent it starts joins its crew and leaves when it finishes, and the run
    leaves the row when its task notification arrives. An Agent-tool `astro-executor` or
    `astro-verifier` is listed with its state; with nothing tracked, `ac`'s activity text shows.
  - `NEXT`: up to three buttons, the next command that `ac status` recommends first and at most
    two siblings. A phase already being executed or planned is not offered again; a next command
    that names no phase, such as `/astro-milestone`, shows as `next › /astro-milestone`.
- A button only **fills the composer**; you press Enter. It never submits or runs anything, so an
  accept started from a button is still typed by you.
- Autocomplete: after `/astro-discuss`, `/astro-plan`, `/astro-execute`, `/astro-verify` and
  `/astro-accept` it offers phase numbers with their state; after `/astro-debt-pay`,
  `/astro-backlog-promote` and `/astro-fix-accept` it offers the open ids with short titles.
  Rows appear once you type the first character of the id.
- Reads only: `ac status --json` and the `debt`, `backlog` and `fix` `list --json` queries, re-read
  when something under `.astrocode/` changed and kept in session memory, never on disk. If `ac`
  fails it shows one dim "unavailable" line and no buttons.

**live-capture** offers to capture a principle from what you type. Optionally, on Claude Code,
`ac mods enable live-capture` (off by default, because it costs one Haiku call per typed prompt):

- What it reads: only a prompt you typed at the composer. Slash commands and their expanded
  bodies, `-p`/SDK input, notifications, assistant text and tool output are never looked at.
- Privacy: the text you typed goes to a Haiku judge, as it already went to the main model. On a
  local model, which serves no Haiku, the session's own model judges instead. The personal store redacts the statement, why and excerpt before anything is written.
- Where proposals go: the personal principle store, as *proposed* only (never accepted by the
  mod). Review them with `/astro-principles-review` or `ac principles list --proposed`.
- Volume: at most three proposals per session; sightings of existing principles do not count and
  reaching the cap is silent.
- The quiet count: `N proposed — /astro-principles-review` shows once at the first turn end after
  the count rises, or in the phase band when that is drawing; never a toast, nothing at zero. A
  failure gives at most one `⚠ principle capture failed` line per session and never touches your
  prompt.
- Machine-typed prompts (a tool typing into your session, see the switches paragraph below) are never
  looked at.
- The escape: `ac mods disable live-capture`.
- The rules (gate, lift, kinds, `--from-ref`, reporting) live once in
  `templates/principle-capture.md`; this section does not restate them.

```bash
ac mods                          # every feature: on/off, kind, and whether it can take effect here (--json too)
ac mods status blindfold         # just one
ac mods enable blindfold witness # turn one or more on (`ac install` already installed the plugin, every mod off)
ac mods disable blindfold        # turn one or more off; the plugin stays installed and inert
```

The switches live in **`~/.astro/config.json`** under `mods`, beside `agent_tools`, per user and
not per project (`{ "mods": { "blindfold": true } }`; a missing key is off). `ac mods` is the only
writer; an unparseable file is refused, never overwritten, and an unknown feature name changes
nothing.

Beside the switches, `mods.machinePrefixes: ["[relay] "]` lists strings a tool of yours types at the head
of a prompt. A prompt whose trimmed text starts with one is machine-typed: **witness** never counts it as you
and **live-capture** never reads it. It is per user, a plain case-sensitive prefix match (no regex, so `.*`
is just those two characters), read at session start, so run `/reload-plugins` after a change. A malformed
list (not a list of non-empty strings, over 50 entries or 200 characters) means no prefixes and one `⚠` in
`ac mods status`; nothing else changes.

Mods need **Claude Code 2.1.292 or newer**. On an older (or no) Claude Code, `ac mods enable`
still records the switch and warns once, but installs nothing. The first `mod` you enable adds
a local marketplace called `astro-code` (shipped to `~/.astro/code/mods` by `ac install`) and
installs `astro-mods@astro-code` into **every** Claude config dir `ac install` already covers,
jean-claude profiles included. A different marketplace already named `astro-code` is never
replaced: `ac` reports it with a `fix:` line, namely
`CLAUDE_CONFIG_DIR=<dir> claude plugin marketplace remove astro-code` (without the prefix for the
default dir), and the switch stays recorded. `ac install` only prints a one-line offer, and only
on a qualifying Claude Code. `ac update` refreshes the plugin where it is installed and never
installs it; `ac uninstall` removes the plugin and the marketplace from every dir before it
deletes the astro home. In a session that is already running, `/reload-plugins` picks up a
change.

### What the statusline gauges show

The statusline's four gauges — **ctx** (context fill), **5h** and **7d** (quota windows) and
**cap** (spend cap) — each show their bar, their percent, or both (the default). Pick with
`/astro-config statusline`, or from a shell:

```bash
ac statusline gauges                  # what each gauge shows now
ac statusline gauges 5h percent       # one gauge: ctx | 5h | 7d | cap
ac statusline gauges all both         # every gauge back to the default
```

Width still wins: on a line too narrow for bars every gauge shows its percent, so a gauge set
to `bar` falls back to its number instead of disappearing. Like `agent_tools`, it is per user
and lives in **`~/.astro/config.json`** (`{ "statusline": { "gauges": { "5h": "percent" } } }`).

With the **phase-band** mod drawing above the prompt, the statusline drops what the band shows
(the milestone, the phase track, the phase state, the live verb and the done/verified counts) and
keeps the rest. It does so only when the `phase-band` switch is on *and* the astro-mods plugin is
installed in that Claude profile, so a band that cannot draw never takes the facts with it.
`ac statusline dedupe off` keeps everything on the line; `ac statusline dedupe on` is the default.

**Teammates' phases.** The phase track and the band also show the phases a teammate claimed in
the current milestone, tagged with who: `P84(a)` / `○84(a)` is a phase `alex@…` claimed. The tag
is the first letter of the owner's email, longer only when two teammates would share it (`al`,
`an`). Phases you claimed stay plain. One that is not merged into your roadmap yet is shown dimmed
and is never offered as a next step. They come from your **local copy** of the shared registry
(the `astro-registry` branch of `origin` as of the last fetch, cached in `.astrocode/.local/`), never from the
network, so the bar stays fast and offline; any `ac` claim or a `git fetch` brings in new ones.

### Windows / PowerShell

`ac` is shadowed by PowerShell's built-in `Add-Content` alias (aliases beat external
commands), so typing `ac install` prompts for `Value[0]` instead of running the CLI.
Use the equivalent **`astrocode`** command (`astrocode install`), or bypass the alias
with `ac.cmd install`, or remove it for your session: `Remove-Item Alias:ac`.

Note `ac install` links files with symlinks, which on Windows require Developer Mode or
an elevated shell.

### Using it on Codex

Codex has **no custom slash commands** — `/astro-plan` will not resolve. astro-code's
commands are installed as Codex *skills*, so you invoke them as `$astro-plan` or simply
ask for one by name. The six agents install as subagent skills the loop dispatches.

Two things Codex does not get yet: the **status line / phase track** (Codex requires each
hook to carry a `trusted_hash` in `config.toml`, which astro-code will not forge on your
behalf), and hook-driven session state. Everything else — the full loop, the registry,
worktree-isolated parallel execution — works the same, because the engine is
host-agnostic and `ac` drives the orchestration itself.

### Using it on Cursor

Cursor counts as present when `$CURSOR_CONFIG_DIR` (or `~/.cursor`) exists, or
`cursor-agent` is on `PATH` — install its CLI with `brew install --cask cursor-cli`, never
the curl installer (it overwrites `~/.local/bin/agent`, which is also the name of
astro-agent's own binary). `ac install` publishes commands and agents straight to
`~/.cursor/commands` and `~/.cursor/agents`; each installed command carries a short host
note at the top — no Workflow tool on Cursor, so a step that needs orchestration falls to
subagents, else plain inline work. Agents run on whatever model the Cursor session itself
is using (`model: inherit`); read-only roles (researcher, verifier, mapper, …) are derived
from the source agent's own `tools:` list, not a hard-coded list, and installed with
`readonly: true`. Cursor's CLI only registers subagents found inside the project, so the
installed agent files are *instructions*, not subagent types: the host note tells a
command to run each one in Cursor's built-in `explore` (read-only) or `generalPurpose`
subagent with the file's text as its prompt. The Codex install's skill copies are tagged
`metadata.surfaces: codex`, so Cursor — which also reads `~/.codex/skills` — does not
list every astro-code command a second time.

Hooks and the status line are only wired natively into Cursor's own `hooks.json` /
`cli-config.json` when Claude Code is **absent** on the machine; when Claude Code is
present, Cursor imports its hooks itself, so astro-code leaves Cursor's files alone and
runs there through that import instead — `ac install`/`ac update` say which branch was
taken. Headless: `cursor-agent -p --trust "/astro-status"`.

### Using it on OpenCode

OpenCode counts as present when `$OPENCODE_CONFIG_DIR` (else
`$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`) exists, or `opencode` is on `PATH`.
`ac install` copies commands to `commands/` and agents to `agents/` there. Commands keep
their `/astro-plan 3` form and carry a short host note mapping Claude Code's tools onto
OpenCode's (`subagent`/`task`, `question`, `shell`/`bash`); there is no Workflow tool, so
orchestration falls to subagents, else inline work. Unlike on Cursor, the astro agents are
installed as real subagents (`mode: subagent`) and are dispatched by name.

OpenCode names models `<provider>/<id>`, not `opus`/`sonnet`/`haiku`, so tell astro-code
how your provider spells each tier, in `~/.astro/config.json`:

```json
{
  "models": { "planner": "opus", "researcher": "sonnet", "executor": "haiku", "verifier": "opus" },
  "opencode": {
    "models": {
      "opus": "openrouter/anthropic/claude-opus-5.5",
      "sonnet": "openrouter/anthropic/claude-sonnet-5.5",
      "haiku": "openrouter/anthropic/claude-haiku-5.5"
    }
  }
}
```

Or set those from the CLI, and pin any role to any model your provider serves, whatever its
tier — e.g. DeepSeek for execution:

```bash
ac opencode map opus openrouter/anthropic/claude-opus-5.5     # what a tier means here
ac opencode set executor openrouter/deepseek/deepseek-v4.1-flash   # pin one role
ac opencode unset executor                                     # back to its tier
ac opencode models                                             # what each role runs on
```

Per role: the `opencode.roles` pin, else the role's tier (this project's
`.astrocode/config.json`, then your default) through `opencode.models`, else the session's
model. Like obra/superpowers, the model is chosen **at dispatch time**: each command tells
the controller to run `ac opencode models --json` and pass the role's id as the subagent's
`model`, so a project's own tiers, `ac models <profile>` and `--fast` all apply on the next
run with no reinstall. The agent files are also stamped with your user-level result, as a
fallback (`ac opencode map|set|unset` re-stamps them at once). Both keys are user-level on
purpose — never put a provider id in `.astrocode/config.json`, which Claude teammates share.
A provider id in `.astrocode/config.json` is ignored on purpose; `ac opencode models` says so.
The read-only agents (`astro-verifier`, `astro-researcher`, `astro-mapper`) get a
`permission: edit: deny` block, derived from their source `tools:`.
`/astro-config` walks all of this on OpenCode.

**Not wired on OpenCode yet:** hooks and the status line, and with them the guards —
canon-guard (which protects `VERDICT.json`) and git-guard never run, so nothing blocks a
write the agent decides to make through `shell`. Follow-ups: those plugins, headless
`execCommand`/`parseResult` (`opencode run "/astro-status"` works by hand), and `agent_tools`
MCP extras (ADR-068), which are dropped.

---

## The loop

Everything lives in **`.astrocode/`** in your repo (human-readable, git-committed):
`PROJECT.md`, `ROADMAP.md`, per-phase `CRITERIA.md`/`PLAN.md`/`SUMMARY.md`, plus the canon.

Per phase: `discuss → plan → execute → verify → accept`.

### Discuss before planning

`/astro-discuss` asks adaptive, pick-an-answer questions about scope, approach, and edge
cases, then writes the decisions to the phase's `CONTEXT.md` — which `/astro-plan` reads
and obeys. Optional but recommended; trivial phases can skip it.

It also surfaces open debt touching the files this phase is about to change, because debt
is cheap to pay when you are already in the file.

### Challenge mode

A thorough, opt-in alternative to the quick pick-an-answer interview, for ideas that
deserve a real interrogation before a line of code or a phase number is spent. Four
entry points open it: `/astro-new-project` and `/astro-adopt` offer it right at the start
(quick interview vs. challenge me), `/astro-discuss <phase> --challenge` runs it in place
of the normal discuss step, `/astro-autonomous <phase> --challenge` passes it straight
through to that discuss step, and the standalone `/astro-challenge "<idea>"` runs it
against a backlog item before any phase exists at all.

Every round is numbered plain text (never a picker-only format, so it works on hosts
without one) and is saved to its destination immediately — a `/clear` or a crash loses at
most one round, never the whole session. A discuss session run this way stamps a second
marker line, `<!-- astro-challenge: <rounds> rounds -->`, so a rerun resumes rather than
re-asking what was already settled. On Codex, the round and the round-end checkpoint are
both asked as plain questions instead of a picker — the method is the same either way.

The method itself — round shape, the checkpoint, the rubber-stamp nudge, how open
questions are handled — is written once, in `templates/challenge.md`; every entry point
loads and applies it rather than restating it.

### Plan

`/astro-plan` first has the `astro-criteria-author` agent pre-register goal-derived,
falsifiable success criteria — **before any plan exists**, so the verifier's bar can never
be shaped by the implementation. Then researchers fan out on three angles and a planner
synthesizes an executable, dependency-aware `PLAN.md` plus the acceptance checklist you
will sign against later.

### Execute

`/astro-execute` runs the plan **wave by wave** on the working branch: independent tasks in
parallel, one isolated git worktree each, an integrator landing them. One task, one commit —
so a failed task can be re-run without unpicking someone else's work. It calls the verify
gate itself when the last wave lands.

Watch live progress with **`/workflows`**. It degrades gracefully to inline subagents when
the Workflow tool isn't available.

A wave that had to heal a conflict, or overflowed its declared files, must prove itself
before the next wave builds on it: the **test gate** runs the full suite and needs a count of
tests actually *executed* (skipped/todo excluded). A suite that runs zero tests — an emptied
test directory, a glob that matches nothing — stops the phase, as does a missing count
(ADR-066). A project with no test runner at all proceeds, flagged unproven (ADR-028).

### Context hygiene (`/clear`-safe by design)

Because all state lives in `.astrocode/` files plus the registry — and because heavy work
runs in workflows/subagents with their own contexts — the main thread barely accumulates,
and every command re-grounds from disk. So astro-code needs `/clear` *less often* than a
system that does its heavy lifting inline, and `/clear` is *safe*: nothing is lost.

- **Clear at phase boundaries**, not between every command.
- **Don't** clear mid-`discuss`, or `discuss → plan` while you are still in the thread —
  that conversation carries intent not yet on disk.
- **Never** clear while a background Workflow/Agent is in flight — you would risk losing
  its completion notification.

---

## Two gates close a phase

A phase moves `executing → verified → complete`.

The `astro-verifier` agent is the **machine gate** — adversarial and **plan-blind**. It
checks the result against the pre-registered, goal-derived `CRITERIA.md` by running the
evidence per criterion, never by trusting the plan or the task summaries.

`/astro-accept` is the **human gate**: UAT against the acceptance checklist written at plan
time. The AI never auto-closes its own work; `ac phase accept` requires a prior `verified`.

Each phase keeps one saved `VERDICT.json` beside its `CRITERIA.md`, written and committed only by
`ac verdict record` (canon-guard blocks hand edits). A re-verify after a FAIL reads it and checks
the unmet criteria first, failing cheaply when they are still unmet; when they now pass, the same
run continues over every other criterion, so a PASS always rests on a full run. It falls back to a
full run when many criteria are unmet, `CRITERIA.md` changed, the history does not line up, the
fix is broad, or you pass `--full` (`ac verdict plan <phase>` shows the decision and the
thresholds live in `lib/verdict.mjs`). `ac phase verify` refuses without a full all-passed
verdict or a valid targeted one (`--force` is the escape).

**Targeted verify (ADR-089, amends ADR-079).** After a recorded full PASS, the next verify
**targets** automatically: `ac verdict plan <phase>` computes, from the diff since that PASS, the
**floor** of criteria the change can affect. A criterion is in the floor when the diff touches a file it
names, when it names no file at all (an unmapped criterion is always observed), when its evidence is the
full suite, or when it is a test-strength criterion and a file in the phase's mutate scope changed. The
verifier observes the whole floor and may only **widen** it, never shorten it. Every other criterion is
**carried** from that full PASS, and a carry is valid only while all of these hold: it cites the phase's
**most recent full PASS** (run and commit) at an ancestor of HEAD; none of its files changed since; it is
not a suite criterion (unless a suite receipt covers the exact clean tree) and not a test-strength
criterion whose mutate scope changed; and it is **one hop** from that PASS, since a targeted run is never
the base of the next one. Any FAIL (full, targeted or narrowed) ends the base, so after a FAIL only a
later full PASS can be carried from. `ac verdict record` and `ac phase verify` re-check every one of these in code,
so a verifier that skips a floor criterion is refused by name, and the phase stays unverified.

The first verify of a phase, a broad diff, a base that is no longer an ancestor of HEAD, a changed
`CRITERIA.md` and `--full` each run **full**, and the plan always states the mode and why. A FAIL still
re-verifies as before: the unmet criteria first, then the rest. `VERDICT.json` records the mode, its
reason, the base, and for each criterion whether it was `observed` or `carried` (with the run and commit,
or the receipt, it came from). `ac phase show <phase>` lists the carried criteria in a `carried` key
(absent after a full PASS), and `/astro-accept` states them in one line before the walkthrough. The
thresholds live in `lib/verdict.mjs`.

**Writing criteria so a later verify can narrow.** Name every file, directory or command a criterion
rests on in backticks on its `Observe:` line, and optionally add a `- **Files:**` line listing them. A
criterion that names no file is always re-checked. Tag a criterion whose evidence is the full test suite
`[suite]` right after its id (`### C5 [suite] — …`), as `[mutation]` is tagged; a suite criterion is never
carried from an earlier PASS.

### Suite receipts

`ac suite run --command "<cmd>"` runs the project's suite, exits with its status and writes a receipt
under `.astrocode/.local/suite-receipts/`: the command, commit, tree, whether the tree was clean before
and after, the exit status, the node version and the time. `ac suite receipt --command "<cmd>"` asks
whether a receipt can be reused (read-only, exit 0 either way). A receipt is local and never committed,
and it is reused only on the **same commit**, the **same clean tree** (untracked files count as dirty,
ignored files are not checked), the **exact command string** and exit 0; it is refused otherwise, each
refusal with its own reason. A verifier on the identical clean tree cites a reusable receipt instead of
running the suite again; the verdict records which receipt stood in. The receipt's command must be
that criterion's suite command (the command its Observe line names, any one under a `[suite]` tag, or
a known suite command such as `npm test` when it names none), checked at record time and by the gate. A full verdict never uses receipts.

> **A phase's goal is the bar, not its task list.** Every task passing while the goal is
> unmet is a failed phase.

---

## Mutation testing (test-strength criteria)

When a goal asks for test strength ("the tests would catch a regression"), the criteria author
writes that criterion with the `[mutation]` tag right after its id: `### C4 [mutation] — <claim>`. A heading that only mentions the tag elsewhere is not tagged.
The tag pre-commits a criterion to the **code** gate: `ac verdict record` refuses a pass without clean evidence.

Whenever a mutation tool is installed, the verifier uses it wherever it would otherwise hand-make
mutants: for any criterion, tagged or not, it runs `ac mutate <phase> --json` and judges the open
survivors. Hand-made mutants remain only as the no-tool fallback. `ac mutate` is mechanical: it
picks the tool, scopes to the changed lines, runs the phase's own tests under a time cap and parses
the report.

| Language | Tool | Install, as your project manages it (astro-code never installs it) |
|---|---|---|
| JS / TS (`package.json`) | Stryker | `npm i -D @stryker-mutator/core` · `pnpm add -D @stryker-mutator/core` (`pnpm-lock.yaml`) · `yarn add -D @stryker-mutator/core` (`yarn.lock`) |
| Go (`go.mod`) | Gremlins | `go install github.com/go-gremlins/gremlins/cmd/gremlins@latest` |
| Python (`pyproject.toml`, `setup.py`, `requirements.txt`) | mutmut | `pip install mutmut` · `uv pip install --python .venv/bin/python mutmut` (a `.venv` without pip) |

A pinned package (`requirements*.txt`, `pyproject.toml`, `package.json`, a lock file) or a
lock-managed Python environment adds a warning that an install may change nothing.

- **Scope: the changed lines.** The lines the phase's own `(phase NN tK)` / `(phase NN remediate-cK)`
  commits wrote, from `git blame` at HEAD, minus tests and `.astrocode/`. Stryker gets line ranges
  (`--mutate file:40-45`); Gremlins its own `--diff` against the commit before the phase; mutmut 3
  the functions holding those lines (mutant-name globs; a changed line outside any function is
  counted and warned about); mutmut 2 whole files, with the reason, and results filtered to the
  changed lines. Nothing changed means `no-scope`. The result says which scope applied and why.
  `ac config set mutation.files '["src/x.js"]'` adds whole files and `mutation.exclude` skips paths
  (a trailing `/` is a directory); Gremlins falls back to excluding other files when files are added.
- **Tests: the phase's own.** The test files the phase's commits wrote; with none the full suite runs
  and the result says so. `mutation.tests` (project) or `mutation.phases.<n>.tests` (one phase) names
  others. Each tool is handed them its own way (a generated Stryker config, Gremlins `GOFLAGS -run`,
  mutmut `PYTEST_ADDOPTS`); a runner that cannot be narrowed (Stryker with vitest) is reported as
  not narrowed.
- **Tool choice.** Detected from the manifests; `ac config set mutation.tool stryker|gremlins|mutmut`
  overrides it. Every result says which tool applied and why.
- **Cap.** 10 minutes by default; `mutation.cap_seconds` changes it for the project and
  `ac config set mutation.phases.<n>.cap_seconds 1800` for one phase. At the cap the whole process
  group is killed and the result names the step it was in, how many mutants were tested and the key
  to raise. A capped run is never "all killed".
- **Outcomes.** `clean`, `survivors`, `incomplete` (capped or not every mutant ran), `no-scope`,
  `tool-missing`, `no-tool`, `not-configured` (mutmut 3 installed but without configuration: run
  `ac mutate setup`), `error`. Timeouts count as killed. A dirty scope is an `error`: the result
  must grade HEAD. A mutant the tool never tested is not run, and one a hook skipped is ignored.
- **Output.** Survivors are listed in full (file, line, mutator; mutmut 3 at the real source line).
  Everything else is per-file counts. The log and the complete mutant list (one JSON line each) sit
  in `.astrocode/.local/mutate-runs/`, beside the kept run, named in the result, replaced by the next
  run of the phase, never committed.
- **Triage.** A survivor that is a real test gap fails the criterion; an equivalent mutant passes
  with a one-line justification kept in `VERDICT.json`. `ac verdict record` enforces this for every
  test-strength criterion (see "Which criteria get the bar") and binds the evidence to the last full
  `ac mutate` run on this machine: its commit, counts and survivors must match, so an edited survivor
  list cannot hide one nobody triaged.
- **No tool.** Verification falls back to AI-invented mutants and says why. The full install
  suggestion shows once per project per tool, then one line. The memory is **local, never committed**: `.astrocode/.local/mutate-notices.json`. `ac mutate dismiss [<tool>]` silences it;
  `ac mutate --check` always shows it.
- **`ac mutate setup`.** Writes a minimal config for the detected tool only when none exists: the
  mutmut keys follow the installed major (`source_paths` / `pytest_add_cli_args_test_selection` for
  3.x, `paths_to_mutate` / `tests_dir` for 2.x). An existing file is never rewritten; deprecated keys
  are named. It is the one writer; a run or a check never changes your project.
- **Trust.** The tool runs your project's own tests, the same trust level as `npm test`.

### Judging survivors
`ac mutate` groups survivors by function and mutation kind, with string/message literals in their
own `g:text-only` group, and prints only the open groups (20 at most, the rest is `--json`).
Judgements live in `.astrocode/phases/<slug>/SURVIVORS.json`, beside `VERDICT.json`: committed, so a
teammate's clone and a reviewer see every justification.
`ac mutate judge <n> <s:key|g:group>... --equivalent "<one line why>"` (or `--test-gap ["<note>"]`)
writes it; the file is not committed until `ac verdict record` does. Nothing is ever marked
equivalent for you. A group note is expanded into one entry per survivor it holds **now**, so a
survivor that appears later stays open. A judgement follows its mutant, not its line number: the key
is built from the file, function, mutation kind, the mutated line's text, the replacement and the
column. Lines inserted above keep it; **editing the mutated line, or moving it to another function,
re-opens it** (the old entry stays in the file, unused). Gremlins has no string mutator, so it never
has a text-only group. A hand-edited entry with an unknown triage or an `equivalent` without a
justification is ignored and counted.

### Fix rounds: `--survivors`
`ac mutate <n> --survivors` re-tests only the open survivors (untriaged or `test-gap`) of the last
full run. mutmut 3 runs the exact mutants by name. Stryker runs exactly the open survivors too: a
`--mutate` span each, plus an incremental file `ac mutate` writes from the last full run's own report
minus the open survivors, so every other result (killed, equivalent-judged) is reused, not re-run
(without a kept full report it says it is narrower-than-ideal). mutmut 2 re-runs whole files and
Gremlins files plus mutant kinds (its `--diff` takes only an ancestor commit), so killed and
equivalent-judged mutants there re-run too; both say so, count the extra mutants and discard
their results. The output shows the full run's groups with the re-test overlaid under a
leading line, and it is **not a recordable verdict**: `ac verdict record` refuses it. Finish with a
full `ac mutate <n>` and record that.

### Flaky tests
Before mutating, `ac mutate` runs the phase's tests twice on the unchanged code (`go test -count=1`,
`pytest`, or the Stryker test command). A test that fails once is named under `flaky`, and its kills
are not counted: excluded from the mutation run (Go, Python), discounted by the report's attribution
(Stryker runners that attribute kills), or, when neither is possible, the run is marked incomplete.
A test failing both times is `baseline_failing`. The check shares the one cap, and a cap hit there is
named "flaky check (tests run twice)". When no runner can be found it says why and goes on.

### Which criteria get the bar
The tool's result is the code-checked bar for every test-strength criterion, tagged or not. The
verifier sets `test_strength: true` on each criterion it uses the tool for, and
`ac verdict record` then applies the same gate and the same full-run binding as for `[mutation]`.
The mark is sticky for the phase: it lives in `VERDICT.json`, a later verdict or a fresh clone cannot
drop it, and mutation evidence on a criterion marks it even if the flag is forgotten. Old criteria
need no edit. A pass is also refused when code changed since the last full run.

---

## Verifier calibration

The verifier's PASS gates every phase (ADR-021, ADR-022, ADR-079), so how often it passes broken
code is worth a number. `ac verify calibrate` plants real defects into the project's accepted phases,
runs the verifier on each exactly as `/astro-verify` would, several times, and reports its false-PASS
rate, so "did the new prompt help?" is a diff between two records (ADR-088). It is on demand only
(`/astro-calibrate`): no loop command or workflow runs it, and it never touches a phase's status,
`VERDICT.json` or `SURVIVORS.json`.

```bash
ac verify calibrate                      # the bill only: cost, defects × runs, seed, budget
ac verify calibrate --defects 10 --runs 3 --seed 7 --budget 40 --yes   # run it
ac verify calibrate --yes --json         # the same record, machine-readable
```

- **Two sets, reported apart.** EASY defects are `ac mutate` mutants your tests already killed (a real
  bug by construction). HARD defects are survivors you judged `test-gap` (a real bug no test catches),
  so the hard rate shows whether the verifier looks beyond the suite. Equivalent and unjudged survivors,
  and anything from a phase that is not `complete`, are never drawn.
- **Where the defects come from.** This machine's kept `ac mutate` runs (`.astrocode/.local/mutate-runs/`)
  of accepted phases, archived milestones included, never a re-run of the tool. A list kept before this
  feature has no exact changes: run `ac mutate <n>` again. mutmut and Stryker plant exactly; Gremlins
  reports no patch, so it is not supported and the command says so. A short set is run as it is: the
  real counts are reported, nothing is repeated to fill the count.
- **The bill.** Without `--yes` the command prints the estimate (the median cost per trial of your last
  logged runs, else $3.00) and the seed, and stops: nothing runs, nothing is written. `--budget <usd>`
  caps the run (default 1.5× the bill); trials go in rounds, one per defect at a time, and reaching the
  budget stops cleanly with the counts that completed. `--seed` repeats the same plants.
- **Blind.** Each trial gets a fresh throwaway clone under the temp directory with exactly one defect
  planted, folded into the tip commit so `git status` is clean and no commit, branch or tag names it.
  Removed from the copy: every `SURVIVORS.json` and `VERDICT.json`, the calibration log and the tool's
  artefacts; each trial lists what was removed in `--json`. The verifier is the installed
  `astro-verifier` agent with the contract read from `commands/astro-verify.md`, and the code checks
  blindness before every run. The copy's history is rebuilt without those records, and nothing in it
  leads back to the real project: no `ORIG_HEAD`, remote refs or unreachable objects; dependency
  folders (`node_modules`, `.venv`, `venv`) are copied, not linked, with `__pycache__` dropped and every
  absolute symlink and every absolute path in a text file whose real path falls inside the project
  repointed at the copy, however it is spelled; the verifier's environment names only the copy.
  **Known limit:** a binary file in a dependency that embeds the project path makes that trial refuse
  to run (reported as invalid) when the path is spelled as the project, `$PWD` or a venv records it;
  a binary embedding some other spelling of it is not detected.
- **The numbers.** The headline is the defect rate (defects PASSed on at least one run) and the trial
  rate, each with a Wilson 95% interval, plus per-defect pass^k (caught on all k runs). A crashed or
  unreadable trial is invalid and excluded, never a catch. A set under 5 defects is marked
  "too few defects to rely on", and a set with none is unavailable, not 0%. The measure is the verifier's own
  verdict: the ADR-085 code gate is not applied.
- **The log.** Each `--yes` run appends one record to `.astrocode/CALIBRATION.jsonl` (committed, with a
  neutral subject): date, verifier model and prompt hash, seed, both rates, pass^k, counts and the
  defects by key only. Records with the same `defect_set_hash` are comparable.
- **Not for astro-code itself:** its `node --test` suite has no supported mutation tool. Use it in a
  project that has Stryker or mutmut.

---

## Numbering and duplicate detection

`ac phase add` / `ac milestone new` claim the next free number from `registry.json` on an
orphan branch (`astro-registry`) via a git compare-and-swap: if someone else pushed first
your push is rejected and `ac` retries with the next number. No server, no `gh`.

Claims also record the **name**, so adding a phase (or `ac phase check "<name>"`) warns
when another dev is already building something with the same or similar name — catching
duplicate work early.

The registry is the single source of truth: with no remote (or before `ac registry init`),
a claim **refuses with an actionable hint** rather than allocating a local number that
could later collide — set up an `origin` and run `ac registry init` first.

> **Never hand-edit `.astrocode/roadmap.json`, `state.json`, or the registry.** Editing
> them desynchronises the claim ledger and the corruption surfaces later, on someone
> else's branch. `ROADMAP.md` is **generated** — edits to it are overwritten; use
> `ac phase note <n> "<text>"` for a note that survives. To add to an existing note use
> `--append`; a plain write that would drop it is refused unless you pass `--replace`.

A phase's milestone lives **on the phase**. Scheduling a phase for a future milestone never
moves the project. **Milestones have a lifecycle** — planned → active → complete:
`ac milestone new --planned --name "…"` declares one as a destination without moving the
project, work is assigned with `--milestone N` (`phase add`, `debt pay --as phase`,
`backlog promote`), and `ac milestone activate <n>` is the separate step that starts it.
Work can only target a claimed, unclosed milestone. A roadmap that already uses a
milestone the registry never claimed is repaired once with
`ac milestone new --planned --number N`, which only works when phases reference N.
Correct a wrong assignment with `ac phase milestone <n> <N>`, which
moves the phase's registry claim too (it refuses, changing nothing, if the registry is
unreachable). `ac status` flags any phase whose roadmap and registry milestones differ.
Closing a milestone archives only its own phases — ones scheduled for a later milestone
stay on the roadmap. A milestone claimed ahead as `active` (every claim before v0.28.0, and
`ac claim milestone`) counts as waiting just like a planned one: `ac status` lists it and the
close hint points at `ac milestone activate <n>`. A milestone's name derives no path, so
`ac milestone rename <n> "<name>"` corrects it at any status, closed included.

---

## Bugs are not phases

A phase is planned milestone scope; a bug is something that turned out to be wrong. Filing
one as a phase burns a milestone number on unplanned work and leaves the roadmap describing
something other than the plan.

`/astro-fix "<bug>"` keeps bugfixes **beside** the roadmap — a dated id
(`2026-09-17-auth-401`), its own directory and archive, its own lifecycle
(`open → diagnosing → executing → verified → accepted`) — and carries one end-to-end:
reproduce, diagnose, fix, verify.

`/astro-fix-accept <id>` is the human gate; a failing verdict sends the fix back to
`diagnosing` (the bug is still live), never to `rejected`, which means "we've decided not
to fix this". Accepting archives it. `ac fix list` shows what's open.

---

## Technical debt

The phase verifier is the highest-context observer in the loop — it has just driven the
real code — so anything real it notices that no criterion covers is filed automatically as
debt. You type nothing; `ac debt list` is the quality dashboard you check when you feel
like it.

An item is never worked in place: it **graduates** into the objects that already exist —
`ac debt pay <id>` opens a **fix**, `--as phase` puts it on the **roadmap** (under the
active milestone, or `--milestone N` for a later one) — and closes
when that work is *accepted*, never on a promise.

That automatic outflow is the whole design: a list whose entries only leave when a human
remembers to delete them is a diary, and a diary rots (astro-code's own `todo.md` spent
months insisting GitFlow was unimplemented while `lib/flow.mjs` shipped it). Two hooks keep
it live rather than archival: `/astro-discuss` surfaces debt touching the files a phase is
about to change, and `/astro-complete-milestone` asks you to pay or drop anything stale.

The verifier can never park a *criterion* failure here: a finding is admissible only if it
explicitly asserts it is outside every criterion, and findings from a failing phase are
discarded, so the quality gate keeps no back door.

### Drop vs dismiss

Two exits exist for an item that isn't going to be fixed, and the difference is the point:

- `ac debt drop` — it **was** true and the code moved on.
- `ac debt dismiss` — it was **never** true and the verifier was wrong.

Both keep the record. Only the second is a measurement of the *feed* — if dismissals climb,
tighten the verifier rather than grinding through the register.

### Is it worth paying down?

`/astro-debt` (or `ac debt score`) answers with a 0–100 number and the evidence behind it,
then offers the exits; `/astro-debt-pay <id>` takes one on and lands it — checking first
that it is still real, routing it to a fix or a phase, and closing it only through the
acceptance gate.

It is explicitly **not** a count: volume is a guilt meter that says "pay debt" every day of
the project. Instead it weighs what the debt is *charging* you — **recurrence** (the
verifier hit the same item again in a later phase, so you demonstrably keep walking over
this ground), **concentration** (several items in one file), and age but only where it
compounds a recurrence — against the **principal** it would cost to clear
(small 1 · medium 3 · large 8).

So filing more debt can never raise the score by itself: a fresh, isolated finding is pure
principal and pushes the number *down*. Debt in code you never touch reads as zero, which is
the honest answer.

| Score | Reading |
|---|---|
| under 25 | healthy |
| 25–49 | worth watching |
| 50+ | the register is charging you about what clearing it would cost |

The same number rides the statusline as `debt nn` — and **only** once it leaves the healthy
band, so the segment appearing is itself the signal.

---

## Backlog

A place to write down an idea you are not ready to plan — `/astro-backlog "<idea>"` files
it with no file touched and no phase number spent. It is a peer of debt and fixes, not a
status inside either: an idea has no file and no recurrence, so folding it into the debt
register would corrupt the one number in the system that currently carries signal.

Like debt, it cannot rot into a `todo.md`: every item leaves the list the same way it
arrived. `/astro-discuss` offers to **link** an open item to the phase it relates to, and
a linked item **closes automatically** when `/astro-accept` accepts that phase — never on
a human remembering to delete a line. An item can also be **promoted**
(`/astro-backlog-promote <id>`) into a real phase, which claims a number and seeds the
idea's captured text into the new phase's `CONTEXT.md` — deliberately without marking it
as a discuss round, so `/astro-plan` still demands a real one. Or it can be **archived**
with a reason (`declined` or `obsolete`), keeping the record of why so a later "let's plan
X" can be answered instead of re-litigated.

`/astro-backlog` with no argument just lists what's open and stops — checking is a glance,
so it never costs a round of questions. `/astro-backlog review` is the triage pass that
offers each item its exits.

---

## Principles

A personal store of your own patterns, preferences and antipatterns — the notes you keep
making across every project, kept once instead of re-typed into every `CONTEXT.md`.
`ac principles add "<statement>" --kind principle|pattern|preference|antipattern` writes
one Markdown file per entry under `~/.astro/principles/` (`ASTRO_PRINCIPLES_DIR`
overrides that), never inside the project: ADR-057's explicit exception to "state lives
under `.astrocode/`", because what is being written travels with YOU, not the repo.

**Accepting is the only way in.** A manual `ac principles add` is accepted directly; a
machine that later observes something (phase 23) can only `--propose` it — an entry
starts governing agents once a human accepts it, never on its own. `ac principles reject
<id> --reason "…"` and `ac principles retire <id> --reason "…"` both need a reason, and
neither one deletes the entry: a rejection is what stops the same idea from being
re-proposed later, so `list --all` keeps showing it long after `list --accepted` stops.
`ac principles amend <id> --reason "…" [--statement … | --edit]` rewords or rescopes an
accepted entry in place — same id, one history line naming the reason and the prior text.

**Remote and sync.** With no remote configured the store is purely local and every
command is offline. `ac principles remote <url>` points it at your own private git
repo (never a team's) and syncs immediately; after that, every command pulls first and
pushes after a mutation, offline-first — an unreachable remote is only ever an advisory
line, never a failure, and nothing is force-pushed. Two machines that both changed the
*same* entry since their last sync produce a genuine conflict: the machine you are on
keeps its own copy in `<id>.md`, the other machine's copy lands in
`conflicts/<id>.<sha>.md`, and every command warns until you run
`ac principles resolve <id> [--take mine|theirs]`. Two machines changing *different*
entries never conflict — one file per entry makes that true by construction.

**Promote vs. personal.** A principle stays personal until you deliberately promote it:
`ac principles promote <id>` (accepted entries only) records a shared ADR in the current
project's canon by default, or `--as convention` appends a bullet to its
`CONVENTIONS.md` (local only — it prints the `ac canon push` you still have to run
yourself). Either way the entry itself stays in your home store, still accepted, still
yours everywhere else — `show <id>` lists every project it has been promoted into.

**How proposals arrive.** Four moments propose into your store — never accept anything
on their own (ADR-058): after `/astro-decision` records an ADR, after `/astro-discuss`
captures `CONTEXT.md`, on an `/astro-accept` rejection (a plain acceptance proposes
nothing), and the `/astro-complete-milestone` retrospective sweep over the whole
milestone's ADRs, CONTEXT files, rejections and the surprises `/astro-execute` records
along the way. Only moments a human actually answered propose — an agent-captured
discussion or an agent-signed accept/reject (`--agent`) never does. Each moment proposes
at most 3, each carrying its own why, and ends with at most one line —
`ac principles list --proposed` reviews the queue. See
[`templates/principle-capture.md`](./templates/principle-capture.md) for the full spec.

**Review and dedupe.** An EXACT repeat of any existing statement — normalised for case,
punctuation and whitespace, never a similarity score — never mints a second entry,
regardless of the existing entry's status: it records a *sighting* on it instead ("seen
again N"), so an already-accepted principle just accumulates evidence and an
already-rejected one stays rejected without re-entering the queue. An OVERLAP
candidate (a statement that shares real content words with an existing one, short of
being the exact same wording) is only ever *surfaced* — `ac principles match
"<statement>"` names it and the words that matched — never acted on: the capturing
agent, or you, decides whether it's the same principle (`ac principles sight <id>`
instead of proposing) or a genuinely different one. `/astro-principles-review` walks the proposed
queue in batches — accept, edit-then-accept, reject (reason required) or skip each
item, and offers `ac principles merge <dup> --into <id>` for a near-duplicate group
instead of rejecting one of them for "no". `ac principles reopen <id> --reason "…"` is
the only way back from rejected. Sightings recorded on two machines merge across a sync
with no conflict — they're append-only evidence, never a decision to arbitrate.

- `ac principles match "<statement>" [--json]` — exact/overlap candidates, explainable, never acted on.
- `ac principles sight <id> [--from-project …] [--excerpt …]` — record an explicit sighting.
- `ac principles reopen <id> --reason "…"` — rejected → proposed, the only way back.
- `ac principles merge <dup> --into <id>` — fold a duplicate's evidence into the survivor; the duplicate stays citable as `merged`.

**Retrieval — a structural shortlist, not a search engine.** `ac principles brief [--stage
s] [--work w,…] [--files a,b] [--rules-only] [--by role] [--json]` prints the per-task
shortlist: every `strength: rule` entry in full, plus a compact index (id, kind/strength,
first-sentence statement, ≤ 25 lines) of *in-scope* accepted defaults — a default is in
scope when EVERY non-empty scope dimension (stack/work/files) matches something in the
task's context (stack ∩ project tags, work ∩ requested work, a requested file matching a
glob); an unscoped dimension on either side is a wildcard, but no `--files` at all means a
file-scoped entry stays silent — a glob is a narrow claim nothing confirms it against.
Stack is detected from manifests at the project root (`package.json` deps, `go.mod`,
`Cargo.toml`, …), overridable with `ac config set stack '["rust"]'`; the tags used are
always printed, so a wrong detection is visible, never silent. Nothing served ⇒ empty
stdout (hooks key their silence on that) and one line on stderr. `ac principles ask
"<question>"` ranks by keyword — statement, why and scope tags, weighted — and says WHY
each result matched (no embeddings, ever). `ac principles cite <id>… --stage s --by role`
records what you actually applied; `ac principles list --usage` surfaces served-often-
never-cited ("ignored") and never-served ("unused") entries from that log, which lives at
`~/.astro/principles/.local/usage.jsonl` — per-machine, unsynced, ids only. A shortlist
that shares words with your project's `CONVENTIONS.md`/`DECISIONS.md` prints `⚠ canon may
override: ADR-nnn` — a candidate only; canon always wins and nothing is resolved for you.
Every astro agent (executor, researcher, planner) runs `brief` for its own stage and
`cite`s what it applies; the verifier only ever sees hard rules, non-blocking (a violation
is filed as debt, never a failed criterion). The Claude Code session gets the same
shortlist injected automatically at start/compact; on any other host, the managed
`AGENTS.md` block tells the agent to run `ac principles brief` itself. Claude Code keeps a
hook's context whole only up to 10,000 characters, so a large brief is split across four
SessionStart hooks (`ac principles brief --part K/N`, each under 9,500 characters): hard
rules then lose their why (one `ac principles show <id>` away), and anything that still
does not fit is named in a closing `⚠ CUT` line. Set `"principles": { "sessionBrief":
false }` in `~/.astro/config.json` to turn the injected copy off.

**Transcript sweep — on demand, opt-in.** `/astro-principles-mine` (or `ac principles mine`) sweeps
past session transcripts for steers you kept giving — corrections, preferences, explicit
rules — and turns what recurs into proposed principles, exactly like every other capture
moment. It runs ONLY when you ask for it: never from a hook, never on a schedule. The
statusline/SessionStart banner nudge you towards it once 10+ session files in the current
project have gone unswept — a stat-only check (file sizes vs. a recorded watermark, never
opening a transcript) that stays cheap even against a huge history. Scope defaults to the
current project (every Claude profile + Codex; Cursor sessions are not mined yet); `--all` or `--project <path>` widen or
retarget it deliberately. Only turns you actually TYPED are read — tool results, injected
context, expanded command bodies, subagent and headless (`claude -p`/SDK) sessions are all
excluded before anything reaches the engine. Everything is redacted (the same shapes
`lib/redact.mjs` masks everywhere else) before it is ever surfaced. The engine judges no
meaning (ADR-064): it hands the agent a bounded batch of those turns (turns identical
after normalising collapse into one, carrying all their sessions), and the agent does
the rest in any language — grouping turns that say the same thing, keeping opposite
instructions apart, ignoring content-free replies like "No.". A group qualifies once it
recurs in ≥2 distinct sessions, or was stated once as an explicit rule; an exact
restatement of an existing entry (accepted OR rejected) is recorded as a sighting, never
re-proposed. At most 10 proposals per sweep, strongest first. Turns beyond one batch are
held for next time, and the agent names the turns worth carrying forward (one-offs that
may recur, qualifying groups beyond the cap) with `--keep` — they come back in the next
sweep marked `earlier`. The read (`ac principles mine [--json]`) never commits anything:
only `ac principles mine --advance <sweep-id>`, run after every proposal/sighting call has
succeeded, moves the watermark — a failed lift is retried on the next sweep, never
silently skipped. The watermark and carried turns live in the store's already-gitignored
`.local/mine/`: per-machine, pointers and byte offsets only, never transcript text.
`--rescan` re-reads everything from scratch (rarely needed — only when you suspect the
watermark drifted).

- `ac principles mine [--all|--project <path>] [--rescan] [--json]` — hand over a batch of past human turns (read-only).
- `ac principles mine --advance <sweep-id> [--keep <id,id,...>]` — mark that sweep processed, carrying the kept turns forward.

**Letting another tool read this store.** The store holds only what astro-code itself
captures — there is no import from another knowledge graph (ADR-065). Any other tool — a
forge server included — can follow
[`templates/PRINCIPLES-CONTRACT.md`](./templates/PRINCIPLES-CONTRACT.md) (v1) to read this
store back, read-only: the on-disk entry format and the `ac principles list|show …
--json --no-sync` output, both version-pinned and guarded by tests so a format change is
never silent. `--no-sync` on `list`/`show` skips the git sync entirely (no lock, no write
of any kind), which is what makes following the contract safe against a store the reader
does not own or cannot write to.

- `ac principles list|show … --no-sync` — read-only, for a foreign consumer following the contract.

---

## The fast lane

`/astro-fast "<a long, unplanned prompt>"` is for a big freehand request that shouldn't need
four commands to land. It **captures the raw prompt verbatim** (the source of truth),
**distills a lean spec** you can eyeball — a checklist of changes each traced back to the
prompt, plus an explicit "to clarify" list so nothing is silently dropped — then goes
**straight to execution**: sequential atomic commits and one verify pass, skipping the
research fan-out.

A **scope guard** escalates anything systemic (new architecture, cross-cutting migration,
new dependency, or work that contradicts the canon) back to the full flow.

It produces a **verified** phase at best — human `/astro-accept` still closes it.

---

## Canon

`CONVENTIONS.md` (rules) + `DECISIONS.md` (append-only ADR log) are shared on the same
orphan branch as the registry and injected into every plan/execute agent, so consistency
across parallel work is enforced rather than hoped for.

`ac decision add` appends to the shared log (ADR ids never collide across devs, and each
entry records the commit it was made at); `ac canon pull` refreshes your local mirror.
Re-adding a decision that is already in force records nothing and prints the existing id, so
a retried add can never land a duplicate.

**A decision leaves the log without being deleted.** `ac decision supersede <id> --by <id>`
and `ac decision retire <id> --reason "…"` stamp it with a status; the full entry stays in
`DECISIONS.md` for audit, but agents read `DECISIONS.in-force.md` — every live decision in
full, and a one-line stub (successor and date) for each one no longer in force, so a
citation still resolves. `ac canon stats` shows what every agent is handed.
`ac canon dedupe` leaves a stub too, so a collapsed number is never reissued.

**Correcting prose is not a new decision.** `ac decision amend <id> --reason "…" --why "…"`
(or `--rejected`, `--body-file`) fixes a dead link or a translation: same id, same title,
and an `_Amended <date>: <reason>_` line records it. A decision that *changed* is a new one
plus `supersede`.

**Keep the mirror honest.** The committed `DECISIONS.md` is what ties canon to your code —
`git show <tag>:.astrocode/DECISIONS.md` is the canon in force at that tag. `ac canon check`
exits non-zero, per decision, when it differs from the registry — a changed body, a missing
entry, or an id repeated in one copy but not the other (put it in CI or a hook);
`ac status` flags it in one line. Never hand-edit a published entry: amend it.

### ADR numbers in a project with an ADR folder

A project can keep its own ADR files (`docs/adr/0042-use-postgres.md`) beside `DECISIONS.md`.
Left alone, every branch picks "highest + 1" and two of them take the same number. astro-code
makes it one registry-claimed series across both stores (ADR-087):

- **Detection.** The folder is the one of `docs/adr`, `adr` or `doc/adr` that holds
  `NNNN-*.md` files (3 or 4 digits; the width is read from the highest file). `ac config set
  decisions.adr_dir <path>` names another folder; `ac config set decisions.adr_dir off` turns
  the feature off. When two candidate folders hold numbered files, `ac decision add` refuses
  and names that command. A project without an ADR folder keeps today's DECISIONS.md-only
  behaviour, byte for byte.
- **The claim.** `ac decision add "<title>" --why …` claims the next number from the registry
  (above every claim, every `ADR-`/`D-` heading and every file), then writes the `## ADR-0011`
  entry and `docs/adr/0011-<slug>.md` under that one number, and prints
  `✓ wrote <file> (ADR folder <dir>, detected|configured)`. If the registry cannot be
  reached it refuses and writes neither store: a number guessed locally is the collision this
  prevents. With no registry remote at all it allocates locally (`[local]`).
- **The guard.** With `canon-guard` on (`ac mods enable canon-guard`), creating an ADR file or
  adding an `## ADR-NNNN` heading whose number is not claimed is refused, naming `ac decision
  add`. Existing files stay editable. If a teammate just claimed the number, `ac canon pull`
  refreshes your claims; otherwise `ac mods disable canon-guard`.
- **Reports.** `ac canon check` (one `✖ <subject>: <detail> → <fix>` row each) and `ac doctor`
  (one `adr` row each) report an unclaimed number, two different files sharing a number, an
  old-series `ADR-0xx` heading that should be `D-0xx`, a file whose title disagrees with the
  `DECISIONS.md` entry of the same number, and a project not yet backfilled. They only report.
- **Upgrade, once.** Run `ac decision backfill` (a dry run: the relabel map, the reference
  rewrites, the claims, the duplicates), then `ac decision backfill --apply`. It claims every
  number already in the folder, so new claims start above them, and relabels the old
  decision-log series to `D-001…`, rewriting those references in one pass. An entry that
  mirrors an ADR file (exact title) keeps the file's number. A reference is rewritten only when
  its digit width differs from the folder's, so `ADR-002` becomes `D-002` while `ADR-0002`, which
  names the folder file, is never touched; when the two widths are equal references are listed
  by `file:line` instead. No ADR file is renamed or renumbered. A second run changes nothing.
  Duplicates are reported with their renumber command and never resolved for you.
- **Renumber.** `ac decision renumber <file|id> <N|next> [--dry-run]` moves ONE decision to a
  freshly claimed number: the file, its heading and its `DECISIONS.md` entry. Citations of the old
  number are rewritten only on lines that decision's own branch added (git blame against the
  merge base). Lines the other side added are left, and lines git cannot attribute to either side
  (a citation added after the merge, a squash or fast-forward merge) are listed as `file:line`,
  never guessed. Exact references to the old file name are rewritten everywhere. An `N` already
  used or claimed is refused.

> Read `CONVENTIONS.md` and `DECISIONS.in-force.md` before proposing an approach. Conventions are
> binding; decisions record what was already settled and why. Re-litigating a recorded
> decision wastes the work that produced it.

**Existing project?** `/astro-adopt` maps the repo once and drafts `PROJECT.md` +
`CONVENTIONS.md` from the real code, then plans what's next — a one-time bootstrap, not an
always-synced codebase map.

---

## Models, thinking and effort

`.astrocode/config.json` sets a **model tier** (`models.<role>`: opus/sonnet/haiku; the profiles put haiku on the integrator only) and a
**reasoning depth** (`reasoning.<role>`: low→max) for each of the six roles. They're
independent and both move cost — a cheap model at `xhigh` can outspend an expensive one at
`low` — so `ac models max|balanced|fast` sets the **pair** in one switch:

- **balanced** (default) — opus + `high` for `planner` and `verifier`, sonnet + `medium`
  elsewhere, and the `integrator` on haiku (the mechanical `discover`/`integrator` stay `low`
  in every profile).
- **fast** — sonnet (haiku for the integrator) and `low` everywhere **except the verify gate**, which keeps opus +
  `high`. Going fast can never silently cost correctness. Phases dominated by execution
  shrink the most.
- **max** — opus everywhere (`xhigh` on planner/verifier), except `integrator`, which stays
  sonnet — opus on a cherry-pick is waste.

Running several projects under one policy? `ac models <profile> --user` writes the pair to
`~/.astro/config.json` as **your** default. Per role, the project's value wins, then yours,
then the built-in one; `ac models` shows which (`sources`). A new project leaves the roles
you set unset, so it follows your default; an existing one keeps its own until you
`ac config unset models.<role>` there.

The profile ladder is **opus→sonnet for every judgement role; haiku runs the `integrator`
only** (the `balanced` and `fast` profiles; `max` keeps sonnet). Haiku on any other role is
your own per-role choice (ADR-073). ADR-035 dropped the old
haiku 4.5 `integrator` after benchmarking: its cherry-pick *judgement* was sound but its
*discipline* was not — it ran a bare `git stash -u` in the shared tree and destroyed a
completed phase plan. Haiku 5.5 is a different model at about a twentieth of sonnet's price,
and with the integrator prompt's prohibition paragraph it did neither in any of the 40 guarded haiku trial runs.
Opt out with `ac config set models.integrator sonnet`. Speed for every other role comes
from opus→sonnet, never from haiku. Hosts clamp depth to their own ceiling (Codex tops out at `xhigh`) rather than
silently falling back; on Cursor there is no separate reasoning dial in v1 — depth lives
in the model id suffix, so `reasoning.<role>` is not applied there.

The third dial is per-**phase**, not per-role: `ac phase effort <n> light|standard|deep`
(ADR-022) budgets how many verify→remediate cycles a phase may burn — 0, 1, or several.
Research stays 3 angles at every level; the budget goes into convergence, not fan-out.

Per-run without persisting: `/astro-plan <n> --fast` / `/astro-execute <n> --fast`.
Fine-tune one role with `ac config set models.executor opus`, or use `/astro-config`.

### Local models

When Claude Code runs on a local model (for example Qwen served by vLLM behind
`ANTHROPIC_BASE_URL`), the endpoint serves that one model and none of the Claude tiers.
astro-code detects it and runs **every agent on the session's model**, with no reasoning
effort: `ac config get models` returns `inherit` for each role, and the workflows then
pass no model at all. That also switches off the `deep` escalation to opus and the
integrator's sonnet floor. Your stored config is untouched, so a normal session gets its
tiers back. `ac status` shows a `Models:` line while this is in effect.

A session counts as local when `ANTHROPIC_BASE_URL` points anywhere other than
`anthropic.com`, or `ANTHROPIC_MODEL` names a model that is not a Claude id or tier alias.
`ASTRO_LOCAL_MODEL=1` or `=0` forces the answer. Use `=0` for a proxy in front of real
Claude.

### Measuring cost

`ac stats` reads Claude Code's session transcripts and reports the honest breakdown —
**fresh** input/output (the real cost) vs **cache reads** (cheap), the cache-hit ratio, and
wall-clock. It's the whole project session by default; scope a single run with
`--since "<ISO timestamp>"` (or `--session <id>`). For a real astro-code-vs-X comparison,
run the same task in a fresh session and compare.

### Resilience

astro-code runs *inside* a Claude Code session (it never shells out to the `claude` binary),
so model fallback is a session-launch concern, not a config knob: start Claude Code with
`claude --fallback-model sonnet` and a transient opus outage degrades the session to sonnet
for the rest of the run instead of failing every request mid-phase — worth it for long
autonomous runs.

---

## GitFlow branching (opt-in)

Off by default — planning stays orthogonal to branching, so teams that don't want GitFlow
pay zero cost. Turn it on with `ac config set gitflow.enabled true`, then drive it
explicitly (lifecycle commands like `ac milestone new` are never touched):

```bash
ac flow init                   # ensure main + develop exist (creates develop off main)
ac flow                        # create+switch to feature/m<N> off develop
ac flow pr                     # push the feature branch, print the develop PR URL
ac flow release                # push develop, print the develop→main PR URL
ac flow tag [version]          # tag origin/main once that PR merges
ac flow hotfix start <name>    # branch off main; `finish` lands it in main+develop + tags
```

> **Run `ac flow` before `/astro-execute`.** Execution forks one worktree per task from
> `HEAD`, so you must be on the feature branch first.

It's pure local git (no `gh`/`glab`, any remote or none) and it refuses to touch the orphan
`astro-registry` branch.

---

## Astro kits

```
/astro-kit-new [kit-id]   start a new Astro kit: scaffold manifest v4 + recipe + build tooling
/astro-kit-convert [src]  convert an existing non-kit implementation at verified feature parity
/astro-kit-test           test a kit WITHOUT publishing: offline static checks, or --tier2
/astro-kit-source [id]    author/refresh a data source: introspect the database through a running Astro instance, merge into schema.json + SOURCE.md
/astro-kit-publish        publish a kit to a hosted Astro instance (zip with kit.json inside)
```

A kit is developed as a standalone astro-code project and goes through the normal loop.

---

## Astro Fleet

`ac fleet connect` reports every Claude Code session on this machine to an Astro Fleet.
This covers sessions in any repo, not only astro-code projects. The fleet's Forge draws
a bay per project, a lead per session and an apprentice per sub-agent, in your colour.

```
ac fleet connect https://fleet.example.com --token <t> [--color '#4fb3ff'] [--name alex] [--hide-names]
ac fleet status            # URL, token (last 4 chars), colour, paused, queue depth, last send / error
ac fleet pause | resume    # the hook exits at once while paused
ac fleet color '#ff8800'   # quote it: an unquoted # starts a shell comment
ac fleet disconnect        # removes only the fleet hooks; deletes config and queue
```

Inside Claude Code, `/astro-fleet` runs the same verbs. Prefer the terminal for
`connect`: a token typed into the session ends up in its transcript.

- **Where things live:**
  - the config is `~/.astro/fleet.json` (mode 0600);
  - the hooks are in the user-level `settings.json` of every Claude config dir. Each one
    is marked `# astro-fleet`, and a one-time `settings.json.bak-astro-fleet` is kept.
- **What is sent:** activity only, never prompt text, tool inputs or outputs, or
  transcript paths. That means session start and end, prompt, tool (at most one per 5 s),
  waiting, stop and sub-agent start and stop, each with the project name, repo URL and
  cwd. With `--hide-names`, the project is sent as `p-<hash>` with no repo URL or cwd.
- **Outcomes, not only activity:** an `outcome` event goes out when `ac phase verify`,
  `ac phase reject`, `ac phase accept` or `ac fix accept` succeeds, and when a session's
  Bash call runs `git commit`. It carries the kind, the phase number, fix id or short
  sha, the title, whether a human or an agent signed it, and for an accept whether it
  was a first try. `--hide-names` drops the title. A refused command sends nothing.
- **It never slows a session:** the hook appends to a local queue and exits.
  - A detached flusher sends batches and backs off on errors.
  - It stops on a refused token until you reconnect.
  - `ac fleet status` shows the last error.

---

## External knowledge graph (retired)

astro-code used to make one opportunistic read against an external knowledge-graph MCP
server before `/astro-discuss`, `/astro-plan`, and `/astro-new-project`. Phase 25 replaced
every one of those calls with `ac principles ask` / `ac principles brief` — a personal
store, local and always available, with no connect/degrade dance to document. No astro-code
command or agent reads (or hosts) an external knowledge-graph server any more; retrieval
now runs entirely through `ac principles` (see [Principles](#principles)).

Nothing from the forge graph is brought over: the personal store starts from what
astro-code itself captures (ADR-065). A forge server reads the store back read-only through [`templates/PRINCIPLES-CONTRACT.md`](./templates/PRINCIPLES-CONTRACT.md).

---

## Command reference

### Slash commands

```
/astro-new-project        scaffold .astrocode/, shape PROJECT.md + the roadmap
/astro-adopt              adopt an EXISTING codebase: map it → draft canon → plan next
/astro-phase <name>       add a phase (claims its number)
/astro-discuss <phase>    talk through decisions/edge cases → CONTEXT.md (before planning)
/astro-discuss <phase> --challenge  the thorough interview: numbered rounds, every round saved
/astro-plan <phase>       parallel research → executable PLAN.md (reads CONTEXT.md)
/astro-execute <phase>    wave-based parallel execution, then verify
/astro-verify <phase>     AI gate: confirm the phase goal is met (goal-backward)
/astro-mutate <phase>     run the project's mutation tool on a phase's changed files; also `check`, `setup`, `dismiss`
/astro-calibrate          measure the verifier's false-PASS rate on planted mutants (bill first, `--yes` only on your say-so)
/astro-accept <phase>     human gate: UAT sign-off, then close the phase
/astro-autonomous <phase> run a whole phase end-to-end (discuss→plan→execute→verify), then stop
/astro-autonomous <phase> --challenge  same, with a challenge-mode discuss step
/astro-fast "<prompt>"    fast lane for a long, off-the-cuff prompt: capture → distill → execute
/astro-fix "<bug>"        fix a bug WITHOUT burning a milestone phase
/astro-fix-accept <id>    human gate on a fix — confirm the bug is gone, then archive it
/astro-debt               review the debt register
/astro-debt-pay <id>      take one debt item on and land it
/astro-challenge "<idea>" challenge a loose idea before it's a phase — numbered rounds, every round saved
/astro-backlog             list the open backlog and stop
/astro-backlog "<idea>"    capture an idea (no phase or milestone spent)
/astro-backlog review      triage: offer each item promote / link / archive
/astro-backlog-promote <id> promote a backlog idea into a real phase
/astro-milestone          start the next milestone cycle
/astro-complete-milestone archive the finished milestone
/astro-decision           record an architectural decision into the canon
/astro-config             pick the model tier + reasoning depth per role
/astro-status             where am I, and what's next?
/astro-doctor             is the install consistent? one line per problem, each ending with its fix
/astro-statusline         set a rich Claude Code statusline (milestone/phase track, context bar)
/astro-fleet [status|connect …|pause|resume|color <hex>|disconnect]  report sessions to an Astro Fleet
/astro-update             pull the latest astro-code and re-link it everywhere
/astro-help               short guide: the loop, the commands, and how to go fast
/astro-kit-new /astro-kit-convert /astro-kit-test /astro-kit-source /astro-kit-publish
```

On Codex, invoke the same commands as `$astro-plan 3`. On Cursor, the same `/astro-plan 3`
works, or headless as `cursor-agent -p --trust "/astro-status"`.

### CLI

`ac help` lists everything. The common ones:

```bash
ac init --name my-project --vision "what we're building"
ac status                      # project / milestone / phases
ac phase add "Foundation"      # claim + add a phase
ac phase check "<name>"        # is someone already building this?
ac phase accept <n>            # human gate — requires a prior `verified`
ac phase accept <n> --witnessed composer  # evidence the witness mod adds; also on `phase reject` and `fix accept`. `ac` never detects: it records what is declared
ac phase accept <n> --evidence "<id or URL>"  # cite a decision made elsewhere (cited_evidence; never makes the signer human); also on `phase reject` and `fix accept`
ac phase show <n> [--json]     # one phase's record, incl. accepted_kind / accepted_evidence
ac phase reject <n> --reason … [--agent name]  # UAT failed → rejected + a blocker (--agent: machine-signed)
ac phase surprise <n> [--healed n] [--remediation-cycles n] [--stopped-reason r] [--note "…"]  # execute records a run surprise
ac phase context <n> [--author]  # discuss-gate status, or who captured it: human | agent <name> | none
ac mutate <n> [--json]         # mutation-test the phase's changed lines (Stryker / Gremlins / mutmut)
ac mutate <n> --survivors      # re-test only the open survivors (partial; not a recordable verdict)
ac mutate judge <n> <id>... --equivalent "<why>" | --test-gap   # record a survivor judgement (SURVIVORS.json)
ac mutate --check [<n>] [--json]  # which tool applies, is it installed, how to install it (read-only)
ac mutate setup                # write a minimal tool config if absent (the only writer; installs nothing)
ac mutate dismiss [<tool>]     # stop the full install suggestion for this project
ac verify calibrate [--defects N] [--runs K] [--seed S] [--budget USD] [--yes] [--json]  # verifier false-PASS rate (bill first)
ac phase effort <n> deep       # per-phase verify→remediate budget (light|standard|deep)
ac phase note <n> "<text>"     # durable phase note (survives ROADMAP.md renders)
ac phase note <n> --append "…" # add a line to it; --replace overwrites (a plain write never drops a note)
ac phase milestone <n> [<N>]   # read/correct a phase's milestone (never moves the project)
ac milestone new               # claim the next milestone number and start it
ac milestone new --planned     # declare a later milestone without starting it (--number N: repair)
ac milestone activate <n>      # move the project into a planned milestone
ac milestone rename <n> "<name>"  # correct a milestone's name (any status; changes the name only)
ac milestone complete          # archive the current milestone's phases (refuses over unfinished ones; --force)
ac milestone harvest [<n>] [--json]  # retrospective sweep material for the principle sweep

ac fix add "<what is broken>"  # open a bugfix (dated id, no phase number)
ac fix list [--all]            # what is open (--all: accepted too, with who signed and any citation)
ac fix accept <id>             # human gate — archives it
ac fix accept <id> --agent <n> # machine-signed (ADR-033): records accepted_kind=agent

ac debt list [--stale]         # open technical debt (the verifier files it automatically)
ac debt score                  # pay-it-down-now signal, 0-100, with the evidence
ac debt note <id> ["…"] [--append|--replace]  # add what you learn later; the id and age stay
ac debt pay <id> [--as phase] [--milestone N]  # graduate it into a fix (default) or a roadmap phase
ac debt drop <id> --reason "…" # it WAS true and stopped being true
ac debt dismiss <id> --reason … # it was NEVER true — the verifier was wrong

ac backlog add "<idea>"        # capture an idea (no file, no phase number spent)
ac backlog list                # open ideas, oldest first
ac backlog note <id> ["<text>"] # read/set/clear an item's note (the title stays fixed); --append / --replace as for phases
ac backlog link <id> --phase N # fold it into a phase already in flight
ac backlog promote <id>        # claim a phase number and seed CONTEXT.md from it
ac backlog archive <id> --kind declined|obsolete --reason "…" # file it WITHOUT doing it

ac principles add "<stmt>" --kind principle|pattern|preference|antipattern  # a personal note in ~/.astro/principles (--propose queues it)
ac principles list [--proposed|--accepted|--rejected|--all] [--json]  # the personal store (default: accepted)
ac principles show <id> [--json] # one entry — fields, source, promotions, history
ac principles accept <id> [--edit | --statement … [--why …]] # proposed → accepted (reword first)
ac principles reject <id> --reason … # proposed → rejected (kept, never deleted)
ac principles retire <id> --reason … # accepted → retired
ac principles supersede <id> --by <id> # accepted → superseded by a newer entry
ac principles amend <id> --reason … [--statement … | --edit] # reword/rescope, id unchanged
ac principles promote <id> [--as decision|convention] # accepted → this project's canon (personal copy stays)
ac principles remote [<url>]   # set (and sync) the store's private git remote, or print it
ac principles resolve <id> [--take mine|theirs] # clear an open sync conflict on one entry
ac principles list|show … --no-sync # read-only: skip the git sync entirely — for a foreign, read-only consumer

ac models balanced             # per-role model tier + reasoning depth, in one switch
ac config set models.executor opus
ac stats                       # token usage (fresh vs cheap cache reads) + wall-clock
ac registry init|show          # the shared numbering registry
ac canon pull|push             # the shared conventions + decisions
ac decision add "<t>" --why …  # append an ADR-lite decision (shared)
ac agents-md                   # refresh the astro-code block in AGENTS.md
ac preflight                   # warn if HEAD diverged from upstream
ac tune                        # apply recommended Claude settings (additive, `--undo`able)
ac fleet connect <url> --token <t>  # report sessions to an Astro Fleet (see Astro Fleet)
ac install | uninstall | update
ac doctor [--json]             # is the install consistent? exit 1 on any problem
ac --version                   # astro-code's version
```

---

## Layout and development

```
bin/ac.mjs   the CLI            commands/   slash commands (the loop)
lib/         engine (tested)    agents/     subagent roles
templates/   .astrocode/ seed   workflows/  Workflow scripts
```

```bash
npm test     # engine units + a real bare-remote registry/canon integration test
```
