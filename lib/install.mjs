// Install/uninstall astro-code into the user path.
//
// Files live in the home (~/.astro/code) — astro-code's own namespace. From
// there they are published into each HOST's config dirs. Everything this module
// does is host-agnostic: copy into the home, prune what was renamed away, link
// into a config dir, stamp the version. Anything that knows what a particular
// harness looks like — where its config lives, how it discovers commands, how
// its hooks and status line are wired — belongs in lib/hosts/<id>.mjs.
//
// Claude Code publishes by SYMLINKING markdown into every config dir it reads:
//   - the base config dir (~/.claude), and
//   - every jean-claude profile (read from ~/.claude/.jean-claude/profiles.json).
// This mirrors jean-claude's own model (shared files in base, symlinked per profile)
// so the commands show up in ALL profiles, not just the active one.
import { mkdirSync, readdirSync, copyFileSync, cpSync, existsSync, rmSync, symlinkSync, lstatSync, readlinkSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import claudeHost from './hosts/claude.mjs';
import { detectHosts, HOSTS } from './hosts/index.mjs';

// Re-exported so existing callers keep importing these from here. The
// implementations moved into the Claude adapter; the names did not move.
export const baseConfigDir = claudeHost.baseConfigDir;
export const configTargets = claudeHost.configTargets;

export const ASTRO_HOME = join(homedir(), '.astro', 'code');

function copyDir(src, dest, ext) {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let n = 0;
  const kept = new Set();
  for (const f of readdirSync(src)) {
    if (!f.endsWith(ext)) continue;
    copyFileSync(join(src, f), join(dest, f));
    kept.add(f);
    n++;
  }
  // Prune stale copies: a command/agent/hook RENAMED or DELETED in source must not
  // linger in the home mirror, or it would keep being symlinked into every config dir
  // as a dead entry (the failure mode when a shipped command is renamed). Only touch
  // our own `ext` files; leave anything else in the dir alone.
  for (const f of readdirSync(dest)) {
    if (!f.endsWith(ext) || kept.has(f)) continue;
    rmSync(join(dest, f), { force: true });
  }
  return n;
}

const isSymlink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

// Two paths are the SAME physical directory when they share device + inode. This is the
// only check that survives BOTH symlinks and bind mounts — resolve()/realpath() collapse
// a symlink but NOT a bind mount, and some sandboxes bind-mount a config dir's commands/
// or agents/ onto the framework checkout at a different top-level path. A missing dir (the
// normal fresh-config case) is not the source, so symlink there as usual.
function sameDir(a, b) {
  try {
    const sa = statSync(a);
    const sb = statSync(b);
    return sa.ino === sb.ino && sa.dev === sb.dev;
  } catch {
    return false;
  }
}

function symlinkInto(srcDir, destDir) {
  if (!existsSync(srcDir)) return 0;
  mkdirSync(destDir, { recursive: true });
  let n = 0;
  for (const f of readdirSync(srcDir)) {
    if (!f.endsWith('.md')) continue;
    const link = join(destDir, f);
    if (existsSync(link) || isSymlink(link)) rmSync(link, { force: true });
    symlinkSync(join(srcDir, f), link);
    n++;
  }
  // Prune framework-owned symlinks whose target vanished — a command RENAMED or DELETED
  // in source (its home copy already pruned by copyDir) leaves a dead link here that
  // would otherwise show up in Claude as a broken command. Only touch symlinks pointing
  // into ASTRO_HOME, never a user's own files or links.
  for (const f of readdirSync(destDir)) {
    if (!f.endsWith('.md')) continue;
    const link = join(destDir, f);
    if (!isSymlink(link)) continue;
    let target = '';
    try { target = readlinkSync(link); } catch { /* unreadable → dangling, drop it */ }
    if (target.startsWith(ASTRO_HOME) && !existsSync(link)) rmSync(link, { force: true });
  }
  return n;
}

// Stamp the framework version into the home so the statusline can show it without
// depending on the clone still existing. Read from the clone's package.json (the source
// of truth) — NEVER from any stale package.json that may linger under ASTRO_HOME.
export function writeVersion(frameworkRoot) {
  try {
    const v = (JSON.parse(readFileSync(join(frameworkRoot, 'package.json'), 'utf8')) || {}).version;
    if (!v) return null;
    mkdirSync(ASTRO_HOME, { recursive: true });
    writeFileSync(join(ASTRO_HOME, 'version'), String(v) + '\n');
    return v;
  } catch {
    return null;
  }
}

// Copy a whole directory tree (nested dirs, mixed extensions — e.g. templates/kit/),
// unlike the flat single-extension copyDir above. Skips when src and dest are the
// same physical dir (self-hosted: the home IS the framework checkout).
function copyTree(src, dest) {
  if (!existsSync(src) || sameDir(src, dest)) return false;
  cpSync(src, dest, { recursive: true, force: true });
  return true;
}

/**
 * Write rendered files into a host's config dir, pruning our own stale ones.
 *
 * Only entries named `astro-*` are ever removed: a command RENAMED or deleted
 * upstream must not linger as a dead entry in someone's slash menu, but nothing
 * the user put there themselves may be touched. Directories are pruned too,
 * because a Codex agent is a directory rather than a file.
 */
function publishFiles(fileList, destDir) {
  mkdirSync(destDir, { recursive: true });

  // Clear each entry we own BEFORE writing it. Pruning only at the top level
  // leaves stale files INSIDE a directory that is still legitimately ours: when
  // commands stopped emitting agents/openai.yaml, the old sidecar survived
  // inside every astro-* skill dir and kept suppressing its own discovery. The
  // whole `astro-*` entry is framework-owned, so replacing it wholesale is the
  // only way to guarantee the result matches the source exactly.
  const owned = new Set(fileList.map((f) => f.path.split('/')[0]));
  for (const entry of owned) {
    if (!entry.startsWith('astro-')) continue;
    rmSync(join(destDir, entry), { recursive: true, force: true });
  }

  const wrote = new Set();
  for (const f of fileList) {
    const full = join(destDir, f.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, f.content);
    wrote.add(f.path.split('/')[0]);   // top-level entry we own
  }
  for (const entry of readdirSync(destDir)) {
    if (!entry.startsWith('astro-')) continue;      // never our business
    if (wrote.has(entry)) continue;
    rmSync(join(destDir, entry), { recursive: true, force: true });
  }
  return wrote.size;
}

/** Render one kind (commands|agents) through a host. Returns the file list. */
function renderKind(host, frameworkRoot, kind) {
  const srcDir = join(frameworkRoot, kind);
  if (!existsSync(srcDir)) return [];
  const render = kind === 'commands' ? host.renderCommand : host.renderAgent;
  const out = [];
  for (const f of readdirSync(srcDir)) {
    if (!f.endsWith('.md')) continue;
    const name = f.replace(/\.md$/, '');
    out.push(...render(name, readFileSync(join(srcDir, f), 'utf8')));
  }
  return out;
}

/**
 * Publish every kind for a copy-mode host, grouped by destination directory.
 *
 * Grouping is not cosmetic. Codex puts BOTH commands and agents in skills/, and
 * publishFiles prunes stale `astro-*` entries it did not just write — so
 * publishing the two kinds in separate passes would have the second pass delete
 * everything the first one wrote. Counts are returned per kind for the install
 * report, but the write and the prune happen once per directory.
 */
function publishCopyHost(host, frameworkRoot, dir) {
  const byDir = new Map();
  const counts = {};
  for (const kind of ['commands', 'agents']) {
    const files = renderKind(host, frameworkRoot, kind);
    counts[kind] = new Set(files.map((f) => f.path.split('/')[0])).size;
    const dest = join(dir, host.placement[kind]);
    if (!byDir.has(dest)) byDir.set(dest, []);
    byDir.get(dest).push(...files);
  }
  for (const [dest, files] of byDir) publishFiles(files, dest);
  return counts;
}

export function installClaude(frameworkRoot) {
  writeVersion(frameworkRoot);
  const commands = copyDir(join(frameworkRoot, 'commands'), join(ASTRO_HOME, 'commands'), '.md');
  const agents = copyDir(join(frameworkRoot, 'agents'), join(ASTRO_HOME, 'agents'), '.md');
  const workflows = copyDir(join(frameworkRoot, 'workflows'), join(ASTRO_HOME, 'workflows'), '.mjs');
  const hooks = copyDir(join(frameworkRoot, 'hooks'), join(ASTRO_HOME, 'hooks'), '.mjs');
  // Scaffold sources commands read via `ac path templates` (e.g. /astro-kit-new).
  copyTree(join(frameworkRoot, 'templates'), join(ASTRO_HOME, 'templates'));

  // Publish to every host actually present. If none are — a fresh machine, or
  // astro-code installed before any harness — fall back to Claude Code and
  // create its config dir, which is what this has always done. Installing
  // nothing and reporting success is indistinguishable from a working install
  // until the commands turn out to be missing.
  const hosts = detectHosts();
  if (!hosts.length) hosts.push(claudeHost);

  const linked = [];
  for (const host of hosts) {
  for (const [dir, label] of host.configTargets()) {
    // Self-hosted guard: a config dir's commands/ or agents/ can BE the framework's own
    // source dir — not only when the config dir equals the clone, but when the sandbox
    // bind-mounts those subdirs onto the checkout (a DIFFERENT top-level path, the SAME
    // physical dir). Symlinking the ~/.astro/code copies there would clobber tracked
    // source with links (a wall of `git` typechanges). Compare by device+inode per subdir
    // and skip the ones that ARE the source. Hooks wiring stays (it's additive).
    const cmdSelf = sameDir(join(dir, host.placement.commands), join(frameworkRoot, 'commands'));
    const agtSelf = sameDir(join(dir, host.placement.agents), join(frameworkRoot, 'agents'));
    const symlinked = host.placement.mode === 'symlink';
    const copied = symlinked ? null : publishCopyHost(host, frameworkRoot, dir);
    linked.push({
      host: host.id,
      hostLabel: host.label,
      label,
      dir,
      selfHosted: cmdSelf || agtSelf,
      commands: cmdSelf ? 0 : symlinked
        ? symlinkInto(join(ASTRO_HOME, 'commands'), join(dir, host.placement.commands))
        : copied.commands,
      agents: agtSelf ? 0 : symlinked
        ? symlinkInto(join(ASTRO_HOME, 'agents'), join(dir, host.placement.agents))
        : copied.agents,
      hooks: host.registerHooks(dir, ASTRO_HOME),
    });
  }
  }
  return { home: ASTRO_HOME, commands, agents, workflows, hooks, targets: linked };
}

// Deploy just the statusline machinery: copy the hooks into the home and (re)wire
// each config dir's `statusLine` at our composing wrapper. Used by `/astro-statusline`
// to set/refresh the rich line without a full reinstall. Idempotent.
export function installStatusline(frameworkRoot) {
  writeVersion(frameworkRoot);
  const hooks = copyDir(join(frameworkRoot, 'hooks'), join(ASTRO_HOME, 'hooks'), '.mjs');
  const wired = [];
  for (const [dir, label] of configTargets()) {
    wired.push({ dir, label, ok: claudeHost.registerHooks(dir, ASTRO_HOME) });
  }
  return { hooks, wired };
}

export function uninstallClaude() {
  let removed = 0;
  // Every host we know about, not just the detected ones: a harness whose
  // config dir was deleted after install would otherwise leave astro files
  // behind forever, and uninstall must be able to clean up after itself.
  for (const host of HOSTS) {
    for (const [dir] of host.configTargets()) {
      // restore settings.json BEFORE we delete the home (the chain map lives there)
      host.unregisterHooks(dir, ASTRO_HOME);

      if (host.placement.mode === 'symlink') {
        for (const sub of [host.placement.commands, host.placement.agents]) {
          const homeSub = join(ASTRO_HOME, sub === host.placement.agents ? 'agents' : 'commands');
          const destSub = join(dir, sub);
          if (!existsSync(homeSub) || !existsSync(destSub)) continue;
          for (const f of readdirSync(homeSub)) {
            if (!f.endsWith('.md')) continue;
            const link = join(destSub, f);
            if (!isSymlink(link)) continue;
            let target = '';
            try {
              target = readlinkSync(link);
            } catch { /* dangling — safe to remove */ }
            if (!target || target.startsWith(ASTRO_HOME)) {
              rmSync(link, { force: true });
              removed++;
            }
          }
        }
        continue;
      }

      // Copy-mode hosts: remove only the `astro-*` entries we wrote, never
      // anything the user placed in the same directory.
      for (const sub of [host.placement.commands, host.placement.agents]) {
        const destSub = join(dir, sub);
        if (!existsSync(destSub)) continue;
        for (const entry of readdirSync(destSub)) {
          if (!entry.startsWith('astro-')) continue;
          rmSync(join(destSub, entry), { recursive: true, force: true });
          removed++;
        }
      }
    }
  }
  if (existsSync(ASTRO_HOME)) rmSync(ASTRO_HOME, { recursive: true, force: true });
  return { removed, home: ASTRO_HOME };
}
