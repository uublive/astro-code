#!/usr/bin/env node
// `ac` — the astro-code CLI. A thin, atomic state layer; the heavy thinking lives
// in the markdown commands/agents and the Workflow scripts that Claude Code runs.
import process from 'node:process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRoot, paths } from '../lib/paths.mjs';
import { initPlanning, phaseContextStatus } from '../lib/planning.mjs';
import { profileModels, PROFILE_NAMES } from '../lib/models.mjs';
import { loadState, updateState } from '../lib/state.mjs';
import { loadRoadmap, addPhase, renderRoadmap, findPhase, setPhaseStatus, isPhasePlanned } from '../lib/roadmap.mjs';
import { gitIdentity, git, isRepo } from '../lib/git.mjs';
import { claim, readRegistry, registryBranch, markComplete, findNameMatches, initRegistry } from '../lib/registry.mjs';
import { loadConfig, updateConfig } from '../lib/config.mjs';
import { canonText, loadCanon, addDecision, canonPull, canonPush } from '../lib/canon.mjs';
import { completeMilestone } from '../lib/milestone.mjs';
import { flowInit, flowBranch } from '../lib/flow.mjs';
import { installClaude, uninstallClaude, ASTRO_HOME } from '../lib/install.mjs';
import { collectStats } from '../lib/stats.mjs';

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
  ac activity <text> | clear          set/clear the live statusline + banner verb
  ac roadmap list                     list phases
  ac roadmap render                   regenerate .astrocode/ROADMAP.md
  ac milestone new [--name "…"]       claim the next milestone number (+ dup-name check)
  ac milestone check "<name>"         see if a milestone with a similar name exists
  ac milestone complete               archive the current milestone + retire its claims
  ac phase add <name> [--milestone N] claim the next phase number + add it (+ dup-name check)
  ac phase check "<name>"             see if a phase with a similar name exists
  ac phase context <phase>            discuss-gate status: missing | stub | ready
  ac phase verify <phase>             mark a phase verified (AI gate passed)
  ac phase accept <phase> [--by N]    UAT sign-off → complete (requires verified)
  ac phase reject <phase> --reason …  UAT failed → rejected + record a blocker
  ac flow init                        ensure main + develop exist (gitflow, opt-in)
  ac flow                             create+switch to feature/m<N> off develop
  ac claim <milestone|phase> [m]      raw number claim (prints the number)
  ac config [get [k] | set k v | unset k]  read/update .astrocode/config.json (incl. models)
  ac models [max|balanced|fast] [--preview]  apply a per-role model preset (speed switch)
  ac canon [pull | push]              print canon; pull/push shares it on the orphan branch
  ac decision add "<t>" [--why …] [--rejected …]   append an ADR-lite decision (shared)
  ac decision list                    list recorded decisions
  ac stats [--since ISO|--session ID] token usage (fresh vs cache) + wall-clock from transcripts
  ac registry init [--force]          create the orphan registry branch + backfill from roadmaps
  ac registry show                    print the shared numbering registry
  ac install | uninstall              (un)install commands + agents into ~/.claude
  ac update [clone-path]              git pull + refresh the global CLI and commands
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
      const regState = !reg.available ? 'no origin remote — add one, then `ac registry init`'
        : reg.registry.claims.length ? `${registryBranch(r)} @ origin (team-coordinated)`
        : 'origin present, not initialized — run `ac registry init`';
      console.log(`Registry:  ${regState}`);
      console.log('Phases:');
      if (!rm.phases.length) console.log('  (none)');
      for (const ph of rm.phases) {
        const planned = isPhasePlanned(r, ph.slug) ? 'planned' : 'not planned';
        // Show the discuss state for open, unplanned phases — the signal that
        // routes the next suggestion to /astro-discuss before /astro-plan.
        const discuss = ph.status !== 'complete' && !isPhasePlanned(r, ph.slug)
          ? (phaseContextStatus(r, ph.slug) === 'ready' ? ' · discussed' : ' · undiscussed')
          : '';
        console.log(`  ${String(ph.number).padStart(2, '0')}  ${ph.status.padEnd(9)} ${ph.name}  (${planned}${discuss})`);
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

    // The live "what's happening" verb the statusline + SessionStart banner surface.
    // Stored as { text, at } so the renderers can expire a stale verb (a command that
    // crashed before clearing). Silent on success — it's called from command steps.
    case 'activity': {
      const r = root();
      if (pos[0] === 'clear' || pos[0] === 'off') {
        await updateState(r, (s) => ({ ...s, activity: null }));
      } else {
        const text = pos.join(' ').trim();
        if (!text) die('usage: ac activity <text> | clear');
        await updateState(r, (s) => ({ ...s, activity: { text, at: Math.floor(Date.now() / 1000) } }));
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
        if (res.source === 'error') die(res.error);
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

    // GitFlow branch automation (ADR-007, ADR-009, ADR-010).
    // `ac flow init` — ensure main + develop exist; idempotent.
    // `ac flow`      — create+switch to the milestone feature branch off develop.
    // Both commands delegate to lib/flow.mjs (thin git wrappers). Any thrown
    // Error is converted to die(msg) so the ✖ glyph + non-zero exit are guaranteed.
    // OPT-IN ONLY: lib/flow.mjs gates on gitflow.enabled — disabling it in config
    // blocks these commands with a clear actionable message.
    case 'flow': {
      const r = root();
      const sub = pos[0];
      if (sub === 'init') {
        // ac flow init — ensure develop exists off main; idempotent.
        const res = flowInit(r);
        if (res.warn) {
          console.log(res.message);
        } else {
          console.log(res.message);
        }
      } else if (sub == null) {
        // ac flow — create+switch to feature/m<N>-<slug> off develop.
        // The worktree base note: you must be on the feature branch before
        // running /astro-execute; ac flow lands you there. See lib/flow.mjs
        // WORKTREE BASE NOTE for details.
        const res = flowBranch(r);
        const verb = res.created ? 'created and switched to' : 'switched to';
        console.log(`✓ ${verb} "${res.branch}"`);
        if (!res.created) {
          console.log('  (branch already existed — switched without recreating)');
        }
        // Worktree-base reminder (PLAN t5 / ACCEPTANCE #7, todo #6): /astro-execute
        // forks one worktree per task from HEAD, so the user must be ON the feature
        // branch when they execute — say so explicitly, not just in a code comment.
        console.log(`• you are now on "${res.branch}" — run /astro-execute from here`);
      } else {
        die(`unknown ac flow subcommand "${sub}" — usage: ac flow [init]`);
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
        if (res.source === 'error') die(res.error);
        const phase = await addPhase(r, { number: res.number, name, milestone });
        console.log(`✓ phase ${phase.number} "${name}" (milestone ${milestone}) [registry: ${res.branch}]`);
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
      if (sub === 'context') {
        // Deterministic discuss-gate signal for /astro-plan: did this phase
        // actually get discussed, or does a CONTEXT.md merely exist? Prints
        // missing|stub|ready (exit 0); the command keys its nudge off this
        // instead of mere file presence. See lib/planning.mjs phaseContextStatus.
        if (!ph) die('usage: ac phase context <phase>');
        console.log(phaseContextStatus(r, ph.slug));
      } else if (sub === 'verify') {
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
        die('usage: ac phase <add|check|context|verify|accept|reject> …');
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
      if (res.source === 'error') die(res.error);
      console.log(res.number); // machine-readable: just the number on stdout
      console.error(`[${res.source}] ${res.message ?? ''}`);
      return;
    }

    case 'registry': {
      const r = root();
      if (pos[0] === 'init') {
        const res = initRegistry({ root: r, force: !!flags.force });
        if (!res.ok) die(res.error);
        if (res.created) console.log(`✓ registry initialized on ${res.branch} — backfilled ${res.claims} claim(s)`);
        else console.log(`• registry already initialized (${res.claims} claim(s)) — pass --force to rebuild from roadmaps`);
        return;
      }
      if (pos[0] !== 'show') die('usage: ac registry <show|init [--force]>');
      const reg = readRegistry(r);
      if (!reg.available) {
        console.error('no coordinated remote — add an origin, then `ac registry init`');
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

    case 'models': {
      // Speed switch: apply a whole per-role tier preset in one shot, instead of
      // five `ac config set models.<role>` calls. The ladder is opus→sonnet only
      // (no haiku). See lib/models.mjs for the profiles.
      //   ac models                  print the current effective tiers
      //   ac models <profile>        apply the preset (persist to config.models)
      //   ac models <profile> --preview   print the preset JSON without writing
      //                                   (used by /astro-execute --fast for a
      //                                    one-off run that doesn't persist)
      const r = root();
      const name = pos[0];
      if (!name) {
        json(loadConfig(r).models || {});
        return;
      }
      let preset;
      try {
        preset = profileModels(name);
      } catch (e) {
        die(`${e.message} (usage: ac models [${PROFILE_NAMES.join('|')}] [--preview])`);
      }
      if (flags.preview) {
        json(preset);
        return;
      }
      const next = await updateConfig(r, (c) => ({ ...c, models: preset }));
      console.log(`✓ models → ${name} profile`);
      json(next.models);
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
      // remember the clone path when installing from a git checkout, so `ac update` works later
      if (isRepo(FRAMEWORK_ROOT)) {
        try { mkdirSync(ASTRO_HOME, { recursive: true }); writeFileSync(join(ASTRO_HOME, 'source'), FRAMEWORK_ROOT + '\n'); } catch { /* best-effort */ }
      }
      console.log(`✓ home: ${res.home}  (${res.commands} commands, ${res.agents} agents, ${res.workflows} workflows, ${res.hooks} hooks)`);
      for (const t of res.targets) {
        const hk = t.hooks ? ', update banner+statusline' : '';
        console.log(`✓ linked → ${t.dir}  [${t.label}]  (${t.commands} cmds, ${t.agents} agents${hk})`);
      }
      console.log('  after pulling updates, refresh the global CLI: npm install -g .');
      return;
    }

    case 'uninstall': {
      const res = uninstallClaude();
      console.log(`✓ removed ${res.removed} symlink(s) across all config dirs and deleted ${res.home}`);
      return;
    }

    case 'stats': {
      // Transcripts are keyed by the project dir, not by .astrocode — so stats works
      // in any repo. Try the .astrocode root, then the cwd.
      const since = typeof flags.since === 'string' ? flags.since : undefined;
      const session = typeof flags.session === 'string' ? flags.session : undefined;
      const candidates = [...new Set([findRoot(), process.cwd()].filter(Boolean))];
      let s = null;
      for (const c of candidates) {
        const x = collectStats(c, { since, session });
        if (x.available) { s = x; break; }
        s = s || x;
      }
      if (!s || !s.available) die(`no transcripts found (looked in ${s ? s.dir : 'the project dir'})`);
      if (flags.json) { json(s); return; }
      const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      const secs = Math.round(s.wallMs / 1000);
      const dur = secs >= 3600 ? `${(secs / 3600).toFixed(1)}h` : secs >= 60 ? `${(secs / 60).toFixed(1)}m` : `${secs}s`;
      console.log(`Transcripts: ${s.files} file(s)${since ? ` since ${since}` : ''}${session ? ` (session ${session})` : ''}`);
      console.log(`Turns:       ${fmt(s.turns)}`);
      console.log(`Output:      ${fmt(s.output)} tokens`);
      console.log(`Fresh input: ${fmt(s.fresh)} tokens  (input ${fmt(s.input)} + cache-creation ${fmt(s.cacheCreate)})`);
      console.log(`Cache reads: ${fmt(s.cacheRead)} tokens  (cheap — ${(s.cacheHitRatio * 100).toFixed(1)}% cache-hit)`);
      console.log(`Wall clock:  ${dur}  (first → last message)`);
      console.log('');
      console.log('note: whole session history for this project, not astro-code-only.');
      console.log('      scope one run with --since "<ISO timestamp>" (or --session <id>).');
      return;
    }

    case 'update': {
      const sourceFile = join(ASTRO_HOME, 'source');
      // locate the clone: explicit arg → running from a checkout → remembered source
      let clone = pos[0] ? resolve(pos[0]) : null;
      if (!clone && isRepo(FRAMEWORK_ROOT)) clone = FRAMEWORK_ROOT;
      if (!clone && existsSync(sourceFile)) clone = readFileSync(sourceFile, 'utf8').trim();
      if (!clone || !existsSync(clone)) die('cannot locate the astro-code clone — run `ac update <path-to-clone>` once to register it');
      if (!isRepo(clone)) die(`${clone} is not a git repository`);
      mkdirSync(ASTRO_HOME, { recursive: true });
      writeFileSync(sourceFile, clone + '\n');

      console.log(`updating from ${clone} …`);
      const pull = git(['pull', '--ff-only'], { cwd: clone });
      process.stdout.write(pull.stdout);
      if (pull.status !== 0) die(`git pull failed:\n${(pull.stderr || '').trim()}`);

      // if the global CLI is a copy (not running from the clone), reinstall it
      if (resolve(FRAMEWORK_ROOT) !== resolve(clone)) {
        console.log('refreshing global `ac` (npm install -g) …');
        const npm = spawnSync('npm', ['install', '-g', clone], { encoding: 'utf8' });
        if (npm.status !== 0) console.error(`⚠ npm install -g failed — run it manually in ${clone}:\n${(npm.stderr || '').trim()}`);
        else console.log('✓ global `ac` refreshed');
      }

      const res = installClaude(clone);
      console.log(`✓ installed → ${res.home} (${res.commands} cmds, ${res.agents} agents, ${res.workflows} workflows, ${res.hooks} hooks) across ${res.targets.length} config dir(s)`);
      let version = '?';
      try { version = (JSON.parse(readFileSync(join(clone, 'package.json'), 'utf8')) || {}).version || '?'; } catch { /* ignore */ }
      console.log(`✓ astro-code is now at v${version} — restart Claude Code if the command list doesn't refresh`);
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
