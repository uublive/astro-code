#!/usr/bin/env node
// `ac` — the astro-code CLI. A thin, atomic state layer; the heavy thinking lives
// in the markdown commands/agents and the Workflow scripts that Claude Code runs.
import process from 'node:process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { findRoot, paths } from '../lib/paths.mjs';
import { initPlanning, phaseContextStatus } from '../lib/planning.mjs';
import { profileModels, PROFILE_NAMES } from '../lib/models.mjs';
import { profileReasoning, REASONING_LEVELS, validateReasoning } from '../lib/reasoning.mjs';
import { loadState, updateState } from '../lib/state.mjs';
import { loadRoadmap, addPhase, renderRoadmap, setMilestone, findPhase, setPhaseStatus, setPhaseEffort, setPhaseNote, setPhaseMilestone, isPhasePlanned } from '../lib/roadmap.mjs';
import { resolveEffort, DEFAULT_EFFORT } from '../lib/effort.mjs';
import { gitIdentity, git, isRepo } from '../lib/git.mjs';
import { claim, readRegistry, registryBranch, markComplete, findNameMatches, initRegistry, claimFix, markFixComplete, repointPhaseClaim, claimDrift } from '../lib/registry.mjs';
import { addFix, acceptFix, setFixStatus, findFix, openFixes, loadFixes, FIX_STATUSES } from '../lib/fixes.mjs';
import {
  addDebt, openDebt, findDebt, payDebt, dropDebt, dismissDebt, closeDebtFor, staleDebt,
  debtAgeDays, debtScore, loadDebt, DEBT_COSTS, STALE_DAYS,
} from '../lib/debt.mjs';
import {
  addBacklog, openBacklog, loadBacklog, findBacklog, backlogAgeDays, linkBacklog,
  closeBacklogFor, reopenBacklogFor, markPromoted, archiveBacklog, declinedMatches,
  promotionContext, ARCHIVE_KINDS, BACKLOG_STALE_DAYS,
  setBacklogNote,
} from '../lib/backlog.mjs';
import { runFixturesCheck } from '../lib/fixtures.mjs';
import { loadConfig, updateConfig } from '../lib/config.mjs';
import { canonText, loadCanon, addDecision, canonPull, canonPush, canonDedupe } from '../lib/canon.mjs';
import { completeMilestone, belongsToMilestone } from '../lib/milestone.mjs';
import { flowInit, flowBranch, flowPR, flowRelease, flowTag, flowHotfixStart, flowHotfixFinish } from '../lib/flow.mjs';
import { installClaude, uninstallClaude, installStatusline, baseConfigDir, ASTRO_HOME } from '../lib/install.mjs';
import { applyTune, undoTune, tuneTarget, UNTUNABLE } from '../lib/tune.mjs';
import { collectStats } from '../lib/stats.mjs';
import { writeAgentsMd } from '../lib/agentsmd.mjs';

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

// Unknown flags used to parse into `flags` and then be silently discarded, so a typo
// — or an invented flag like `--dry-run` — degraded to the DEFAULT behavior with no
// warning at all. For verbs that publish to the shared registry branch or close out a
// phase, that makes the safest-SOUNDING invocation the most dangerous one: someone
// reaching for `ac canon push --dry-run` published to the whole team's branch.
//
// Enforced per-verb rather than globally: these are the commands with shared or
// hard-to-reverse side effects, where being wrong is expensive. A stray flag on a
// read-only verb (`ac status --verbose`) stays harmless, so it stays permitted —
// blanket enforcement would break existing invocations for no safety gain.
const ALLOWED_FLAGS = {
  // ADR-053 (D1) — `--force` is the only way past a refused pull other than
  // publishing first (`ac canon push`); a typo'd flag must not silently degrade
  // into "took the registry's copy" (ADR-029).
  'canon pull': ['force'],
  'canon push': ['dry-run'],
  'canon dedupe': [],
  'decision add': ['why', 'rejected'],
  'registry init': ['force'],
  'phase accept': ['by', 'force', 'agent'],
  'phase reject': ['reason'],
  'fix accept': ['by', 'agent'],
  // `drop` is the one debt verb that removes something from the list on a human's
  // say-so, so a typo'd flag must not degrade into "dropped with no reason".
  'debt drop': ['reason'],
  'debt dismiss': ['reason'],
  'debt pay': ['as', 'milestone'],
  // A typo'd `--phase` must not silently degrade into "checked the wrong phase".
  'fixtures check': ['phase'],
  'backlog add': ['note'],
  'backlog link': ['phase'],
  'backlog archive': ['kind', 'reason'],
  'backlog promote': [],
  // #63 — the text is an argument, not a flag: `--note` (what `backlog add` takes) used to
  // be ignored here and the call read the note instead of writing it.
  'backlog note': [],
  'milestone complete': ['force'],
  // `tune` writes a settings.json that grants permissions, so a typo'd flag must be
  // refused rather than silently applying the tuning (#14).
  'tune': ['user', 'undo'],
};

function checkFlags(key, flags) {
  const allowed = ALLOWED_FLAGS[key];
  if (!allowed) return;
  const unknown = Object.keys(flags).filter((f) => !allowed.includes(f));
  if (!unknown.length) return;
  const got = unknown.map((f) => `--${f}`).join(', ');
  const ok = allowed.length ? `accepted: ${allowed.map((f) => `--${f}`).join(', ')}` : 'this command takes no flags';
  die(`unknown flag${unknown.length > 1 ? 's' : ''} for \`ac ${key}\`: ${got} (${ok})`);
}
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
  ac milestone complete [--force]     archive the current milestone + retire its claims
                                       (refuses while a phase is not complete; --force overrides)
  ac phase add <name> [--milestone N] claim the next phase number + add it (+ dup-name check)
  ac phase check "<name>"             see if a phase with a similar name exists
  ac phase context <phase>            discuss-gate status: missing | stub | ready
  ac phase verify <phase>             mark a phase verified (AI gate passed)
  ac phase accept <phase> [--by N]    UAT sign-off → complete (requires verified)
  ac phase accept <p> --agent <name>  machine-signed sign-off (records accepted_kind=agent)
  ac fix add "<what is broken>"       open a bugfix (dated id, no phase number)
  ac fix list                         open fixes
  ac fix status <id> [<status>]       read or move the lifecycle
  ac fix accept <id> [--agent <name>] human gate → accepted + archived
  ac debt list [--phase N|--file p|--stale]  open technical debt (the verifier files it)
  ac debt add "<what>" [--why …] [--phase N] [--file p] [--cost small|medium|large]
  ac debt score                       is it worth paying debt down right now? (0-100 + why)
  ac debt pay <id> [--as fix|phase] [--milestone N]  graduate it into a fix (default) or a roadmap phase
  ac debt drop <id> --reason "…"      it WAS true and stopped being true
  ac debt dismiss <id> --reason "…"   it was NEVER true — the verifier was wrong
  ac backlog list [--all] [--json]    open ideas (oldest first); --all includes archived/promoted
  ac backlog add "<idea>" [--note …]  capture an idea (no phase/milestone spent)
  ac backlog show <id>                print the raw item as JSON
  ac backlog note <id> ["<text>"]     read/set/clear an item's note (the title stays fixed)
  ac backlog link <id> --phase N      commit the item to a phase already in flight
  ac backlog promote <id>             claim a phase number and start it from this idea
  ac backlog archive <id> --kind declined|obsolete --reason "…"  file the idea WITHOUT doing it
  ac phase reject <phase> --reason …  UAT failed → rejected + record a blocker
  ac phase effort <phase> [<level>]   read/resolve (or set) the per-phase effort dial (light|standard|deep)
  ac phase note <phase> ["<text>"]    read/set/clear a durable phase note (survives ROADMAP.md renders)
  ac phase milestone <phase> [<N>]    read/correct which milestone a phase belongs to (never moves the project)
  ac flow init                        ensure main + develop exist (gitflow, opt-in)
  ac flow                             create+switch to feature/m<N> off develop
  ac flow pr                          push the feature branch and print the develop PR URL
  ac flow release                     push develop and print the develop→main PR URL
  ac flow tag [version]               tag origin/main as v<N> after the develop→main PR merges
  ac flow hotfix start <name>         branch hotfix/<name> off main (offline-safe)
  ac flow hotfix finish               merge hotfix into main+develop, tag v<N>.<k>, push
  ac claim <milestone|phase> [m]      raw number claim (prints the number)
  ac config [get [k] | set k v | unset k]  read/update .astrocode/config.json (incl. models)
  ac models [max|balanced|fast] [--preview]  apply a per-role model preset (speed switch)
  ac preflight                        warn if HEAD diverged from upstream (silent when in sync)
  ac fixtures check [--phase N]       advisory: warn if this phase's stamped commits changed
                                       the declared data model without the declared seed (never blocks, files debt)
  ac canon [pull [--force] | push [--dry-run] | dedupe]  print canon; pull/push shares it on the
                                       orphan branch; dedupe collapses exact-duplicate decisions
  ac decision add "<t>" [--why …] [--rejected …]   append an ADR-lite decision (shared)
  ac decision list                    list recorded decisions
  ac stats [--since ISO|--session ID] token usage (fresh vs cache) + wall-clock from transcripts
  ac registry init [--force]          create the orphan registry branch + backfill from roadmaps
  ac registry show                    print the shared numbering registry
  ac tune [--user] [--undo]           apply astro-recommended Claude settings (additive, reversible)
  ac statusline [install|preview]     wire the rich statusline (recap·model·ctx-bar·M/P) or preview it
  ac install | uninstall              (un)install commands + agents into ~/.claude
  ac update [clone-path]              git pull + refresh the global CLI and commands
  ac path [sub]                       print the framework dir, symlinks resolved (e.g. ac path workflows)
  ac help                             this help
`;

// A request for help must never run the verb (#14, #50). `--help` is the flag a
// person types to find out what a command WOULD do, yet on a writing verb like
// `tune` every spelling of it used to fall through to the default action. Caught
// here, before dispatch, so it holds for every verb — including ones added later:
// `--help` and `-h` anywhere in the tail (checked on the raw tail, so a `-h` that
// parseArgs swallowed as a flag's value still counts), or a bare `help` as the
// first positional. Prints the verb's own HELP lines when it has any.
function verbHelp(verb) {
  const lines = HELP.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(`  ac ${verb} `) && lines[i] !== `  ac ${verb}`) continue;
    out.push(lines[i]);
    // continuation lines are indented past the command column
    while (i + 1 < lines.length && /^ {10,}\S/.test(lines[i + 1])) out.push(lines[++i]);
  }
  return out.length ? out.join('\n') + '\n' : HELP;
}
const wantsHelp = tail.includes('--help') || tail.includes('-h') || pos[0] === 'help';

async function main() {
  if (cmd !== undefined && wantsHelp) {
    process.stdout.write(verbHelp(cmd));
    return;
  }
  switch (cmd) {
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      process.stdout.write(HELP);
      return;

    // Refresh the managed AGENTS.md block on its own — for projects that predate
    // it, or after upgrading astro-code. Only the region between the markers is
    // touched; everything the user wrote around it is preserved.
    // Bugfixes: peers of phases, never members of a milestone. Identity is a
    // dated slug (ADR-013 — urgent out-of-band work is named, not numbered), so
    // everything sorts chronologically on disk and in the registry.
    case 'fix': {
      const r = root();
      const sub = pos[0];

      if (!sub || sub === 'list') {
        const open = openFixes(r);
        if (flags.json) { json(open); return; }
        if (!open.length) { console.log('• no open fixes'); return; }
        for (const f of open) console.log(`  ${f.id}  ${f.status}  ${f.title}`);
        return;
      }

      if (sub === 'add') {
        const title = pos.slice(1).join(' ').trim();
        if (!title) die('usage: ac fix add "<what is broken>"');
        const fix = await addFix(r, { title });
        // Registry is advisory for a fix: it warns a second developer that
        // someone is already on this bug. Offline is fine (ADR-013) — the local
        // record stands and the push is the collision detector.
        const reg = claimFix({ root: r, id: fix.id, name: title });
        console.log(`✓ fix ${fix.id}`);
        if (reg.matches?.length) {
          console.log(`⚠ someone may already be on this: ${reg.matches.map((m) => m.name).join(', ')}`);
        } else if (!reg.ok) {
          console.log('• registry not reachable — recorded locally (the push will detect collisions)');
        }
        return;
      }

      const fix = findFix(r, pos[1]);
      if (!fix) die(`no such fix: ${pos[1] || '(none given)'} — see \`ac fix list\``);

      if (sub === 'show') { json(fix); return; }

      if (sub === 'status') {
        const next = pos[2];
        if (!next) { console.log(fix.status); return; }
        const updated = await setFixStatus(r, fix.id, next);
        console.log(`✓ ${updated.id} → ${updated.status}`);
        return;
      }

      if (sub === 'accept') {
        checkFlags('fix accept', flags);
        const done = await acceptFix(r, fix.id, {
          by: typeof flags.by === 'string' ? flags.by : gitIdentity(r).owner,
          agent: typeof flags.agent === 'string' ? flags.agent : '',
        });
        markFixComplete({ root: r, id: fix.id });
        const who = done.accepted_kind === 'agent' ? `agent ${done.accepted_by}` : done.accepted_by;
        console.log(`✓ accepted ${done.id} by ${who}${done.archived ? ' → archived' : ''}`);
        // Draining the debt register is a SIDE EFFECT of the gate that already exists.
        // This is the anti-rot mechanism: an item closes because the work was accepted,
        // never because someone remembered to delete a line (see lib/debt.mjs).
        for (const d of await closeDebtFor(r, { kind: 'fix', workRef: fix.id })) {
          console.log(`✓ debt ${d.id} paid`);
        }
        return;
      }

      die(`unknown: ac fix ${sub} (add | list | show | status | accept)`);
    }

    // The technical-debt register (lib/debt.mjs). An INBOX, not a plan: items are
    // filed automatically by the phase verifier and leave by graduating into a fix
    // or a phase, or by being dropped with a reason. Nothing here closes an item on
    // a promise — `paid` is set by the acceptance gates, never typed.
    case 'debt': {
      const r = root();
      const sub = pos[0];

      if (!sub || sub === 'list') {
        const items = flags.stale
          ? staleDebt(r)
          : openDebt(r, {
            phase: typeof flags.phase === 'string' ? flags.phase : '',
            file: typeof flags.file === 'string' ? flags.file : '',
          });
        if (flags.json) { json(items); return; }
        if (!items.length) { console.log(flags.stale ? '• no stale debt' : '• no open debt'); return; }
        for (const d of items) {
          const age = debtAgeDays(d);
          const where = [d.phase ? `phase ${d.phase}` : '', d.file || '', d.cost].filter(Boolean).join(' · ');
          console.log(`  ${d.id}  ${where}`);
          console.log(`    ${d.title}`);
          if (d.status === 'paying') console.log(`    → being paid by ${d.paid_by.kind} ${d.paid_by.ref}`);
          // Repeat sightings are the strongest signal the register has about what
          // actually hurts, so they are surfaced rather than buried in the JSON.
          if (d.also_found_in?.length) console.log(`    ⚠ hit again in phase ${d.also_found_in.join(', ')}`);
          if (age >= STALE_DAYS) console.log(`    ⚠ ${age} days old — pay it or drop it`);
        }
        const total = loadDebt(r).debt.length;
        console.log(`\n${items.length} open · ${total} filed all-time`);
        return;
      }

      if (sub === 'add') {
        const title = pos.slice(1).join(' ').trim();
        if (!title) die('usage: ac debt add "<what is wrong>" [--why …] [--phase N] [--file p] [--cost small|medium|large]');
        const cost = typeof flags.cost === 'string' ? flags.cost : 'small';
        if (!DEBT_COSTS.includes(cost)) die(`unknown --cost "${cost}" (${DEBT_COSTS.join(' | ')})`);
        const res = await addDebt(r, {
          title,
          why: typeof flags.why === 'string' ? flags.why : '',
          phase: typeof flags.phase === 'string' ? flags.phase : '',
          file: typeof flags.file === 'string' ? flags.file : '',
          cost,
        });
        // A duplicate is a convergence, not an error: the filer is usually a verifier
        // running after every phase, and the same finding recurring is information.
        if (res.created) console.log(`✓ debt ${res.entry.id}`);
        else console.log(`• already filed as ${res.entry.id} — recorded another sighting`);
        return;
      }

      // The KPI. Prints its own inputs on purpose: a single score nobody can audit
      // gets ignored the first time it disagrees with someone's gut.
      if (sub === 'score') {
        const s = debtScore(r);
        if (flags.json) { json(s); return; }
        if (!s.open) { console.log('• no open debt — nothing to weigh'); return; }

        console.log(`Debt pressure  ${s.pressure}/100 · ${s.band}`);
        console.log(`  interest   ${String(s.interest).padStart(3)} pts   ${s.totals.recurrence} recurrence(s) · ${s.totals.hotspot} hotspot overlap(s) · ${s.totals.stale} stale-and-recurring`);
        console.log(`  principal  ${String(s.principal).padStart(3)} pts   ${s.open} open item(s), by what clearing them would cost`);

        const hot = s.files.filter((f) => f.n > 1);
        if (hot.length) {
          console.log('\nConcentration');
          for (const f of hot) console.log(`  ${f.file}  ${f.n} items`);
        }

        if (s.worst.length) {
          console.log('\nPay these first (most friction per unit of effort)');
          for (const i of s.worst.slice(0, 5)) {
            const why = [
              i.recurrence ? `re-found ${i.recurrence}×` : '',
              i.hotspot ? `${i.hotspot} file overlap(s)` : '',
            ].filter(Boolean).join(', ');
            console.log(`  ${i.id}`);
            console.log(`    ${i.cost} · ${why}`);
          }
        }

        // Precision of the FEED, kept separate from the state of the code.
        console.log(`\nVerifier  ${s.filed} filed · ${s.dismissed} dismissed as not-debt (${s.falsePositiveRate}% false positive)`);

        const verdict = {
          'healthy': 'Your debt is not charging you right now — keep building. Volume alone never moves this number.',
          'watch': 'Debt is concentrating. Fold some in next time you are already in these files — `/astro-discuss` will offer.',
          'pay-now': 'The register is charging you about what clearing it would cost. Worth planning a phase for it.',
        }[s.band];
        console.log(`\n${verdict}`);
        return;
      }

      const item = findDebt(r, pos[1]);
      if (!item) die(`no such debt: ${pos[1] || '(none given)'} — see \`ac debt list\``);

      if (sub === 'show') { json(item); return; }

      if (sub === 'pay') {
        checkFlags('debt pay', flags);
        const as = typeof flags.as === 'string' ? flags.as : 'fix';
        if (as !== 'fix' && as !== 'phase') die('usage: ac debt pay <id> [--as fix|phase] [--milestone N]');
        if (as === 'fix' && flags.milestone !== undefined) die('--milestone only applies to --as phase — a fix belongs to no milestone');

        if (as === 'fix') {
          const fix = await addFix(r, { title: item.title });
          claimFix({ root: r, id: fix.id, name: item.title });
          await payDebt(r, item.id, { kind: 'fix', workRef: fix.id });
          console.log(`✓ debt ${item.id} → fix ${fix.id}`);
          console.log(`  it closes when you run \`ac fix accept ${fix.id}\` (or /astro-fix-accept)`);
          return;
        }

        // Refactor-sized debt graduates to the roadmap and goes through the normal
        // loop. Routing it through the fix lifecycle instead would produce a
        // "bugfix" with no reproduction case, which is the one thing that makes
        // `ac fix` trustworthy.
        const st = loadState(r) || {};
        const rm = loadRoadmap(r);
        // #32 — debt is usually paid later than it is filed, so the phase often belongs to a
        // future milestone. Without --milestone the claim always landed on the active one,
        // and the only correction (`ac phase milestone`) was the command that split them.
        let milestone = st.active_milestone || rm.milestone || 1;
        if (flags.milestone !== undefined) {
          milestone = Number(flags.milestone);
          if (!Number.isInteger(milestone) || milestone < 1) die(`--milestone must be a positive integer, got "${flags.milestone}"`);
        }
        const res = claim({ root: r, type: 'phase', milestone, name: item.title });
        if (res.source === 'error') die(res.error);
        const phase = await addPhase(r, { number: res.number, name: item.title, milestone });
        await payDebt(r, item.id, { kind: 'phase', workRef: phase.slug });
        console.log(`✓ debt ${item.id} → phase ${phase.number} "${item.title}" (milestone ${milestone})`);
        console.log(`  it closes when you run \`ac phase accept ${phase.number}\` (or /astro-accept)`);
        warnNameMatches(res.matches, gitIdentity(r).owner);
        return;
      }

      if (sub === 'drop') {
        checkFlags('debt drop', flags);
        const reason = typeof flags.reason === 'string' ? flags.reason : '';
        if (!reason) die('usage: ac debt drop <id> --reason "why it stopped being true"');
        const done = await dropDebt(r, item.id, { reason });
        console.log(`✓ dropped ${done.id}: ${done.drop_reason}`);
        return;
      }

      // `dismiss` is not a synonym for `drop` — drop says the code moved on, dismiss
      // says the verifier was wrong. Only the second is a measurement of the feed.
      if (sub === 'dismiss') {
        checkFlags('debt dismiss', flags);
        const reason = typeof flags.reason === 'string' ? flags.reason : '';
        if (!reason) die('usage: ac debt dismiss <id> --reason "why this was never debt"');
        const done = await dismissDebt(r, item.id, { reason });
        console.log(`✓ dismissed ${done.id} (not debt): ${done.dismiss_reason}`);
        console.log('  kept on the record — it counts toward the verifier\'s false-positive rate');
        return;
      }

      die(`unknown: ac debt ${sub} (add | list | show | score | pay | drop | dismiss)`);
    }

    case 'backlog': {
      const r = root();
      const sub = pos[0];

      if (!sub || sub === 'list') {
        const db = loadBacklog(r);
        const items = flags.all
          ? [...db.backlog].sort((a, b) => String(a.id).localeCompare(String(b.id)))
          : openBacklog(r);
        if (flags.json) { json(items); return; }
        if (!items.length) { console.log('• no open ideas'); return; }
        for (const b of items) {
          const age = backlogAgeDays(b);
          const closed = b.status !== 'open' && b.status !== 'linked'
            ? b.archive_kind ? ` — ${b.archive_kind}: ${b.archive_reason}`
              : b.status === 'promoted' ? ` — promoted to phase ${b.promoted_to?.number}`
                : b.status === 'absorbed' ? ` — absorbed by phase ${b.linked_by?.ref}` : ''
            : '';
          console.log(`  ${b.id}  ${b.status}  ${age}d${closed}`);
          console.log(`    ${b.title}`);
          if (b.status === 'open' && age >= BACKLOG_STALE_DAYS) console.log(`    ⚠ ${age} days old`);
        }
        console.log(`\n${items.length} ${flags.all ? 'total' : 'open'} · ${db.backlog.length} filed all-time`);
        return;
      }

      if (sub === 'add') {
        checkFlags('backlog add', flags);
        const title = pos.slice(1).join(' ').trim();
        if (!title) die('usage: ac backlog add "<idea>" [--note "<short paragraph>"]');
        const note = typeof flags.note === 'string' ? flags.note : '';
        const res = await addBacklog(r, { title, note });
        console.log(`✓ backlog ${res.entry.id}`);
        // "If you are writing a plan, it is a phase" — this register captures an
        // idea, not the plan for it; a long note is a signal the idea is really a
        // phase waiting to be discussed, so it is flagged, never refused (D5/D6).
        if (note.trim().length > 600) {
          console.log('  ⚠ that note reads like a plan, not an idea — if you are writing a plan, it is a phase');
        }
        if (res.similar.length) {
          console.log('⚠ similar open idea(s):');
          for (const s of res.similar) console.log(`  ${s.id}  ${s.title}`);
        }
        return;
      }

      const item = findBacklog(r, pos[1]);
      if (['show', 'link', 'promote', 'archive', 'note'].includes(sub) && !item) {
        die(`no such backlog item: ${pos[1] || '(none given)'} — see \`ac backlog list\``);
      }

      if (sub === 'show') { json(item); return; }

      if (sub === 'link') {
        checkFlags('backlog link', flags);
        const phaseRef = typeof flags.phase === 'string' ? flags.phase : '';
        if (!phaseRef) die('usage: ac backlog link <id> --phase <n>');
        const ph = findPhase(r, phaseRef);
        if (!ph) die(`no such phase: ${phaseRef}`);
        await linkBacklog(r, item.id, { kind: 'phase', workRef: ph.slug });
        console.log(`✓ backlog ${item.id} → phase ${ph.number} "${ph.name}"`);
        console.log(`  it closes when you run \`ac phase accept ${ph.number}\` (or \`ac phase reject\` reopens it)`);
        return;
      }

      if (sub === 'promote') {
        checkFlags('backlog promote', flags);
        // Idempotent (ADR-017 posture): a retry after a partial failure must never
        // spend a second number, so a promoted item dies naming the phase it already
        // became BEFORE claim() runs.
        if (item.promoted_to) {
          die(`backlog ${item.id} was already promoted to phase ${item.promoted_to.number} — a spent number is not reissued`);
        }
        const st = loadState(r) || {};
        const rm = loadRoadmap(r);
        const milestone = st.active_milestone || rm.milestone || 1;
        const res = claim({ root: r, type: 'phase', milestone, name: item.title });
        if (res.source === 'error') die(res.error);
        let phase;
        try {
          phase = await addPhase(r, { number: res.number, name: item.title, milestone });
        } catch (e) {
          die(
            `${e.message}\n` +
            `  phase ${res.number} was already claimed on ${res.branch} and stays claimed — it will not be ` +
            `handed out again. Your roadmap and the registry disagree; run \`ac registry show\` to compare.`,
          );
        }
        // The two local writes go LAST — a crash between here and markPromoted must
        // never leave an item marked promoted with no phase behind it.
        writeFileSync(
          join(paths(r).phases, phase.slug, 'CONTEXT.md'),
          promotionContext(item, { number: phase.number }),
        );
        await markPromoted(r, item.id, { number: phase.number, slug: phase.slug });
        console.log(`✓ backlog ${item.id} → phase ${phase.number} "${item.title}" (milestone ${milestone})`);
        console.log(`  run /astro-discuss ${phase.number} before planning — the seed is a captured note, not a discussion`);
        warnNameMatches(res.matches, gitIdentity(r).owner);
        return;
      }

      if (sub === 'note') {
        // Read/set/clear an item's note, exactly like `ac phase note`.
        //   ac backlog note <id>            READ
        //   ac backlog note <id> "<text>"   WRITE
        //   ac backlog note <id> ""         CLEAR
        // The title stays immutable: it seeds the id and feeds the declined-match
        // check, so a mutable title means a duplicate warning that silently changes
        // what it compares against. A title wrong enough to matter is an `obsolete`
        // archive plus a re-capture, which is what that exit is for.
        if (flags.note !== undefined) {
          die(`\`ac backlog note\` takes the text as an argument, not --note: ac backlog note ${item.id} "<text>" (nothing was changed)`);
        }
        checkFlags('backlog note', flags);
        if (pos.length < 3) {
          console.log(item.note ?? '');
        } else {
          const updated = await setBacklogNote(r, item.id, pos.slice(2).join(' '));
          console.log(
            updated.note
              ? `✓ backlog ${updated.id} note updated`
              : `✓ backlog ${updated.id} note cleared`,
          );
        }
        return;
      }

      if (sub === 'archive') {
        checkFlags('backlog archive', flags);
        const kind = typeof flags.kind === 'string' ? flags.kind : '';
        const reason = typeof flags.reason === 'string' ? flags.reason : '';
        if (!kind || !reason || !ARCHIVE_KINDS.includes(kind)) {
          die(`usage: ac backlog archive <id> --kind ${ARCHIVE_KINDS.join('|')} --reason "…"`);
        }
        const done = await archiveBacklog(r, item.id, { kind, reason });
        console.log(`✓ archived ${done.id} (${done.archive_kind}): ${done.archive_reason}`);
        return;
      }

      die(`unknown: ac backlog ${sub} (add | list | show | note | link | promote | archive)`);
    }

    case 'agents-md': {
      const root = findRoot() || process.cwd();
      const written = writeAgentsMd(root);
      if (!written.length) console.log('• AGENTS.md already up to date');
      else console.log(`✓ updated ${written.join(' + ')} in ${root}`);
      return;
    }

    case 'init': {
      const cwd = process.cwd();
      const res = initPlanning(cwd, {
        name: typeof flags.name === 'string' ? flags.name : basename(cwd),
        vision: typeof flags.vision === 'string' ? flags.vision : '',
      });
      console.log(res.created ? `✓ ${res.message}` : `• ${res.message}`);
      if (res.agentsMd?.length) console.log(`✓ explained astro-code in ${res.agentsMd.join(' + ')}`);
      // ADR-035 — keep harness-created agent worktrees out of the user's index.
      //
      // Parallel executors are materialised under `.claude/worktrees/` as live git repos, so
      // a `git add -A` during a parallel phase commits them as embedded repos (reproduced in
      // benchmark #2). And `git add -A` mid-phase is NOT user error: committing plan artifacts
      // promptly is the correct defence against the shared-tree stash hazard, so users will do
      // it. Lives HERE and not in initPlanning() deliberately — lib must not write outside
      // `.astrocode/`; doing so dirtied the tree for every lib consumer and made `ac flow
      // branch` refuse straight after a scaffold.
      if (res.created) {
        try {
          const gi = join(cwd, '.gitignore');
          const existing = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
          if (!/^\.claude\/worktrees\/?\s*$/m.test(existing)) {
            const block = '# astro-code: harness-created agent worktrees — never commit these\n.claude/worktrees/\n';
            writeFileSync(gi, existing ? existing.replace(/\n*$/, '\n') + '\n' + block : block);
            console.log('✓ .gitignore: ignoring .claude/worktrees/');
          }
        } catch { /* best-effort — an unwritable .gitignore must never fail init */ }
      }
      return;
    }

    // ADR-036 — warn when local HEAD has diverged from its upstream before a parallel run.
    //
    // The harness creates each parallel executor's worktree by forking `origin/<branch>`,
    // NOT local HEAD. So every commit that exists locally but not on the remote makes an
    // entire wave's branches read as STALE at integration time: ADR-015 refuses to
    // cherry-pick them (correctly — a clean pick proves nothing off a stale base), the heal
    // ladder re-runs every task sequentially, and the phase still reports PASS. Benchmark #2
    // lost 17 task-executions this way across three phases; the one phase that launched with
    // HEAD == upstream healed 0 of 11.
    //
    // astro-code cannot fix the fork base — `isolation: 'worktree'` exposes no control and
    // the workflow script runs no git (ADR-008). But the condition is one cheap comparison,
    // and the ONLY trace it otherwise leaves is `executed` exceeding `tasks` in a JSON
    // payload nobody reads. Advisory by design: exit 0 always, print NOTHING when clean, and
    // never block a run the operator meant to make.
    case 'preflight': {
      const r = root();
      if (!isRepo(r)) return;
      const head = git(['rev-parse', 'HEAD'], { cwd: r });
      const up = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { cwd: r });
      if (head.status !== 0 || up.status !== 0) return; // no upstream to compare — nothing to say
      const upstream = up.stdout.trim();
      const upSha = git(['rev-parse', upstream], { cwd: r });
      if (upSha.status !== 0 || upSha.stdout.trim() === head.stdout.trim()) return; // in sync
      const ahead = git(['rev-list', '--count', `${upstream}..HEAD`], { cwd: r }).stdout.trim() || '?';
      const behind = git(['rev-list', '--count', `HEAD..${upstream}`], { cwd: r }).stdout.trim() || '?';
      console.error(
        `⚠ HEAD has diverged from ${upstream} (ahead ${ahead}, behind ${behind}).\n` +
          `  Parallel executor worktrees fork from ${upstream}, not from local HEAD — so an entire\n` +
          `  wave can come back STALE, get re-run through the heal ladder, and still report PASS.\n` +
          `  Fix: \`git push\` (or pull) so they match, and avoid committing while a phase runs.\n` +
          `  Or skip the parallel path entirely: \`ac config set use_worktrees false\`.`,
      );
      return;
    }

    // ADR-050/052 layer 3: an advisory net for the lanes a criterion never reaches
    // (`/astro-fast`, or any run that skips the verifier). Own case arm, not folded
    // into `preflight`'s — same posture (exit 0 always, silent when clean, never
    // blocks a run) but a distinct verb with its own flag and its own debt filing.
    // The engine lives in lib/fixtures.mjs (D2 — testable, reusable); this is a
    // thin dispatcher that relays its output verbatim to stdout.
    case 'fixtures': {
      const sub = pos[0];
      if (sub !== 'check') die(`unknown fixtures subcommand "${sub ?? ''}" — try: ac fixtures check`);
      checkFlags('fixtures check', flags);
      const r = root();
      const result = await runFixturesCheck(r, { phase: flags.phase });
      if (result.lines.length) console.log(result.lines.join('\n'));
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
      const regState = reg.unreachable ? `unreachable — could not read ${registryBranch(r)} from origin (not the same as empty)`
        : !reg.available ? 'no origin remote — add one, then `ac registry init`'
        : reg.registry.claims.length ? `${registryBranch(r)} @ origin (team-coordinated)`
        : 'origin present, not initialized — run `ac registry init`';
      console.log(`Registry:  ${regState}`);
      // #32 — the roadmap and the registry both carry each phase's milestone, and nothing
      // compared them: a diverged claim was visible only to someone who ran `registry show`.
      for (const d of reg.available ? claimDrift(rm, reg.registry) : []) {
        console.log(`  ⚠ phase ${d.number} is milestone ${d.roadmap} in the roadmap but ${d.registry} on the registry — ` +
          `\`ac phase milestone ${d.number} ${d.roadmap}\` realigns them`);
      }
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
      // Passive visibility. A register you have to remember to open is a register you
      // stop opening, so the count rides along on the command already run constantly.
      const debt = openDebt(r);
      if (debt.length) {
        const stale = staleDebt(r).length;
        console.log(`Debt:      ${debt.length} open${stale ? ` (${stale} stale)` : ''}  — \`ac debt list\``);
      }
      // Same posture as Debt: suppressed at zero, and never throws on a project whose
      // .astrocode/ predates this phase and has no backlog.json at all — openBacklog
      // reads an absent file as a true empty, not a damaged one.
      const back = openBacklog(r);
      if (back.length) {
        console.log(`Backlog:   ${back.length} open  — \`ac backlog list\``);
      }
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
        await setMilestone(r, res.number);
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
        // A milestone close archives every phase on the roadmap, so "every phase is
        // complete" must be enforced here, not left as prose in the skill (#29) —
        // `complete` is the human gate, and archiving over it would be the one place
        // that gate could be skipped. `--force` archives unfinished phases on purpose.
        checkFlags('milestone complete', flags);
        // Only the closing milestone's own phases gate it (#29 follow-up): a phase scheduled
        // for a later milestone is not unfinished work of this one, and is not archived.
        const closing = loadRoadmap(r)?.milestone;
        const unfinished = (loadRoadmap(r)?.phases || [])
          .filter((ph) => belongsToMilestone(ph, closing) && ph.status !== 'complete');
        if (unfinished.length && !flags.force) {
          const list = unfinished.map((ph) => `  ${String(ph.number).padStart(2, '0')}  ${ph.status.padEnd(9)} ${ph.name}`).join('\n');
          die(`${unfinished.length} phase(s) are not complete — refusing to archive them:\n${list}\n` +
            '  finish them (/astro-accept), or pass --force to archive them unfinished');
        }
        const arch = await completeMilestone(r);
        const released = markComplete({ root: r, milestone: arch.milestone });
        await updateState(r, (s) => ({ ...s, status: 'milestone-complete', active_phase: null }));
        console.log(`✓ milestone ${arch.milestone} complete — archived ${arch.archived} phase(s) → ${arch.archiveDir}`);
        if (arch.kept) console.log(`  kept ${arch.kept} phase(s) scheduled for a later milestone on the roadmap`);
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
      } else if (sub === 'pr') {
        // ac flow pr — push the current milestone feature branch and print (or
        // open) a PR targeting develop. Throws on gate/guard failures — die()
        // converts the Error to ✖ + non-zero exit so the caller sees a clean message.
        const res = flowPR(r);
        if (res.url) {
          console.log(`✓ pushed "${res.branch}" → open PR at:`);
          console.log(`  ${res.url}`);
        } else {
          console.log(`✓ pushed "${res.branch}" to origin`);
          console.log(`• open a PR from "${res.branch}" → "${res.base}" manually`);
        }
        if (res.advisory) console.log(`  ${res.advisory}`);
      } else if (sub === 'release') {
        // ac flow release — push develop and print the develop→main PR URL.
        // Never tags here (OQ2/ADR-012): tagging happens after the PR merges via
        // `ac flow tag`. Throws on gate/guard failures — die() handles the ✖ line.
        const res = flowRelease(r);
        if (res.url) {
          console.log(`✓ pushed "${res.head}" → open PR at:`);
          console.log(`  ${res.url}`);
        } else {
          console.log(`✓ pushed "${res.head}" to origin`);
          console.log(`• open a PR from "${res.head}" → "${res.base}" manually`);
        }
        if (res.advisory) console.log(`  ${res.advisory}`);
      } else if (sub === 'tag') {
        // ac flow tag [version] — verify develop is in origin/main, then tag and
        // push. An optional version arg (pos[1]) passes a specific semver so the
        // hotfix pr-mode can call `ac flow tag v<N>.<k>` after the main PR merges.
        const version = pos[1] != null ? pos[1] : undefined;
        const res = flowTag(r, version);
        console.log(`✓ tagged "${res.tag}" on origin/main (${res.commit.slice(0, 8)})`);
      } else if (sub === 'hotfix') {
        // ac flow hotfix start <name>   — branch hotfix/<name> off main (local, offline-safe)
        // ac flow hotfix finish          — dual-land into main+develop, tag v<N>.<k>, push
        // pos[1] is the hotfix sub-subcommand; pos[2] is the name (for start).
        const hotfixSub = pos[1];
        if (hotfixSub === 'start') {
          const name = pos[2];
          if (!name) die('usage: ac flow hotfix start <name>');
          const res = flowHotfixStart(r, name);
          const verb = res.created ? 'created and switched to' : 'switched to';
          console.log(`✓ ${verb} "${res.branch}"`);
          if (res.advisory) console.log(`  ${res.advisory}`);
        } else if (hotfixSub === 'finish') {
          const res = flowHotfixFinish(r);
          if (res.prs) {
            // PR mode: forge PRs opened (or URLs printed) — no local merge, no auto-tag.
            console.log(`✓ pushed hotfix branch; PRs opened:`);
            for (const pr of res.prs) {
              if (pr.url) console.log(`  • ${pr.base} ← ${pr.url}`);
              else console.log(`  • open a PR from hotfix → "${pr.base}" manually`);
            }
            console.log(`⚠ run \`ac flow tag ${res.tag}\` after the main PR merges`);
          } else {
            // pr:none path: local dual-merge + tag + push all completed.
            console.log(`✓ hotfix merged into main and develop`);
            console.log(`✓ tagged "${res.tag}" on main and pushed`);
          }
        } else {
          die(`usage: ac flow hotfix <start <name> | finish>`);
        }
      } else {
        die(`unknown ac flow subcommand "${sub}" — usage: ac flow [init | pr | release | tag | hotfix start <name> | hotfix finish]`);
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
        // The number is already committed to the shared registry by the time we get
        // here, so a local failure cannot be silent: say which number was spent and
        // that it will not be reissued, rather than dying on a bare stack trace.
        let phase;
        try {
          phase = await addPhase(r, { number: res.number, name, milestone });
        } catch (e) {
          die(
            `${e.message}\n` +
            `  phase ${res.number} was already claimed on ${res.branch} and stays claimed — it will not be ` +
            `handed out again. Your roadmap and the registry disagree; run \`ac registry show\` to compare.`,
          );
        }
        console.log(`✓ phase ${phase.number} "${name}" (milestone ${milestone}) [registry: ${res.branch}]`);
        // Scheduling for a LATER milestone used to move the project into it silently
        // (issue #16). It no longer does — so say which milestone the project is still
        // on, because the difference is now the whole point and used to be invisible.
        const current = st.active_milestone || rm.milestone || 1;
        if (milestone !== current) {
          console.log(`  scheduled for milestone ${milestone} — the project stays on milestone ${current}`);
        }
        warnNameMatches(res.matches, gitIdentity(r).owner);
        // "Let's plan X" meets the earlier decision against X (D5) — never blocks, never
        // needs --force, the phase above is already created. An `obsolete` archive
        // ("the world moved on") deliberately never raises this.
        for (const m of declinedMatches(r, name)) {
          console.log(`  ⚠ already decided against "${m.title}" (${m.id}): ${m.reason}`);
        }
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
        if (!ph) die('usage: ac phase accept <phase> [--by name | --agent name] [--force]');
        checkFlags('phase accept', flags);
        if (ph.status !== 'verified' && !flags.force) {
          die(`phase ${ph.number} is "${ph.status}", not verified — run /astro-verify first (or pass --force)`);
        }
        // ADR-033 — record WHO SIGNED, and of what KIND.
        //
        // REQ-006 is the two-gate guarantee: the AI verifier reaches `verified`, and only a
        // human `/astro-accept` reaches `complete`. Until now `accepted_by` defaulted to the
        // repo's git identity, so an autonomous agent accepting on the operator's behalf was
        // recorded as the operator — indistinguishable from a human sign-off, which made the
        // guarantee unauditable from the record. `--by` did not help: it only renames the
        // signer, so a machine signature and a human one had the exact same shape.
        //
        // This CANNOT be auto-detected. When the operator accepts, their assistant runs this
        // command for them; when an autonomous agent accepts, the same. Both are an agent
        // invoking `ac` — the only difference is whether a human actually made the judgement,
        // which lives outside the process. So provenance is DECLARED, never sniffed. Pretending
        // to detect it would manufacture false confidence in the one record REQ-006 rests on.
        //
        // Default stays `human`: every acceptance to date was genuinely made by the operator,
        // and defaulting to "unknown" would retroactively cast doubt on records that are correct.
        // The burden sits on the agent path — /astro-accept instructs a stand-in signer to pass
        // `--agent`, and the reject path is untouched (a rejection claims no authority).
        const agentSigner = typeof flags.agent === 'string' ? flags.agent : null;
        const by = agentSigner || (typeof flags.by === 'string' ? flags.by : gitIdentity(r).owner);
        const kind = agentSigner ? 'agent' : 'human';
        await setPhaseStatus(r, ph.slug, 'complete', {
          accepted_by: by,
          accepted_kind: kind,
          accepted_at: new Date().toISOString(),
        });
        await updateState(r, (s) => ({ ...s, active_phase: s.active_phase === ph.slug ? null : s.active_phase }));
        console.log(
          `✓ phase ${ph.number} "${ph.name}" accepted by ${by}${agentSigner ? ' (AGENT — machine-signed, not human UAT)' : ''} → complete`,
        );
        // Same drain as `ac fix accept`: debt paid by this phase closes here, on the
        // acceptance, so the register can never claim work is done on a promise.
        for (const d of await closeDebtFor(r, { kind: 'phase', workRef: ph.slug })) {
          console.log(`✓ debt ${d.id} paid`);
        }
        // Same drain as debt, for the backlog (D1): a linked item closes automatically
        // the moment the phase that offered to fold it in is accepted — nobody ticks it
        // off by hand.
        for (const b of await closeBacklogFor(r, { kind: 'phase', workRef: ph.slug })) {
          console.log(`✓ backlog ${b.id} absorbed`);
        }
      } else if (sub === 'reject') {
        if (!ph) die('usage: ac phase reject <phase> --reason "…"');
        checkFlags('phase reject', flags);
        const reason = typeof flags.reason === 'string' ? flags.reason : '';
        await setPhaseStatus(r, ph.slug, 'rejected');
        await updateState(r, (s) => ({ ...s, blockers: [...(s.blockers || []), { phase: ph.slug, reason, at: new Date().toISOString() }] }));
        console.log(`✗ phase ${ph.number} "${ph.name}" → rejected${reason ? `: ${reason}` : ''}`);
        // Q1: a linked item whose phase is REJECTED reverts to open rather than being
        // stranded as `linked` forever — nothing is silently lost either way.
        for (const b of await reopenBacklogFor(r, { kind: 'phase', workRef: ph.slug })) {
          console.log(`• backlog ${b.id} back on the list`);
        }
      } else if (sub === 'effort') {
        // Per-phase effort dial (ADR-022), mirroring `ac models` ergonomics.
        //   ac phase effort <n>               RESOLVE: print the effective level
        //   ac phase effort <n> --effort <l>  RESOLVE with a one-off, non-persisting
        //                                     override (the `--preview` idiom — a
        //                                     single read, roadmap.json untouched — C5)
        //   ac phase effort <n> <level>       WRITE: persist the level for that phase
        // There is deliberately NO `ac config` effort key — effort is per-phase only,
        // resolved from the phase's own roadmap entry with a hardcoded `standard`
        // default (never sourced from config — C8).
        if (!ph) die('usage: ac phase effort <phase> [<level>] [--effort <level>]');
        const level = pos[2];
        if (level == null) {
          // RESOLVE mode: print the effective level so /astro-execute can consume it.
          // resolveEffort applies precedence override > stored > hardcoded default.
          const override = typeof flags.effort === 'string' ? flags.effort : undefined;
          console.log(resolveEffort(ph.effort ?? DEFAULT_EFFORT, override));
        } else {
          // WRITE mode: setPhaseEffort validates FIRST, so a bogus level throws
          // (→ main().catch → die, non-zero exit) with nothing written to disk (C1).
          await setPhaseEffort(r, ph.slug, level);
          console.log(`✓ phase ${ph.number} "${ph.name}" → ${level}`);
        }
      } else if (sub === 'note') {
        // Durable free-text status for a phase (ADR-044).
        //   ac phase note <n>            READ: print the current note (empty if none)
        //   ac phase note <n> "<text>"   WRITE: persist it; the renderer emits it
        //   ac phase note <n> ""         CLEAR
        // ROADMAP.md is generated, so this is the only place such a note survives.
        if (!ph) die('usage: ac phase note <phase> ["<text>"]');
        if (pos.length < 3) {
          console.log(ph.note ?? '');
        } else {
          const text = pos.slice(2).join(' ');
          const updated = await setPhaseNote(r, ph.slug, text);
          console.log(
            updated.note
              ? `✓ phase ${ph.number} "${ph.name}" note: ${updated.note}`
              : `✓ phase ${ph.number} "${ph.name}" note cleared`,
          );
        }
      } else if (sub === 'milestone') {
        // Correct which milestone a phase belongs to (issue #16).
        //   ac phase milestone <n>        READ: print it, or say it is unset
        //   ac phase milestone <n> <N>    WRITE: move the phase — and ONLY the phase
        // Deliberately does not touch the project's current milestone: that is
        // `ac milestone new`, and conflating the two is the bug this repairs.
        if (!ph) die('usage: ac phase milestone <phase> [<N>]');
        if (pos.length < 3) {
          // An absent field is reported as absent. Every roadmap written before this
          // landed has phases with no milestone, and printing a number there would
          // invent an assignment the file does not actually record.
          console.log(
            ph.milestone == null
              ? `phase ${ph.number} "${ph.name}" — no milestone recorded (set one with \`ac phase milestone ${ph.number} <N>\`)`
              : String(ph.milestone),
          );
        } else {
          // #32 — the registry claim moves FIRST, then the roadmap. Moving only the roadmap
          // left the claim on the old milestone and printed ✓ over a half-done repair.
          // Validate before either write, so a bogus value changes nothing anywhere.
          const target = Number(pos[2]);
          if (!Number.isInteger(target) || target < 1) die(`milestone must be a positive integer, got "${pos[2]}"`);
          const moved = repointPhaseClaim({ root: r, number: ph.number, milestone: target });
          if (!moved.ok) die(`${moved.error}\n  nothing was changed — the roadmap and the registry still agree`);
          const updated = await setPhaseMilestone(r, ph.slug, target);
          console.log(`✓ phase ${updated.number} "${updated.name}" → milestone ${updated.milestone}`);
          if (moved.source === 'remote' && moved.found) {
            console.log(moved.changed
              ? `  registry claim moved: milestone ${moved.from} → ${target} [${moved.branch}]`
              : `  registry claim already on milestone ${target} [${moved.branch}]`);
          } else if (moved.source === 'remote') {
            console.log(`  ⚠ no registry claim for phase ${updated.number} on ${moved.branch} — only the roadmap moved`);
          } else {
            console.log('  no shared registry in use — only the local roadmap moved');
          }
          console.log('  the project\'s active milestone is unchanged — use `ac milestone new` to move it');
        }
      } else {
        die('usage: ac phase <add|check|context|verify|accept|reject|effort|note|milestone> …');
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
        checkFlags('registry init', flags);
        const res = initRegistry({ root: r, force: !!flags.force });
        if (!res.ok) die(res.error);
        if (res.created) console.log(`✓ registry initialized on ${res.branch} — backfilled ${res.claims} claim(s)`);
        else console.log(`• registry already initialized (${res.claims} claim(s)) — pass --force to rebuild from roadmaps`);
        return;
      }
      if (pos[0] !== 'show') die('usage: ac registry <show|init [--force]>');
      const reg = readRegistry(r);
      if (!reg.available) {
        console.error(
          reg.unreachable
            ? `cannot reach \`${reg.remote}\` to read ${reg.branch} — the registry may be intact; this is a connectivity failure, not an empty registry`
            : 'no coordinated remote — add an origin, then `ac registry init`',
        );
        json({ available: false, unreachable: !!reg.unreachable });
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
      // six `ac config set models.<role>` calls. The ladder is opus→sonnet only,
      // except the mechanical wave `integrator` role, which carve-out ADR-027
      // permitted, but ADR-035 reverted it — no role runs haiku. See lib/models.mjs for the profiles.
      //   ac models                  print the current effective tiers
      //   ac models <profile>        apply the preset (persist to config.models)
      //   ac models <profile> --preview   print the preset JSON without writing
      //                                   (used by /astro-execute --fast for a
      //                                    one-off run that doesn't persist)
      // A profile sets the model tier AND the reasoning depth together: both
      // move cost, and leaving one at the host default while switching the
      // other makes "go faster" only half-work.
      const r = root();
      const name = pos[0];
      if (!name) {
        const c = loadConfig(r);
        json({ models: c.models || {}, reasoning: c.reasoning || {} });
        return;
      }
      let preset;
      let reasoningPreset;
      try {
        preset = profileModels(name);
        reasoningPreset = profileReasoning(name);
      } catch (e) {
        die(`${e.message} (usage: ac models [${PROFILE_NAMES.join('|')}] [--preview])`);
      }
      if (flags.preview) {
        json({ models: preset, reasoning: reasoningPreset });
        return;
      }
      const next = await updateConfig(r, (c) => ({ ...c, models: preset, reasoning: reasoningPreset }));
      console.log(`✓ models + reasoning → ${name} profile`);
      json({ models: next.models, reasoning: next.reasoning });
      return;
    }

    case 'canon': {
      const r = root();
      if (pos[0] === 'pull') {
        checkFlags('canon pull', flags);
        const res = canonPull(r, { force: flags.force === true });
        if (!res.ok) {
          console.error('• no coordinated remote — canon is local-only');
        } else {
          // ADR-053 (D7/C9) — the two observably different outcomes ("I changed your
          // files" and "I changed nothing") must never print the same line: that
          // byte-identical success line is what let both production incidents hide in
          // plain sight. Reported per file, so a partial pull (one file updated, one
          // refused, one already current) is never flattened into one summary line.
          const names = Object.keys(res.files);
          if (!names.length) {
            console.log(`• nothing to pull — ${res.branch} has no canon yet`);
          } else if (names.every((n) => res.files[n].status === 'unchanged')) {
            console.log(`• already up to date with ${res.branch} — ${names.join(', ')} unchanged`);
          } else {
            for (const name of names) {
              const { status } = res.files[name];
              if (status === 'updated') console.log(`✓ ${name}: updated from ${res.branch}`);
              else if (status === 'unchanged') console.log(`• ${name}: already up to date`);
              else console.error(`⚠ ${name}: refused`);
            }
          }
          for (const ref of res.refused) {
            console.error(
              `⚠ ${ref.file} was NOT overwritten — ${ref.reason}. Fix: ${ref.fixes.join(', ')}.`,
            );
          }
          // ADR-034: a preserved entry means the local file diverged from the registry.
          // Silence here is what let the old overwrite destroy work unnoticed.
          if (res.preserved.length) {
            console.error(
              `⚠ kept ${res.preserved.length} local-only decision(s) the registry has never seen: ${res.preserved.join(', ')} — ` +
                `re-add them via \`ac decision add\` so they reach the team (DECISIONS.md is never bulk-pushed).`,
            );
          }
          // ADR-053 (D5) — a genuine same-id collision refuses and names BOTH sides;
          // nothing is ever renumbered or moved.
          for (const c of res.collisions) {
            console.error(
              `⚠ ${c.id} collision — local has "${c.localTitle}", the registry has "${c.remoteTitle}". ` +
                `Nothing was changed; record a new decision that supersedes one of them.`,
            );
          }
          // ADR-053 (D6) — reported on EVERY sync, never collapsed by a plain pull.
          for (const d of res.duplicates) {
            console.error(
              `⚠ duplicate decision "${d.title}": ${d.ids.join(', ')} — run \`ac canon dedupe\` to collapse.`,
            );
          }
        }
      } else if (pos[0] === 'push') {
        checkFlags('canon push', flags);
        const res = canonPush(r, { dryRun: flags['dry-run'] === true });
        if (!res.ok) die(res.error || 'no coordinated remote — cannot push canon');
        else if (res.dryRun) {
          const what = !res.remoteExists
            ? `would CREATE CONVENTIONS.md on ${res.branch}`
            : res.wouldChange
              ? `would UPDATE CONVENTIONS.md on ${res.branch}`
              : `CONVENTIONS.md on ${res.branch} is already identical — a real push would change nothing`;
          console.log(`◆ dry run: ${what}. NOTHING was published.`);
        } else console.log(`✓ published ${res.pushed.join(', ')} to ${res.branch}`);
      } else if (pos[0] === 'dedupe') {
        checkFlags('canon dedupe', flags);
        const res = canonDedupe(r);
        if (!res.ok) die(res.error);
        // #45 — say WHERE each duplicate was removed: a local-only collapse used to print
        // the same ✓ and was silently undone by the next pull.
        const seen = new Set();
        for (const rem of [...res.registryRemoved, ...res.removed]) {
          if (seen.has(rem.id)) continue;
          seen.add(rem.id);
          const onReg = res.registryRemoved.some((x) => x.id === rem.id);
          const onLocal = res.removed.some((x) => x.id === rem.id);
          const where = onReg && onLocal ? `${res.branch} + local` : onReg ? res.branch : 'local only';
          console.log(`✓ removed ${rem.id} — duplicate of ${rem.keptId} ("${rem.title}") [${where}]`);
        }
        if (!seen.size) console.log('• no exact-duplicate decisions found — nothing collapsed');
        else if (res.scope === 'local') console.log('  no shared registry in use — only the local DECISIONS.md changed');
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
        checkFlags('decision add', flags);
        const res = await addDecision(r, {
          title,
          why: typeof flags.why === 'string' ? flags.why : '',
          rejected: typeof flags.rejected === 'string' ? flags.rejected : '',
        });
        // ADR-053 (D4/D5) — a genuine collision (an independent decision, or an edit to
        // an already-published one) refuses the add outright; nothing is renumbered.
        if (res.ok === false && res.refused === 'decision-collision') {
          const lines = res.collisions.map((c) =>
            c.kind === 'edited-published'
              ? `${c.id} was edited locally after publishing — local: "${c.localTitle}", registry: "${c.remoteTitle}". ` +
                `Record a NEW decision that supersedes it instead of editing the published one.`
              : `${c.id} collides — local: "${c.localTitle}", registry: "${c.remoteTitle}". ` +
                `Nothing was changed; record a new decision that supersedes one of them.`,
          );
          die(`refused — ${lines.join(' ')}`);
        }
        const tag = res.source === 'remote' ? `[shared: ${res.branch}]` : '[local]';
        console.log(`✓ ${res.id} — ${res.title} (${res.date}) ${tag}`);
        if (res.publishedConventions) console.log(`✓ published CONVENTIONS.md to ${res.branch}`);
        // ADR-053 (D3) — the implicit publish REFUSED because it would have overwritten a
        // teammate's newer published copy. Loud on stderr: the decision still landed, so a
        // caller reading only the ✓ line would otherwise believe their convention edit is
        // shared when it is not — and the destructive version of this was silent too.
        if (res.conventionsRefused) {
          const c = res.conventionsRefused;
          console.error(
            `⚠ did NOT publish ${c.file} — ${c.reason}. ` +
              `Reconcile first: \`${c.fixes[0]}\` takes the registry's copy (yours is replaced, so keep your edit), ` +
              `then re-apply it and \`${c.fixes[1]}\` to publish deliberately.`,
          );
        }
        // ADR-039: an add that had to rescue local-only entries means the working tree had
        // decisions the registry has never seen. Silence here is what let them be destroyed.
        if (res.preserved && res.preserved.length) {
          console.error(`⚠ carried ${res.preserved.length} local-only decision(s) into the shared log: ${res.preserved.join(', ')}`);
        }
        if (res.duplicates && res.duplicates.length) {
          for (const d of res.duplicates) {
            console.error(
              `⚠ duplicate decision "${d.title}": ${d.ids.join(', ')} — run \`ac canon dedupe\` to collapse.`,
            );
          }
        }
      } else if (pos[0] === 'list') {
        const { decisions } = loadCanon(r);
        process.stdout.write((decisions || '(no decisions yet)') + '\n');
      } else {
        die('usage: ac decision <add|list>');
      }
      return;
    }

    case 'tune': {
      // Apply (or undo) the astro-recommended Claude Code settings — the officially
      // supported settings.json subset only, additively and reversibly.
      checkFlags('tune', flags);
      if (pos.length) die(`unexpected argument${pos.length > 1 ? 's' : ''} for \`ac tune\`: ${pos.join(' ')} (usage: ac tune [--user] [--undo])`);
      const scope = flags.user ? 'user' : 'project';
      const target = tuneTarget(scope, {
        projectRoot: flags.user ? undefined : root(),
        configDir: flags.user ? baseConfigDir() : undefined,
      });
      if (flags.undo) {
        const res = undoTune(target);
        console.log(res.undone
          ? `✓ tune undone in ${res.file} — removed ${res.removed.allow.length} allow entr(ies), ${res.removed.keys.length} key(s)`
          : `• nothing to undo in ${res.file} (no tune manifest recorded)`);
        return;
      }
      const res = applyTune(target);
      console.log(`✓ tuned ${res.file}  [${scope}]`);
      console.log(`  permissions.allow: +${res.added.allow.length} added` +
        (res.skippedAllow ? ` (${res.skippedAllow} already present)` : '') +
        ` — ac CLI, node --test, read-only git → fewer prompts outside Bypass mode`);
      console.log(res.added.keys.length
        ? `  set (were absent): ${res.added.keys.join(', ')}`
        : '  keys: all already user-set — left untouched');
      console.log(`  not touchable (internal-only /config state): ${UNTUNABLE.join(' · ')}`);
      console.log('  reverse any time: ac tune --undo' + (flags.user ? ' --user' : ''));
      return;
    }

    case 'statusline': {
      const sub = pos[0] || 'preview';
      if (sub === 'install') {
        const res = installStatusline(FRAMEWORK_ROOT);
        console.log(`✓ statusline deployed (${res.hooks} hook file(s)) and wired into ${res.wired.length} config dir(s):`);
        for (const w of res.wired) {
          console.log(`  ${w.ok ? '✓' : '⚠'} ${w.label}: ${w.dir}${w.ok ? '' : '  (skipped — unparseable settings.json)'}`);
        }
        console.log('  takes effect on the next statusline repaint (a keystroke or the next turn).');
        return;
      }
      if (sub !== 'preview') die(`unknown statusline subcommand "${sub}" — use install | preview`);
      // Render the real hook against a representative Claude stdin blob so the
      // preview is WYSIWYG (dot + bar included). A tiny synthetic transcript drives
      // the recap + context-fill; --tokens/--model/--recap override the samples.
      // We run it under an isolated HOME so the leading busy/idle dot can be shown
      // (seeded here) without reading or writing the real session-state file.
      const cwd = process.cwd();
      const previewHome = join(tmpdir(), `ac-sl-preview-${process.pid}`);
      mkdirSync(join(previewHome, '.astro', 'code'), { recursive: true });
      const tp = join(previewHome, 'transcript.jsonl');
      const cacheRead = Number(flags.tokens) || 88_000;
      writeFileSync(tp,
        JSON.stringify({ type: 'user', message: { content: typeof flags.recap === 'string' ? flags.recap : 'wire up the new statusline' } }) + '\n' +
        JSON.stringify({ message: { usage: { input_tokens: 12_000, cache_creation_input_tokens: 4_000, cache_read_input_tokens: cacheRead } } }) + '\n');
      const now = Math.floor(Date.now() / 1000);
      const rec = flags.idle ? { prompt: now - 10, stop: now } : { prompt: now, at: now };
      writeFileSync(join(previewHome, '.astro', 'code', 'session-state.json'), JSON.stringify({ preview: rec }));
      // seed the version file so the preview shows the ⊡ astro v<version> mark like the real line
      try { const v = (JSON.parse(readFileSync(join(FRAMEWORK_ROOT, 'package.json'), 'utf8')) || {}).version; if (v) writeFileSync(join(previewHome, '.astro', 'code', 'version'), v + '\n'); } catch { /* best-effort */ }
      const blob = {
        session_id: 'preview',
        workspace: { current_dir: cwd }, cwd,
        model: { id: typeof flags.model === 'string' ? flags.model : 'claude-opus-4-8', display_name: typeof flags.name === 'string' ? flags.name : 'Opus 4.8' },
        transcript_path: tp,
      };
      const hook = join(HOME_ROOT, 'hooks', 'astro-statusline.mjs');
      const r = spawnSync(process.execPath, [hook, ''], { input: JSON.stringify(blob), encoding: 'utf8', windowsHide: true, env: { ...process.env, HOME: previewHome } });
      process.stdout.write((r.stdout || '(empty)') + '\n');
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
        if (t.selfHosted) {
          console.log(`✓ self-hosted → ${t.dir}  [${t.label}]  (source files in place — not symlinked)`);
          continue;
        }
        const hk = t.hooks ? ', update banner+statusline' : '';
        const who = t.hostLabel ? `${t.hostLabel} ` : '';
        console.log(`✓ ${who}→ ${t.dir}  [${t.label}]  (${t.commands} cmds, ${t.agents} agents${hk})`);
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
        const npm = spawnSync('npm', ['install', '-g', clone], { encoding: 'utf8', windowsHide: true });
        if (npm.status !== 0) console.error(`⚠ npm install -g failed — run it manually in ${clone}:\n${(npm.stderr || '').trim()}`);
        else console.log('✓ global `ac` refreshed');
      }

      const res = installClaude(clone);
      // The cached update check describes the version we just replaced; drop it so the
      // banner/statusline stop advertising an applied update (the SessionStart hook
      // re-runs the worker when the cache is missing).
      rmSync(join(ASTRO_HOME, 'update-check.json'), { force: true });
      console.log(`✓ installed → ${res.home} (${res.commands} cmds, ${res.agents} agents, ${res.workflows} workflows, ${res.hooks} hooks) across ${res.targets.length} config dir(s)`);
      let version = '?';
      try { version = (JSON.parse(readFileSync(join(clone, 'package.json'), 'utf8')) || {}).version || '?'; } catch { /* ignore */ }
      console.log(`✓ astro-code is now at v${version} — restart Claude Code if the command list doesn't refresh`);
      return;
    }

    case 'path': {
      // Print the RESOLVED path (#15): where /home is a symlink (/var/home on ostree
      // distros), the unresolved form never matches the directory Claude Code asks
      // `permissions.additionalDirectories` to grant, so a grant copied from here
      // silently failed. A sub-path that doesn't exist yet is joined onto the
      // resolved home instead.
      let home = HOME_ROOT;
      try { home = realpathSync(HOME_ROOT); } catch { /* not installed yet — print as-is */ }
      const target = pos[0] ? join(home, pos[0]) : home;
      let out = target;
      try { out = realpathSync(target); } catch { /* sub-path absent — keep the joined form */ }
      console.log(out);
      return;
    }

    default:
      die(`unknown command "${cmd}" — run \`ac help\``);
  }
}

main().catch((e) => die(e?.message || String(e)));
