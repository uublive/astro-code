// Phase 34 t11 — the prose guard + CLI round-trip for challenge mode (test-after by
// design, PLAN.md: it asserts on command/template text that only exists once
// t1/t2/t4-t10 have landed). Shaped like tests/principle_capture.test.mjs: readFileSync,
// scoped slices, and failure messages that quote the missing/offending text and name
// the command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';
import { initRegistry } from '../lib/registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS_DIR = join(ROOT, 'commands');
const TEMPLATES_DIR = join(ROOT, 'templates');
const SPEC_PATH = join(TEMPLATES_DIR, 'challenge.md');
const AC = join(ROOT, 'bin', 'ac.mjs');

const cmd = (name) => readFileSync(join(COMMANDS_DIR, name), 'utf8');
const specSrc = readFileSync(SPEC_PATH, 'utf8');
// A soft-wrapped markdown source splits mid-phrase at arbitrary columns — flatten all
// whitespace runs to a single space before matching any multi-word phrase, so a test
// fails only when the WORDS are missing, never because prose reflowed across a line.
const flatten = (s) => s.replace(/\s+/g, ' ');
const specFlat = flatten(specSrc);

const POINTER = '$(ac path templates)/challenge.md';
const ENTRY_POINTS = ['astro-new-project.md', 'astro-adopt.md', 'astro-discuss.md', 'astro-challenge.md'];
const CHECKPOINT_LINE = 'N questions still open — next round or capture now?';
const NUDGE_LINE = "You took all N recommendations; any you'd actually push on?";

// ── 1. The method is stated once, in full, in templates/challenge.md ────────────────

test('templates/challenge.md states every-unblocked-decision rounds with no cap', () => {
  assert.ok(
    /every decision whose prerequisites are already settled/i.test(specSrc),
    'the spec must state a round is every unblocked decision, not a curated handful',
  );
  assert.ok(/no fixed cap/i.test(specSrc), 'the spec must state there is no fixed cap on questions per round');
  assert.ok(/no hard round cap/i.test(specSrc), 'the spec must state there is no hard cap on the number of rounds');
});

test('templates/challenge.md states dependents wait for a later round', () => {
  assert.ok(
    /depends on one still open in the same round waits for a later round/i.test(specFlat),
    'the spec must state a question depending on one still open waits for a later round',
  );
});

test('templates/challenge.md states the Q-numbered round format with a recommendation per question', () => {
  assert.ok(/Q1.{0,20}Qn/is.test(specSrc.replace(/\n/g, ' ')), 'the spec must number the round Q1 … Qn');
  assert.ok(/recommended answer/i.test(specSrc), 'the spec must state each question carries a recommended answer');
});

test('templates/challenge.md states "ok" accepts the recommendation', () => {
  assert.ok(
    /replying\s+"ok".{0,80}accepts the recommendation/is.test(specSrc.replace(/\n/g, ' ')),
    'the spec must state that replying "ok" accepts the recommendation as given',
  );
});

test('templates/challenge.md states the round is never asked via AskUserQuestion', () => {
  assert.ok(
    /never through `AskUserQuestion`/i.test(specSrc),
    'the spec must state the round itself is asked as plain text, never through AskUserQuestion',
  );
});

test('#189: challenge.ask picker asks the round through AskUserQuestion, split at 4, text stays the default', () => {
  const flat = specSrc.replace(/\n/g, ' ');
  assert.ok(specSrc.includes('ac config get challenge.ask'), 'the spec names the setting and how to read it');
  assert.match(flat, /`text` unless the project set\s+`picker`/, 'text is the default');
  assert.match(flat, /\*\*`picker`, on a host that has one:\*\* ask the round through `AskUserQuestion`/);
  assert.match(flat, /at most 4 questions, so a bigger round is split over consecutive\s+calls/);
  assert.match(flat, /"\(Recommended\)"/, 'the recommendation is the first, marked option');
  assert.match(flat, /Otherwise \(unset, `text`, any other value, outside a project, or no picker on the\s+host\):\*\* the plain-text round/);
});

test('templates/challenge.md states facts are looked up, never asked, via a read-only sub-agent', () => {
  assert.ok(/Facts are looked up, never asked/i.test(specSrc), 'the spec must title §2 "Facts are looked up, never asked"');
  assert.ok(/never a question/i.test(specFlat), 'the spec must state discoverable facts are never asked');
  assert.ok(
    /read-only sub-agent/i.test(specSrc),
    'the spec must state a broad sweep goes to a read-only sub-agent',
  );
});

test('templates/challenge.md states saving after every round, with the ac decision add rule', () => {
  assert.ok(
    /save.{0,20}after every round/is.test(specSrc.replace(/\n/g, ' ')) || /## 4\. Save after every round/.test(specSrc),
    'the spec must state settled answers are saved after every round',
  );
  assert.ok(
    specSrc.includes('ac decision add "<choice>" --why "<why>"'),
    'the spec must state the ac decision add rule for hard-to-reverse choices',
  );
});

test('templates/challenge.md states the checkpoint line verbatim, with a plain-question fallback', () => {
  assert.ok(specSrc.includes(CHECKPOINT_LINE), 'the spec must state the checkpoint line verbatim');
  assert.ok(
    /no picker exists.{0,80}plain text instead/is.test(specSrc.replace(/\n/g, ' ')),
    'the spec must state a plain-text fallback where no AskUserQuestion picker exists',
  );
});

test('templates/challenge.md states capture-now leaves questions open, never filled with the recommendation', () => {
  assert.ok(
    /"Capture now".{0,120}records every remaining open question as \*\*open\*\*/is.test(specSrc.replace(/\n/g, ' ')),
    'the spec must state capture-now records remaining questions as open',
  );
  assert.ok(
    /never filled with its\s*\n?\s*recommendation/i.test(specSrc) || /never filled with its recommendation/i.test(specSrc.replace(/\n/g, ' ')),
    'the spec must state open questions are never filled with the recommendation',
  );
});

test('templates/challenge.md states the nudge line verbatim and that it never repeats', () => {
  assert.ok(specSrc.includes(NUDGE_LINE), 'the spec must state the rubber-stamp nudge line verbatim');
  assert.ok(
    /at\s*\n?\s*most once per session/i.test(specSrc) || /at most once per session/i.test(specSrc.replace(/\n/g, ' ')),
    'the spec must state the nudge fires at most once per session',
  );
  assert.ok(/never again after the first time/i.test(specSrc), 'the spec must state the nudge is never repeated');
});

test('templates/challenge.md keeps unknowns open and offers ac backlog add, claiming no phase number', () => {
  assert.ok(
    /recorded as an open question/i.test(specSrc),
    'the spec must state an "I don\'t know" answer is recorded as an open question',
  );
  assert.ok(
    specSrc.includes('ac backlog add "<question>"'),
    'the spec must state the ac backlog add offer for leftover open questions',
  );
  assert.ok(
    /never claim a phase number/i.test(specSrc),
    'the spec must state the method never claims a phase number',
  );
});

// ── 2. Single source: every entry point points at the spec, none restates it ────────

test('each entry point references the spec as `$(ac path templates)/challenge.md`', () => {
  const missing = ENTRY_POINTS.filter((name) => !cmd(name).includes(POINTER));
  assert.deepEqual(
    missing,
    [],
    `every challenge entry point must reference the spec as \`${POINTER}\` — missing in: ${missing.join(', ')}`,
  );
});

test('none of the four entry points nor astro-autonomous.md restates the checkpoint, the nudge or a Q1 round format', () => {
  const files = [...ENTRY_POINTS, 'astro-autonomous.md'];
  const offenders = files.filter((name) => {
    const src = cmd(name);
    return src.includes(CHECKPOINT_LINE) || src.includes(NUDGE_LINE) || /^Q1\./m.test(src);
  });
  assert.deepEqual(
    offenders,
    [],
    `the checkpoint/nudge lines and the Q1 round format must live ONLY in templates/challenge.md — restated (drift bait) in: ${offenders.join(', ')}`,
  );
});

// ── 3. Entry points: each wires the method at the right seam ────────────────────────

test('astro-discuss.md: [--challenge] is in the argument-hint, the marker is line 2, riders come first, an agent never uses challenge mode', () => {
  const src = cmd('astro-discuss.md');
  const hint = src.split('\n')[2];
  assert.match(hint, /\[--challenge\]/, 'astro-discuss.md argument-hint must list [--challenge]');
  assert.ok(
    src.includes('<!-- astro-challenge: <rounds> rounds -->'),
    'astro-discuss.md must state the line-2 marker text verbatim',
  );
  assert.ok(
    /1b debt and 1c backlog riders are still asked first/i.test(flatten(src)),
    'astro-discuss.md must state the 1b/1c riders are asked first, in round one',
  );
  assert.ok(
    /never uses challenge mode/i.test(flatten(src)),
    'astro-discuss.md must state an agent answering on the operator\'s behalf never uses challenge mode',
  );
});

test('astro-autonomous.md: --challenge is in the argument-hint and passes `/astro-discuss <number> --challenge`', () => {
  const src = cmd('astro-autonomous.md');
  const hint = src.split('\n')[2];
  assert.match(hint, /\[--challenge\]/, 'astro-autonomous.md argument-hint must list [--challenge]');
  assert.ok(
    src.includes('/astro-discuss <number> --challenge'),
    'astro-autonomous.md must pass --challenge through as `/astro-discuss <number> --challenge`',
  );
});

test('astro-new-project.md: the 3b fork offers challenge mode before quick, recommended', () => {
  const src = cmd('astro-new-project.md');
  const forkIdx = src.indexOf('3b.');
  assert.notStrictEqual(forkIdx, -1, 'astro-new-project.md must have a 3b step');
  const block = flatten(src.slice(forkIdx, src.indexOf('\n4.', forkIdx)));
  const challengeIdx = block.search(/"Challenge me"/);
  const quickIdx = block.search(/"Quick interview"/);
  assert.ok(
    challengeIdx !== -1 && quickIdx !== -1,
    'astro-new-project.md 3b block must name both "Challenge me" and "Quick interview"',
  );
  assert.ok(
    challengeIdx < quickIdx,
    'astro-new-project.md 3b block must offer "Challenge me" before "Quick interview"',
  );
  assert.ok(/recommended here/i.test(block), 'astro-new-project.md 3b block must mark an option recommended');
});

test('astro-adopt.md: the 3b fork offers quick before challenge, recommended, intent-only, reusing the mapper report', () => {
  const src = cmd('astro-adopt.md');
  const forkIdx = src.indexOf('3b.');
  assert.notStrictEqual(forkIdx, -1, 'astro-adopt.md must have a 3b step');
  const block = flatten(src.slice(forkIdx, src.indexOf('\n4.', forkIdx)));
  const quickIdx = block.search(/"Quick interview"/);
  const challengeIdx = block.search(/"Challenge me"/);
  assert.ok(quickIdx !== -1 && challengeIdx !== -1, 'astro-adopt.md 3b block must name both options');
  assert.ok(quickIdx < challengeIdx, 'astro-adopt.md 3b block must offer "Quick interview" before "Challenge me"');
  assert.ok(/recommended here/i.test(block), 'astro-adopt.md 3b block must mark an option recommended');
  assert.ok(/intent only/i.test(block), 'astro-adopt.md 3b block must restrict challenge questions to intent only');
  assert.ok(
    /reuse it, never re-spawn the mapper per round/i.test(block),
    'astro-adopt.md 3b block must reuse the step-2 astro-mapper report rather than re-spawning it',
  );
});

test('astro-challenge.md: ac backlog add, --append note writes, no --replace, an outside-project one-line notice', () => {
  const src = cmd('astro-challenge.md');
  assert.ok(src.includes('ac backlog add'), 'astro-challenge.md must run `ac backlog add` for a new idea');
  assert.ok(src.includes('--append'), 'astro-challenge.md must append each round to the backlog note');
  assert.ok(
    /Never `--replace`/.test(src),
    'astro-challenge.md must explicitly rule out --replace on the backlog note',
  );
  assert.ok(
    /no `\.astrocode\/` here/i.test(flatten(src)),
    'astro-challenge.md must state the outside-project notice for when there is no .astrocode/',
  );
  assert.ok(
    /this conversation is the only record/i.test(flatten(src)),
    'astro-challenge.md must state, in one line, that nothing is written to disk outside a project',
  );
});

// ── 4. CLI round-trip: the method's own writes actually work end to end (C5/C12) ────

function mkBareRemote() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-challenge-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  return bare;
}

function mkWorkdir(bare) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-challenge-cli-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  if (bare) git(['remote', 'add', 'origin', bare], { cwd: dir });
  initPlanning(dir, { name: 'challengecliproj' });
  return dir;
}

const run = (args, cwd) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8' });

test('C5/C12: ac backlog add/note/promote carries two challenge rounds into a real phase, and ac phase context still reads stub', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);

  const add = run(['backlog', 'add', 'a challenged idea'], dir);
  assert.strictEqual(add.status, 0, add.stderr);
  const id = JSON.parse(run(['backlog', 'list', '--json'], dir).stdout)[0].id;

  const round1 = 'Round 1\nSettled: use local disk for uploads\nOpen: none';
  const note1 = run(['backlog', 'note', id, round1, '--append'], dir);
  assert.strictEqual(note1.status, 0, note1.stderr);

  const round2 = 'Round 2\nSettled: ship a CLI, not a web app\nOpen: none';
  const note2 = run(['backlog', 'note', id, round2, '--append'], dir);
  assert.strictEqual(note2.status, 0, note2.stderr);

  const shown = run(['backlog', 'show', id], dir);
  assert.strictEqual(shown.status, 0, shown.stderr);
  const item = JSON.parse(shown.stdout);
  assert.match(item.note, /Round 1/);
  assert.match(item.note, /Round 2/);
  assert.match(item.note, /local disk for uploads/);
  assert.match(item.note, /ship a CLI, not a web app/);

  const decision = run(['decision', 'add', 'Ship a CLI, not a web app', '--why', 'settled during a challenge session'], dir);
  assert.strictEqual(decision.status, 0, decision.stderr);

  const promoted = run(['backlog', 'promote', id], dir);
  assert.strictEqual(promoted.status, 0, promoted.stderr);
  const number = Number((promoted.stdout.match(/phase (\d+)/) || [])[1]);
  assert.ok(Number.isInteger(number), `promote must report the claimed phase number: ${promoted.stdout}`);

  const rm = JSON.parse(readFileSync(paths(dir).roadmap, 'utf8'));
  const ph = rm.phases.find((p) => p.number === number);
  assert.ok(ph, 'the roadmap must gain the promoted phase');

  const ctxPath = join(paths(dir).phases, ph.slug, 'CONTEXT.md');
  const ctx = readFileSync(ctxPath, 'utf8');
  assert.match(ctx, /Round 1/, 'CONTEXT.md must carry round 1');
  assert.match(ctx, /Round 2/, 'CONTEXT.md must carry round 2');

  const status = run(['phase', 'context', String(number)], dir);
  assert.strictEqual(status.status, 0, status.stderr);
  assert.strictEqual(status.stdout.trim(), 'stub', 'a promoted seed must still owe a real /astro-discuss round');
});

// ── 5. Shipped + discoverable (C2/C13) ───────────────────────────────────────────────

test('ac help names /astro-challenge and --challenge', () => {
  const out = run(['help'], ROOT);
  assert.strictEqual(out.status, 0, out.stderr);
  assert.match(out.stdout, /\/astro-challenge/, 'ac help must name /astro-challenge');
  assert.match(out.stdout, /--challenge/, 'ac help must name --challenge');
});

test('commands/astro-help.md and MANUAL.md list /astro-challenge and --challenge', () => {
  const help = cmd('astro-help.md');
  assert.match(help, /\/astro-challenge/, 'astro-help.md must list /astro-challenge');
  assert.match(help, /--challenge/, 'astro-help.md must list --challenge');

  const manual = readFileSync(join(ROOT, 'MANUAL.md'), 'utf8');
  assert.match(manual, /\/astro-challenge/, 'MANUAL.md must list /astro-challenge');
  assert.match(manual, /--challenge/, 'MANUAL.md must list --challenge');
});

test('templates/PROJECT.md has an ## Open questions section', () => {
  const project = readFileSync(join(TEMPLATES_DIR, 'PROJECT.md'), 'utf8');
  assert.match(project, /^## Open questions$/m, 'templates/PROJECT.md must have an ## Open questions section');
});

test('install publishes templates/challenge.md and an astro-challenge skill for Codex', async (t) => {
  const prev = {
    HOME: process.env.HOME, CFG: process.env.CLAUDE_CONFIG_DIR, CX: process.env.CODEX_HOME,
    CURSOR: process.env.CURSOR_CONFIG_DIR, PATH: process.env.PATH,
  };
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-challenge-install-'));
  mkdirSync(join(fakeHome, '.claude'), { recursive: true });
  const codexHome = join(fakeHome, '.codex');
  mkdirSync(codexHome, { recursive: true });
  process.env.HOME = fakeHome;
  delete process.env.CLAUDE_CONFIG_DIR;
  process.env.CODEX_HOME = codexHome;
  // Pin Cursor out of the picture (phase 35 t13/P10): otherwise a real
  // `cursor-agent` on the test runner's own PATH would get wired here too.
  delete process.env.CURSOR_CONFIG_DIR;
  process.env.PATH = mkdtempSync(join(tmpdir(), 'ac-no-cursor-'));
  t.after(() => {
    for (const [k, v] of [['HOME', prev.HOME], ['CLAUDE_CONFIG_DIR', prev.CFG], ['CODEX_HOME', prev.CX], ['CURSOR_CONFIG_DIR', prev.CURSOR], ['PATH', prev.PATH]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const { installClaude } = await import(`../lib/install.mjs?challenge=${encodeURIComponent(fakeHome)}`);
  installClaude(ROOT);

  assert.ok(
    existsSync(join(fakeHome, '.astro', 'code', 'templates', 'challenge.md')),
    'install must publish templates/challenge.md under the astro home',
  );
  assert.ok(
    existsSync(join(codexHome, 'skills', 'astro-challenge', 'SKILL.md')),
    'install must publish an astro-challenge skill for Codex',
  );
});

// Phase 34's final gate (PLAN.md t11): the whole suite must still exit 0.
