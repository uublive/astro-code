#!/usr/bin/env node
// `ac` — the astro-code CLI. A thin, atomic state layer; the heavy thinking lives
// in the markdown commands/agents and the Workflow scripts that Claude Code runs.
import process from 'node:process';
import { existsSync } from 'node:fs';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, paths } from '../lib/paths.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { loadState, updateState } from '../lib/state.mjs';
import { loadRoadmap, addPhase, renderRoadmap, findPhase, setPhaseStatus, isPhasePlanned } from '../lib/roadmap.mjs';
import { gitIdentity } from '../lib/git.mjs';
import { claim, readRegistry, registryBranch, markComplete, findNameMatches } from '../lib/registry.mjs';
import { loadConfig, updateConfig } from '../lib/config.mjs';
import { canonText, loadCanon, addDecision, canonPull, canonPush } from '../lib/canon.mjs';
import { completeMilestone } from '../lib/milestone.mjs';
import { installClaude, uninstallClaude, ASTRO_HOME } from '../lib/install.mjs';

function parseArgs(args) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = args[i + 1] != null && !args[i + 1].startsWith('--') ? args[++i] : true;
      flags[key] = val;
    } else {
      pos.push(a);
    }
  }
  return { flags, pos };
}

const die = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};
const root = () => findRoot() || die('no .astrocode/ found — run `ac init` first');
const json = (obj) => console.log(JSON.stringify(obj, null, 2));

// Warn about other developers' claims with the same / similar name.
function warnNameMatches(matches, me) {
  const others = (matches || []).filter((m) => m.owner !== me);
  if (!others.length) return;
  console.log('  ⚠ possible duplicate work — already claimed by another developer:');
  for (const m of others) {
    const where = m.type === 'phase' ? `phase ${m.number} (milestone ${m.milestone})` : `milestone ${m.number}`;
    console.log(`    - ${m.match}: "${m.name}" — ${where} by ${m.owner} on ${m.branch}`);
  }
}

const FRAMEWORK_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// After `ac install`, the Claude-facing framework (esp. workflows) lives in the
// home; prefer it so `ac path workflows` resolves there from any project.
const HOME_ROOT = existsSync(ASTRO_HOME) ? ASTRO_HOME : FRAMEWORK_ROOT;

const [cmd, ...tail] = process.argv.slice(2);
const { flags, pos } = parseArgs(tail);

const HELP = `astro-code — lean, multi-developer planning for Claude Code

  ac init [--name N] [--vision "…"]   scaffold .astrocode/ in the current dir
  ac status                           show project / milestone / phases
  ac state get [key]                  print state (or one field)
  ac state set <key> <value>          atomically update a state field
  ac roadmap list                     list phases
  ac roadmap render                   regenerate .astrocode/ROADMAP.md
  ac milestone new [--name "…"]       claim the next milestone number (+ dup-name check)
  ac milestone check "<name>"         see if a milestone with a similar name exists
  ac milestone complete               archive the current milestone + retire its claims
  ac phase add <name> [--milestone N] claim the next phase number + add it (+ dup-name check)
  ac phase check "<name>"             see if a phase with a similar name exists
  ac phase verify <phase>             mark a phase verified (AI gate passed)
  ac phase accept <phase> [--by N]    UAT sign-off → complete (requires verified)
  ac phase reject <phase> --reason …  UAT failed → rejected + record a blocker
  ac claim <milestone|phase> [m]      raw number claim (prints the number)
  ac config [get [k] | set k v | unset k]  read/update .astrocode/config.json (incl. models)
  ac canon [pull | push]              print canon; pull/push shares it on the orphan branch
  ac decision add "<t>" [--why …] [--rejected …]   append an ADR-lite decision (shared)
  ac decision list                    list recorded decisions
  ac registry show                    print the shared numbering registry
  ac install | uninstall              (un)install commands + agents into ~/.claude
  ac path [sub]                       print the framework dir (e.g. ac path workflows)
  ac help                             this help
`;

async function main() {
  switch (cmd) {
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      process.stdout.write(HELP);
      return;

    case 'init': {
      const cwd = process.cwd();
      const res = initPlanning(cwd, {
        name: typeof flags.name === 'string' ? flags.name : basename(cwd),
        vision: typeof flags.vision === 'string' ? flags.vision : '',
      });
      console.log(res.created ? `✓ ${res.message}` : `• ${res.message}`);
      return;
    }

    case 'status': {
      const r = root();
      const st = loadState(r) || {};
      const rm = loadRoadmap(r);
      const reg = readRegistry(r);
      console.log(`Project:   ${st.project ?? '?'}`);
      console.log(`Status:    ${st.status ?? '?'}`);
      console.log(`Milestone: ${rm.milestone}   (active phase: ${st.active_phase ?? '—'})`);
      console.log(`Registry:  ${reg.available ? `${registryBranch(r)} @ origin (team-coordinated)` : 'local only (no remote)'}`);
      console.log('Phases:');
      if (!rm.phases.length) console.log('  (none)');
      for (const ph of rm.phases) {
        const planned = isPhasePlanned(r, ph.slug) ? 'planned' : 'not planned';
        console.log(`  ${String(ph.number).padStart(2, '0')}  ${ph.status.padEnd(9)} ${ph.name}  (${planned})`);
      }
      if (st.blockers?.length) console.log(`Blockers:  ${st.blockers.length}`);
      return;
    }

    case 'state': {
      const r = root();
      if (pos[0] === 'get') {
        const st = loadState(r) || {};
        if (pos[1]) json(st[pos[1]] ?? null);
        else json(st);
      } else if (pos[0] === 'set') {
        const [, key, ...valParts] = pos;
        if (!key) die('usage: ac state set <key> <value>');
        const raw = valParts.join(' ');
        let value = raw;
        try { value = JSON.parse(raw); } catch { /* keep as string */ }
        const next = await updateState(r, (s) => ({ ...s, [key]: value }));
        json({ [key]: next[key] });
      } else {
        die('usage: ac state <get|set> …');
      }
      return;
    }

    case 'roadmap': {
      const r = root();
      if (pos[0] === 'render') {
        renderRoadmap(r);
        console.log(`✓ wrote ${paths(r).roadmapMd}`);
      } else {
        const rm = loadRoadmap(r);
        json(rm);
      }
      return;
    }

    case 'milestone': {
      const r = root();
      if (pos[0] === 'new') {
        const name = typeof flags.name === 'string' ? flags.name : pos.slice(1).join(' ').trim();
        const res = claim({ root: r, type: 'milestone', name });
        if (res.source === 'error') die(`claim failed: ${res.error}`);
        await updateState(r, (s) => ({ ...s, active_milestone: res.number, status: 'planning' }));
        const rm = loadRoadmap(r);
        rm.milestone = res.number;
        renderRoadmap(r);
        console.log(`✓ milestone ${res.number}${name ? ` "${name}"` : ''} [${res.source}] — ${res.message ?? ''}`);
        warnNameMatches(res.matches, gitIdentity(r).owner);
      } else if (pos[0] === 'check') {
        const name = pos.slice(1).join(' ').trim();
        if (!name) die('usage: ac milestone check "<name>"');
        const mres = findNameMatches(r, { type: 'milestone', name });
        if (!mres.available) console.error('• no coordinated remote — cannot check across the team');
        else if (!mres.matches.length) console.log(`✓ no milestone named like "${name}" in the registry`);
        else {
          const me = gitIdentity(r).owner;
          console.log(`possible matches for "${name}":`);
          for (const m of mres.matches) {
            const who = m.owner === me ? `${m.owner} (you)` : m.owner;
            console.log(`  - ${m.match}: "${m.name}" — milestone ${m.number} by ${who} on ${m.branch}`);
          }
        }
      } else if (pos[0] === 'complete') {
        const arch = await completeMilestone(r);
        const released = markComplete({ root: r, milestone: arch.milestone });
        await updateState(r, (s) => ({ ...s, status: 'milestone-complete', active_phase: null }));
        console.log(`✓ milestone ${arch.milestone} complete — archived ${arch.archived} phase(s) → ${arch.archiveDir}`);
        if (released.ok && released.source === 'remote') console.log(`  retired ${released.changed} registry claim(s)`);
        console.log('  start the next cycle with `ac milestone new`');
      } else {
        die('usage: ac milestone <new [--name …]|check "<name>"|complete>');
      }
      return;
    }

    case 'phase': {
      const r = root();
      const sub = pos[0];

      if (sub === 'add') {
        const name = pos.slice(1).join(' ').trim();
        if (!name) die('phase name required: ac phase add <name>');
        const st = loadState(r) || {};
        const rm = loadRoadmap(r);
        const milestone = Number(flags.milestone) || st.active_milestone || rm.milestone || 1;
        const res = claim({ root: r, type: 'phase', milestone, name });
        if (res.source === 'error') die(`claim failed: ${res.error}`);
        const phase = await addPhase(r, { number: res.number, name, milestone });
        const tag = res.source === 'remote' ? `[registry: ${res.branch}]` : '[local]';
        console.log(`✓ phase ${phase.number} "${name}" (milestone ${milestone}) ${tag}`);
        if (res.source === 'local') console.log('  ⚠ not team-coordinated (no remote) — numbers may collide on merge');
        warnNameMatches(res.matches, gitIdentity(r).owner);
        return;
      }

      if (sub === 'check') {
        const name = pos.slice(1).join(' ').trim();
        if (!name) die('usage: ac phase check "<name>"');
        const res = findNameMatches(r, { type: 'phase', name });
        if (!res.available) console.error('• no coordinated remote — cannot check across the team');
        else if (!res.matches.length) console.log(`✓ no phase named like "${name}" in the registry`);
        else {
          const me = gitIdentity(r).owner;
          console.log(`possible matches for "${name}":`);
          for (const m of res.matches) {
            const who = m.owner === me ? `${m.owner} (you)` : m.owner;
            console.log(`  - ${m.match}: "${m.name}" — phase ${m.number} (milestone ${m.milestone}) by ${who} on ${m.branch}`);
          }
        }
        return;
      }

      const ph = findPhase(r, pos[1]);
      if (sub === 'verify') {
        if (!ph) die('usage: ac phase verify <phase>');
        await setPhaseStatus(r, ph.slug, 'verified');
        console.log(`✓ phase ${ph.number} "${ph.name}" → verified (run /astro-accept for UAT to close)`);
      } else if (sub === 'accept') {
        if (!ph) die('usage: ac phase accept <phase> [--by name] [--force]');
        if (ph.status !== 'verified' && !flags.force) {
          die(`phase ${ph.number} is "${ph.status}", not verified — run /astro-verify first (or pass --force)`);
        }
        const by = typeof flags.by === 'string' ? flags.by : gitIdentity(r).owner;
        await setPhaseStatus(r, ph.slug, 'complete', { accepted_by: by, accepted_at: new Date().toISOString() });
        await updateState(r, (s) => ({ ...s, active_phase: s.active_phase === ph.slug ? null : s.active_phase }));
        console.log(`✓ phase ${ph.number} "${ph.name}" accepted by ${by} → complete`);
      } else if (sub === 'reject') {
        if (!ph) die('usage: ac phase reject <phase> --reason "…"');
        const reason = typeof flags.reason === 'string' ? flags.reason : '';
        await setPhaseStatus(r, ph.slug, 'rejected');
        await updateState(r, (s) => ({ ...s, blockers: [...(s.blockers || []), { phase: ph.slug, reason, at: new Date().toISOString() }] }));
        console.log(`✗ phase ${ph.number} "${ph.name}" → rejected${reason ? `: ${reason}` : ''}`);
      } else {
        die('usage: ac phase <add|verify|accept|reject> …');
      }
      return;
    }

    case 'claim': {
      const r = root();
      const type = pos[0];
      if (type !== 'milestone' && type !== 'phase') die('usage: ac claim <milestone|phase> [milestone-number]');
      const milestone = type === 'phase' ? Number(pos[1]) : undefined;
      if (type === 'phase' && !Number.isInteger(milestone)) die('usage: ac claim phase <milestone-number>');
      const res = claim({ root: r, type, milestone });
      if (res.source === 'error') die(`claim failed: ${res.error}`);
      console.log(res.number); // machine-readable: just the number on stdout
      console.error(`[${res.source}] ${res.message ?? ''}`);
      return;
    }

    case 'registry': {
      const r = root();
      if (pos[0] !== 'show') die('usage: ac registry show');
      const reg = readRegistry(r);
      if (!reg.available) {
        console.error('no coordinated remote — registry is local-only');
        json({ available: false });
      } else {
        json(reg.registry);
      }
      return;
    }

    case 'config': {
      const r = root();
      const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
      if (pos[0] === 'set') {
        const [, key, ...valParts] = pos;
        if (!key) die('usage: ac config set <key[.subkey]> <value>');
        const raw = valParts.join(' ');
        let value = raw;
        try { value = JSON.parse(raw); } catch { /* keep string */ }
        const segs = key.split('.');
        const next = await updateConfig(r, (c) => {
          let node = c;
          for (let i = 0; i < segs.length - 1; i++) {
            if (node[segs[i]] == null || typeof node[segs[i]] !== 'object') node[segs[i]] = {};
            node = node[segs[i]];
          }
          node[segs[segs.length - 1]] = value;
          return c;
        });
        json({ [key]: getPath(next, key) });
      } else if (pos[0] === 'unset') {
        const key = pos[1];
        if (!key) die('usage: ac config unset <key[.subkey]>');
        const segs = key.split('.');
        await updateConfig(r, (c) => {
          let node = c;
          for (let i = 0; i < segs.length - 1; i++) {
            if (node[segs[i]] == null || typeof node[segs[i]] !== 'object') return c;
            node = node[segs[i]];
          }
          delete node[segs[segs.length - 1]];
          return c;
        });
        json({ unset: key });
      } else if (pos[0] === 'get') {
        const cfg = loadConfig(r);
        json(pos[1] ? (getPath(cfg, pos[1]) ?? null) : cfg);
      } else {
        json(loadConfig(r));
      }
      return;
    }

    case 'canon': {
      const r = root();
      if (pos[0] === 'pull') {
        const res = canonPull(r);
        if (!res.ok) console.error('• no coordinated remote — canon is local-only');
        else console.log(`✓ pulled ${res.pulled.length ? res.pulled.join(', ') : 'nothing'} from ${res.branch}`);
      } else if (pos[0] === 'push') {
        const res = canonPush(r);
        if (!res.ok) die(res.error || 'no coordinated remote — cannot push canon');
        else console.log(`✓ published ${res.pushed.join(', ')} to ${res.branch}`);
      } else {
        const text = canonText(r);
        process.stdout.write((text || '(no canon yet — fill in .astrocode/CONVENTIONS.md)') + '\n');
      }
      return;
    }

    case 'decision': {
      const r = root();
      if (pos[0] === 'add') {
        const title = pos.slice(1).join(' ').trim();
        if (!title) die('usage: ac decision add "<title>" [--why "…"] [--rejected "…"]');
        const res = await addDecision(r, {
          title,
          why: typeof flags.why === 'string' ? flags.why : '',
          rejected: typeof flags.rejected === 'string' ? flags.rejected : '',
        });
        const tag = res.source === 'remote' ? `[shared: ${res.branch}]` : '[local]';
        console.log(`✓ ${res.id} — ${res.title} (${res.date}) ${tag}`);
      } else if (pos[0] === 'list') {
        const { decisions } = loadCanon(r);
        process.stdout.write((decisions || '(no decisions yet)') + '\n');
      } else {
        die('usage: ac decision <add|list>');
      }
      return;
    }

    case 'install': {
      const res = installClaude(FRAMEWORK_ROOT);
      console.log(`✓ home: ${res.home}  (${res.commands} commands, ${res.agents} agents, ${res.workflows} workflows)`);
      for (const t of res.targets) {
        console.log(`✓ linked → ${t.dir}  [${t.label}]  (${t.commands} cmds, ${t.agents} agents)`);
      }
      console.log('  after pulling updates, refresh the global CLI: npm install -g .');
      return;
    }

    case 'uninstall': {
      const res = uninstallClaude();
      console.log(`✓ removed ${res.removed} symlink(s) across all config dirs and deleted ${res.home}`);
      return;
    }

    case 'path': {
      console.log(pos[0] ? join(HOME_ROOT, pos[0]) : HOME_ROOT);
      return;
    }

    default:
      die(`unknown command "${cmd}" — run \`ac help\``);
  }
}

main().catch((e) => die(e?.message || String(e)));
