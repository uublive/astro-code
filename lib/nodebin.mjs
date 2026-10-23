// The node binary written into hook commands, and the repair of commands already written (#126).
//
// `process.execPath` is the resolved binary. Under Homebrew that is the versioned
// `.../Cellar/node/<version>/bin/node`, which `brew upgrade node` deletes, so every astro hook
// then fails with "No such file". The PATH entry (`/home/linuxbrew/.linuxbrew/bin/node`) is a
// symlink that survives upgrades: it is preferred whenever it resolves to the same binary,
// otherwise `process.execPath` is kept. Entries were matched by script name only, so an
// install never noticed a dead interpreter; `repairNodeCommands` rewrites the interpreter of
// astro's own commands on every install and update.
import { realpathSync } from 'node:fs';
import { basename, delimiter, join } from 'node:path';

/** A node path that survives a package-manager upgrade, when PATH has one for this binary. */
export function nodeBin({ env = process.env, execPath = process.execPath } = {}) {
  let real;
  try { real = realpathSync(execPath); } catch { return execPath; }
  for (const dir of String(env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'node');
    try { if (realpathSync(candidate) === real) return candidate; } catch { /* not there */ }
  }
  return execPath;
}

// `"<interpreter>" "<script>" …` or `<interpreter> <script> …`. The doctor (phase 50) reads every
// hook command through `hookCommandParts`: it is the one parser of this shape (9173).
// A script is astro's own when it is one of its hook files (astro-*.mjs, _astro-*.mjs).
const SHAPE = /^\s*(?:"([^"]+)"|(\S+))(\s+)(?:"([^"]+)"|(\S+))/;
const ASTRO_SCRIPT = /^_?astro-[\w-]+\.mjs$/;

/** `{ interp, script, rest }` of a hook command (`rest` is what follows the script); null if it has no script token. */
export function hookCommandParts(command) {
  if (typeof command !== 'string') return null;
  const m = command.match(SHAPE);
  if (!m) return null;
  return { interp: m[1] ?? m[2], script: m[4] ?? m[5], rest: command.slice(m[0].length) };
}

/** True when the script path is one of astro's own hook files. */
export function isAstroScript(path) {
  return typeof path === 'string' && ASTRO_SCRIPT.test(basename(path));
}

/** The command with its interpreter set to `node` when it runs an astro hook script; else as is. */
export function repairNodeCommand(command, node) {
  const parts = hookCommandParts(command);
  if (!parts) return command;
  const { interp, script } = parts;
  if (!/^node(\.exe)?$/i.test(basename(interp)) || !isAstroScript(script) || interp === node) return command;
  const lead = command.length - command.trimStart().length;
  const end = lead + (command[lead] === '"' ? interp.length + 2 : interp.length);
  return `"${node}"${command.slice(end)}`;
}

/** Walk a settings/hooks object and repair every `command` string in place; returns how many changed. */
export function repairNodeCommands(data, node) {
  let changed = 0;
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'command' && typeof x === 'string') {
        const fixed = repairNodeCommand(x, node);
        if (fixed !== x) { v[k] = fixed; changed++; }
      } else walk(x);
    }
  };
  walk(data);
  return changed;
}
