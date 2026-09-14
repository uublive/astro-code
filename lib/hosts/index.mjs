// The host registry.
//
// astro-code's loop (discuss → plan → execute → verify), its registry, roadmap,
// canon and wave layering are all host-agnostic — 16 of 19 lib modules have no
// idea which agent harness is driving them. What differs per host is only:
//
//   1. where its config lives, and which dirs to populate
//   2. how commands/agents are discovered (path, file format)
//   3. how session hooks / the status line are wired
//   4. how to run ONE headless agent  (added with the first non-Claude host)
//
// A host adapter answers exactly those. Today Claude Code is the only entry;
// the shape exists so adding Pi or Codex is a new file here rather than a
// rewrite of install.mjs — the three were researched together precisely so
// this contract would not have to be retrofitted around a second one.
//
// ## The contract
//
//   id            string, stable, used in config + CLI output
//   label         human-readable name for install output
//   placement     { commands, agents, ext, mode } — where files land in a
//                 config dir and how they get there ('symlink' | 'copy')
//   detect()      boolean: is this host present on the machine?
//   configTargets()  Map<dir, label> — every config dir to populate
//   registerHooks(dir, home)    wire hooks/status line; returns boolean
//   unregisterHooks(dir, home)  reverse it
//
// Every function that needs the astro home takes it as an argument. Adapters
// must NOT capture it at module load: the install tests re-import with a
// cache-busting query to swap in a fake $HOME, and a module-level constant
// would be frozen at first import and silently ignore it.
import claudeHost from './claude.mjs';

/** Every known host adapter, in install order. */
export const HOSTS = [claudeHost];

/** Look one up by id. */
export function getHost(id) {
  return HOSTS.find((h) => h.id === id) || null;
}

/**
 * The hosts actually present on this machine.
 *
 * `ac install` wires whichever it finds rather than assuming one, so a machine
 * with two harnesses gets both from a single command. An empty result is a
 * reportable condition — never a silent success — because "installed nothing,
 * said nothing" is indistinguishable from a working install until the commands
 * turn out to be missing.
 */
export function detectHosts() {
  return HOSTS.filter((h) => {
    try {
      return h.detect();
    } catch {
      return false;
    }
  });
}
