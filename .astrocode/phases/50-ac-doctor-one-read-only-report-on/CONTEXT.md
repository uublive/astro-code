<!-- astro-discuss: captured -->
# Phase 50 — `ac doctor`: one read-only report on whether the install and its hooks are consistent

## Why
GitHub #159 (@luigi-lauro): "is my install consistent?" has been answered one cause at a time
(#15 additionalDirectories, #40 stale update cache, #126 dead Homebrew node path), each after
someone hit it. This week added two more silent drifts: hook registrations naming scripts the home
copy lacks (open fix 2026-10-12-hook-registrations-can-point-at-scripts) and the astro-mods plugin
manifest stuck at 0.41.0, so `ac update` never refreshed the band. The symptom never names its
cause, and nothing answers between updates.

## Goal
`ac doctor [--json]` names every known install drift on every installed host, one short line per
check, with the exact command that fixes each problem; exits non-zero when something is wrong and 0
on a clean install with no false warning. `ac --version` exists. `ac update` ends by running the
doctor and prints only failures.

## Decisions (Matteo, in this session)

D1 — **Checks: the issue's six plus this week's two.**
1. Version: the installed version file against the clone; the update-check cache's age (#40).
2. Hook commands: every astro hook entry's interpreter exists and runs, per config dir (#126).
3. Hook registrations against the mods switches (ADR-072: the switch is the registration).
4. Command and agent links/copies per config dir: target exists, none missing against the shipped
   set, no stale ones left in dirs install no longer targets (backlog item, folded in).
5. The `additionalDirectories` grant for `ac path` (#15).
6. Registry drift via the existing `ac canon check`.
7. NEW: every hook script a settings.json registration names exists in the home copy (closes fix
   2026-10-12-hook-registrations-can-point-at-scripts).
8. NEW: the installed astro-mods plugin's version (Claude Code's plugin cache / installed_plugins)
   matches astro-code's own version.

D2 — **Report only, never repair.** Read-only, writes nothing, spawns no package manager. Each
problem line ends with the exact command that fixes it (`ac update`, `ac mods enable …`, …).
Exit non-zero when any check fails. Principle e618: short and plain, data first.

D3 — **Every installed host.** Command/agent placement checks for Claude Code, Codex, Cursor and
OpenCode (through the host adapters in lib/hosts/); hook/statusline/plugin checks where a host has
them (Claude Code; Cursor hooks.json where present). A host that is not installed is not reported.

D4 — **`ac update` ends with the doctor, failures only.** Nothing printed when clean. No session-start
cost (no banner check).

## Also in scope (folded in)
- Backlog `2026-09-21-add-ac-version-so-bug-reports-can-state`: `ac --version` (linked to phase 50).
- Backlog `2026-09-22-ac-install-leaves-stale-command`: check 4 finds stale links (linked).
- Fix `2026-10-12-hook-registrations-can-point-at-scripts`: check 7; the fix closes when this phase
  is accepted.
- `ac doctor --json` is a stable shape for bug reports (one object per check: id, host/dir, ok,
  detail, fix).
- Docs (MANUAL, CHANGELOG, `ac help`), tests with temp config dirs reproducing #15, #126, the stale
  link, the missing hook script and the stale plugin version — each named exactly, and a clean
  install reporting no warning.

## Out
- Any repair (`--fix`), session-start checks, project-health checks beyond registry drift.
- New installer behaviour (doctor only reads).

## Open / for the planner
- Where each host keeps commands/agents and which have hooks: read from lib/hosts/*.mjs (placement,
  configTargets, detect) — never a second copy of that knowledge (principle 9173).
- How to read Claude Code's plugin version without spawning `claude` (installed_plugins.json /
  cache path) and what to say when that layout is absent.
