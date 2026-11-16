// Phase 36 — the astro-mods plugin skeleton (ADR-071): it enforces NOTHING and fails open.
// RED first (ADR-018): the plugin's modules arrive only through `await import(...)` inside the
// test bodies, so a missing module fails each test on its own.
//
// The engine is the shared simulator in fixtures/mods_engine.mjs (phase 39 moved it there so the
// blindfold suite drives the same hooks). Event shapes come from PROBE.md: `session.start` is
// `{ cwd, surface, isInteractive }`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { boot, answer, switches, NAMES, SESSION_START, BENEATH } from './fixtures/mods_engine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'mods', 'astro-mods');
const HOOKS = join(PLUGIN, 'hooks');
// a phase's PROBE.md lives in .astrocode/phases while its milestone is open, and in
// .astrocode/milestones/<n>/phases once `ac milestone complete` archives it
const probeOf = (slug) => {
  const live = join(ROOT, '.astrocode', 'phases', slug, 'PROBE.md');
  if (existsSync(live)) return live;
  const milestones = join(ROOT, '.astrocode', 'milestones');
  for (const m of existsSync(milestones) ? readdirSync(milestones) : []) {
    const archived = join(milestones, m, 'phases', slug, 'PROBE.md');
    if (existsSync(archived)) return archived;
  }
  return live;
};
const PROBE_MDS = [
  '36-astro-mods-foundation-adr-api-probe',
  '39-blindfold-mod-plan-blind-verifier-and',
  '41-witness-mod-detect-human-vs-agent',
  '42-brief-section-mod-principles-brief-as',
  '43-phase-band-mod-phase-band-with-next',
].map(probeOf);
const ARGV = ['ac', 'mods', 'status', '--json', '--switches-only'];
// brief-section's hooks, in register.js order (phase 42 PROBE.md: F1 classic.SessionStart drops the
// SessionStart parts, F9-F11 session.append rewrites the PreCompact row, F14 prompt.compose adds the
// section; F22 allows ONE session.start handler, so that one stays the existing registration).
const BRIEF_HOOKS = ['classic.SessionStart', 'prompt.compose', 'session.append'];
// phase 43: phase-band's hooks. session.start and agent.spawn already have an UNMATCHED hook in this
// plugin (a second one is refused by the validator, phase 42 F22), so these two carry a matcher.
const BAND_HOOKS = ['session.start', 'turn.start', 'turn.complete', 'agent.spawn', 'ui.render', 'prompt.autocomplete'];
const READ_ONLY_BAND_ARGV = ['status --json', 'debt list --json', 'backlog list --json', 'fix list --json'];

// ── switches all off ────────────────────────────────────────────────────────

test('with every switch off, every registered handler passes the event through untouched', async () => {
  const eng = await boot(answer(switches()));
  const names = eng.hooks.map((h) => h.name);
  assert.ok(names.includes('session.start') && names.includes('tool.check'), `registered: ${names}`);
  assert.ok(['command.run', 'prompt.submit', 'tool.call'].every((n) => names.includes(n)), `witness registers command.run, prompt.submit and tool.call (phase 41): ${names}`);
  assert.deepEqual(names.slice(0, 1 + BRIEF_HOOKS.length), ['session.start', ...BRIEF_HOOKS], `brief-section registers its hooks right after session.start (phase 42): ${names}`);
  assert.ok(names.every((n) => ['session.start', ...BRIEF_HOOKS, 'tool.check', 'agent.spawn', 'command.run', 'prompt.submit', 'tool.call', ...BAND_HOOKS].includes(n)), `an unexpected hook: ${names}`);
 assert.ok(BAND_HOOKS.every((n) => names.includes(n)), `phase-band registers ${BAND_HOOKS} (phase 43): ${names}`);
 for (const n of ['session.start', 'agent.spawn']) {
  const mine = eng.hooks.filter((h) => h.name === n);
  assert.equal(mine.filter((h) => !h.matcher).length, 1, `${n}: exactly one unmatched hook (a second is refused by the validator)`);
}
 assert.deepEqual(eng.hooks.find((h) => h.name === 'ui.render').matcher, { component: 'AbovePrompt' });
  assert.ok(eng.hooks.every((h) => typeof h.catchHandler === 'function'), 'every hook has a fail-open .catch');
  const EVENTS = {
    'session.start': { ...SESSION_START },
    'tool.check': { tool: 'Read', input: { file_path: '/work/proj/.astrocode/phases/39-x/PLAN.md' }, tool_use_id: 'toolu_1', agentId: 'a1' },
    'agent.spawn': { subagentType: 'astro-verifier', prompt: 'p', tool_use_id: 'toolu_2' },
    'command.run': { command: 'astro-accept', args: '41', origin: { kind: 'composer' } },
    'prompt.submit': { text: '/astro-accept 41', origin: { kind: 'composer' } },
    'tool.call': { tool: 'Bash', command: 'ac phase accept 41', tool_use_id: 'toolu_3' },
    'turn.complete': { answer: 'a', reason: 'answer' },
    'classic.SessionStart': { source: 'startup', cwd: '/work/proj' },
    'prompt.compose': {},
    'session.append': { door: 'command', message: { content: [{ type: 'text', text: 'x' }] } },
  };
  for (const rec of eng.hooks) {
    const sentinel = { sentinel: rec.name };
    assert.equal(await eng.invoke(rec.name, EVENTS[rec.name], { beneath: sentinel }), sentinel, `${rec.name} resolves to next(e)'s value`);
  }
  assert.equal(await eng.invoke('tool.check', EVENTS['tool.check']), BENEATH);
  assert.deepEqual(eng.toasts, []);
});

// phase 44: live-capture's four hooks. session.start carries a matcher (one unmatched per plugin, F22).
test('live-capture registers session.start (matched), command.run, prompt.submit and turn.complete', async () => {
  const eng = await boot(answer(switches()));
  const count = (n) => eng.hooks.filter((h) => h.name === n).length;
  assert.equal(count('session.start'), 3, 'the switch reader, phase-band, live-capture');
  assert.equal(count('command.run'), 2, 'witness, live-capture');
  assert.equal(count('prompt.submit'), 3, 'witness, live-capture, phase-band (task notifications)');
  assert.equal(count('turn.complete'), 2, 'phase-band, live-capture');
  for (const n of ['session.start', 'command.run', 'prompt.submit', 'turn.complete']) {
    assert.equal(eng.hooks.filter((h) => h.name === n && !h.matcher).length, 1, `${n}: one unmatched hook only (F22)`);
  }
  const submits = eng.hooks.filter((h) => h.name === 'prompt.submit').map((h) => h.matcher);
  assert.ok(submits.some((m) => m && m.origin && m.origin.kind === 'composer'), 'live-capture sees composer prompts only');
  assert.ok(submits.some((m) => m && m.origin && m.origin.kind === 'task-notification'), 'phase-band sees task notifications only');
});

test('with every switch off, live-capture touches no $ and toasts nothing', async () => {
  const live = await import('../mods/astro-mods/hooks/features/live-capture.js');
  const { resetSwitches } = await import('../mods/astro-mods/hooks/lib/switches.js');
  resetSwitches();
  const untouchable = new Proxy({}, { get() { throw new Error('$ was touched'); } });
  const next = (x) => x;
  const events = [
    [live.liveSessionStart, { ...SESSION_START, isInteractive: true }],
    [live.liveCommandRun, { command: 'astro-status', args: '', origin: { kind: 'composer' } }],
    [live.livePromptSubmit, { text: 'x', wait: false, origin: { kind: 'composer' } }],
    [live.liveTurnComplete, { answer: 'a', reason: 'answer' }],
  ];
  for (const [hook, e] of events) assert.equal(await hook(untouchable, e, next), e);
  await live.liveSettled();
});

test('session.start reads the switches through ac, with argv exactly and a timeout under the hook budget', async () => {
  const eng = await boot(answer(switches()));
  await eng.invoke('session.start', { ...SESSION_START });
  assert.equal(eng.runs.length, 1);
  assert.deepEqual(eng.runs[0].argv, ARGV);
  assert.ok(eng.runs[0].init.timeoutMs > 0 && eng.runs[0].init.timeoutMs <= 8000, 'stays under the session.start budget');
});

test('a switch that is on is read, and session.start still passes through', async () => {
  const eng = await boot(answer(switches({ blindfold: true, witness: true })));
  const e = { ...SESSION_START };
  assert.equal(await eng.invoke('session.start', e), e);
  assert.deepEqual(eng.toasts, []);
  const { isOn } = await import('../mods/astro-mods/hooks/lib/switches.js');
  assert.equal(isOn('blindfold'), true);
  assert.equal(isOn('witness'), true);
  assert.equal(isOn('spawn-policy'), false);
});

test('the plugin keeps no state of its own: what ac says on the next session.start is what it sees', async () => {
  const { isOn } = await import('../mods/astro-mods/hooks/lib/switches.js');
  const one = await boot(answer(switches({ blindfold: true })));
  await one.invoke('session.start', { ...SESSION_START });
  assert.equal(isOn('blindfold'), true);
  const two = await boot(answer(switches({ blindfold: false })));
  await two.invoke('session.start', { ...SESSION_START });
  assert.equal(isOn('blindfold'), false);
});

// ── ac missing, broken, or slow: pass through, tell the user ONCE ───────────

const FAILURES = {
  'ac is missing (the command cannot start)': async () => { throw new Error('spawn ac ENOENT'); },
  'ac exits 1': async () => ({ exitCode: 1, stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false }),
  'ac prints something that is not JSON': async () => ({ exitCode: 0, stdout: 'not json', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }),
  'ac never answers (process.run rejects at its timeout)': () => new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 20)),
  'ac prints JSON of the wrong shape': answer({ nope: true }),
};
for (const [label, impl] of Object.entries(FAILURES)) {
  test(`when ${label}: pass-through within a bound, no escaping rejection, exactly one toast across invocations, every mod off`, async () => {
    const eng = await boot(impl);
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) {
      const e = { ...SESSION_START };
      assert.equal(await eng.invoke('session.start', e), e, `invocation ${i + 1} passes the event through`);
    }
    assert.ok(Date.now() - t0 < 2000, 'bounded time');
    assert.equal(eng.toasts.length, 1, `exactly one notice, got ${JSON.stringify(eng.toasts)}`);
    assert.match(eng.toasts[0], /astro-mods/);
    assert.match(eng.toasts[0], /letting the action through/);
    const { isOn } = await import('../mods/astro-mods/hooks/lib/switches.js');
    assert.ok(NAMES.every((n) => isOn(n) === false), 'a failed session.start leaves every switch off');
  });
}

test('a toast that throws (no UI under -p) never escapes', async () => {
  const eng = await boot(FAILURES['ac exits 1'], { toastThrows: true });
  const e = { ...SESSION_START };
  assert.equal(await eng.invoke('session.start', e), e);
  assert.equal(eng.toasts.length, 1);
});

// ── the plugin reads no event field PROBE.md has not observed ───────────────

function sources(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.js$/.test(f) ? [p] : [];
  });
}

test('no module reads an event field the PROBE.md files do not record as observed', () => {
  const probe = PROBE_MDS.map((f) => readFileSync(f, 'utf8')).join('\n');
  for (const file of sources(HOOKS)) {
    const text = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, field] of text.matchAll(/\be\.(\w+)/g)) {
      assert.ok(probe.includes(`\`${field}\``), `${file} reads e.${field}, which PROBE.md does not list`);
    }
    assert.ok(!/\be\[/.test(text), `${file} reads an event field by computed key`);
  }
});

// ── Claude Code's own checks, when a qualifying claude is on PATH ───────────

// fix 2026-11-16-astro-mods-hooks-run-bare-ac-which: the argvs spread lib/ac.js's AC (`[...AC, 'status', …]`), never a bare 'ac'.
test('phase-band source: no submit, run, tool or state write; every ac argv is a read-only query (C3)', () => {
 const raw = readFileSync(join(HOOKS, 'features', 'phase-band.js'), 'utf8');
 for (const forbidden of ['prompt.submit', 'command.run', '$.tool', '$.state.set', '$.state.']) {
  assert.ok(!raw.includes(forbidden), `phase-band.js mentions ${forbidden}`);
}
 const argvs = [...raw.matchAll(/\[\s*\.\.\.AC\s*,([^\]]*)\]/g)].map((m) => [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]).join(' '));
 assert.ok(argvs.length >= READ_ONLY_BAND_ARGV.length, `found ${argvs.length} ac argv literals`);
 for (const a of argvs) assert.ok(READ_ONLY_BAND_ARGV.includes(a), `ac ${a} is not a read-only band query`);
 for (const a of READ_ONLY_BAND_ARGV) assert.ok(argvs.includes(a), `missing ac ${a}`);
 assert.ok(!/\.fs\.write|\$\.env\.set|ui\.toast/.test(raw), 'the band writes no file and raises no toast');
});
function claudeAtFloor() {
  const r = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return 'no claude on PATH';
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(r.stdout);
  if (!m) return 'unreadable claude version';
  const [a, b, c] = m.slice(1).map(Number);
  return a > 2 || (a === 2 && (b > 1 || (b === 1 && c >= 292))) ? false : `claude ${m[0]} < 2.1.292`;
}
const SKIP = claudeAtFloor();
const live = (args) => {
  const T = mkdtempSync(join(tmpdir(), 'ac-modsplug-'));
  return spawnSync('claude', args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: T, CLAUDE_CONFIG_DIR: join(T, 'cfg') } });
};

for (const target of ['mods', 'mods/astro-mods', 'scripts/mods-probe']) {
  test(`claude plugin validate --strict ${target} passes`, { skip: SKIP }, () => {
    const r = live(['plugin', 'validate', '--strict', join(ROOT, target)]);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  });
}

test('claude plugin test mods/astro-mods passes', { skip: SKIP }, () => {
  const r = live(['plugin', 'test', PLUGIN]);
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

// ── witness (phase 41, ADR-074): who started the turn, and the gate calls it makes ──────────────
// `next` on tool.call is the identity here, so what `invoke` returns is exactly what the engine
// below would have received. features/witness.js is reached only through register.js and
// `await import`, so a missing module fails each test on its own (ADR-018).

const P41 = PROBE_MDS[2];
const HUMAN = '<!-- astro-discuss: captured -->';
const run = (command, args, kind = 'composer') => ({ name: 'command.run', e: { command, args, origin: { kind } } });
const submit = (text, kind = 'composer') => ({ name: 'prompt.submit', e: { text, origin: { kind } } });
const bash = (command, extra = {}) => ({ tool: 'Bash', command, description: 'd', tool_use_id: 'toolu_b', ...extra });
const CTX = '/p/.astrocode/phases/41-x/CONTEXT.md';
const write = (content, file_path = CTX) => ({ tool: 'Write', file_path, content, tool_use_id: 'toolu_w' });
const edit = (new_string, file_path = CTX) => ({ tool: 'Edit', file_path, old_string: 'x', new_string, replace_all: false, tool_use_id: 'toolu_e' });

const typedAccept = (n) => [run('astro-accept', String(n)), submit(`/astro-accept ${n}`)];
const typedFixAccept = (f) => [run('astro-fix-accept', f), submit(`/astro-fix-accept ${f}`)];
const typedDiscuss = (n) => [run('astro-discuss', String(n)), submit(`/astro-discuss ${n}`)];
// a prompt the engine delivers INTO the running turn carries that turn's id
const midTurn = (text, kind = 'task-notification') => ({ name: 'prompt.submit', e: { text, origin: { kind }, turnId: 'turn-1' } });

async function armed(over = { witness: true }) {
  const eng = await boot(answer(switches(over)));
  await eng.invoke('session.start', { ...SESSION_START });
  return eng;
}
/** Fire each prompt-side event, then the tool.call; return what reached the engine below. */
async function turnThen(eng, events, call) {
  for (const ev of events) await eng.invoke(ev.name, ev.e);
  return eng.invoke('tool.call', call);
}

const W = ' --witnessed composer';
const A = ' --agent claude';
// [label, prompt events, tool.call, expected command (Bash) or [field, expected] (Write/Edit), toast on]
// expected `null` means byte-identical.
const AGENT_RE = /agent/;
const BASH = [
  ['C1 slash form, numeric ref', typedAccept(41), bash('ac phase accept 41'), `ac phase accept 41${W}`, null],
  ['C1 slash form, slug ref', typedAccept(41), bash('ac phase accept 41-witness-x'), `ac phase accept 41-witness-x${W}`, null],
  ['C1 bang form', [submit('! ac phase accept 41')], bash('ac phase accept 41'), `ac phase accept 41${W}`, null],
  ['C2a composer astro-autonomous', [run('astro-autonomous', ''), submit('/astro-autonomous')], bash('ac phase accept 41'), `ac phase accept 41${A}`, AGENT_RE],
  ['C2b sdk astro-accept', [run('astro-accept', '41', 'sdk'), submit('/astro-accept 41', 'sdk')], bash('ac phase accept 41'), `ac phase accept 41${A}`, AGENT_RE],
  ['C2c typed then task-notification', [...typedAccept(41), submit('<task-notification>done</task-notification>', 'task-notification')], bash('ac phase accept 41'), `ac phase accept 41${A}`, AGENT_RE],
  // a notification delivered INTO the typed turn does not start a turn: the typed accept stands
  ['C1 typed, then a task-notification delivered into the running turn', [...typedAccept(41), midTurn('<task-notification>done</task-notification>')], bash('ac phase accept 41'), `ac phase accept 41${W}`, null],
  ['C2 sdk turn stays agent after a delivery into it', [run('astro-accept', '41', 'sdk'), submit('/astro-accept 41', 'sdk'), midTurn('hi', 'composer')], bash('ac phase accept 41'), `ac phase accept 41${A}`, AGENT_RE],
  ['C2d typed for another phase', typedAccept(40), bash('ac phase accept 41'), `ac phase accept 41${A}`, AGENT_RE],
  ['C2e plugin origin', [run('astro-accept', '41', 'plugin'), submit('/astro-accept 41', 'plugin')], bash('ac phase accept 41'), `ac phase accept 41${A}`, AGENT_RE],
  ['C2 subagent call after a typed accept', typedAccept(41), bash('ac phase accept 41', { agentId: 'a1' }), `ac phase accept 41${A}`, AGENT_RE],
  ['C2 model-supplied --witnessed in an sdk turn', [run('astro-accept', '41', 'sdk'), submit('/astro-accept 41', 'sdk')], bash('ac phase accept 41 --witnessed composer'), `ac phase accept 41${A}`, AGENT_RE],
  ['C3 reject after typed accept', typedAccept(41), bash('ac phase reject 41 --reason x'), `ac phase reject 41${W} --reason x`, null],
  ['C3 reject after typed accept of another phase', typedAccept(40), bash('ac phase reject 41 --reason x'), `ac phase reject 41${A} --reason x`, AGENT_RE],
  ['C3 fix accept after typed fix-accept of the exact id', typedFixAccept('2026-10-11-foo'), bash('ac fix accept 2026-10-11-foo'), `ac fix accept 2026-10-11-foo${W}`, null],
  // the documented slug form: the agent runs it with its date; a longer slug is another fix (phase 41 verify C3)
  ['C3 fix accept after a typed bare slug', typedFixAccept('foo'), bash('ac fix accept 2026-10-11-foo'), `ac fix accept 2026-10-11-foo${W}`, null],
  ['C3 fix accept of a longer slug after a typed bare slug', typedFixAccept('foo'), bash('ac fix accept 2026-10-11-other-foo'), `ac fix accept 2026-10-11-other-foo${A}`, AGENT_RE],
  ['C3 fix accept after bang', [submit('! ac fix accept 2026-10-11-foo')], bash('ac fix accept 2026-10-11-foo'), `ac fix accept 2026-10-11-foo${W}`, null],
  ['C3 fix accept after another fix id', typedFixAccept('bar'), bash('ac fix accept 2026-10-11-foo'), `ac fix accept 2026-10-11-foo${A}`, AGENT_RE],
  ['C3 fix accept after typed phase accept', typedAccept(41), bash('ac fix accept 2026-10-11-foo'), `ac fix accept 2026-10-11-foo${A}`, AGENT_RE],
];
const IDENTICAL = [
  ['C4 declared --agent, sdk turn', [run('astro-accept', '41', 'sdk'), submit('/astro-accept 41', 'sdk')], bash('ac phase accept 41 --agent bot')],
  ['C4 declared --agent after typed accept', typedAccept(41), bash('ac phase accept 41 --agent bot')],
  ['C5 ambiguous bash -c', typedAccept(41), bash("bash -c 'ac phase accept 41'")],
  ['C5 no gate in the command', typedAccept(41), bash('ls -la')],
  // a gate named only inside quoted text nothing runs is a mention, left as written
  ['mention: echo of a quoted gate, sdk turn', [run('astro-accept', '41', 'sdk'), submit('/astro-accept 41', 'sdk')], bash('echo "search for: phase accept 12"')],
  ['mention: grep pattern', [submit('hi')], bash('grep -rn -E "phase accept|fix accept" docs | head')],
  ['mention: commit message', [submit('hi')], bash('git commit -m "chore(41): after ac phase accept 41"')],
];
const FILES = [
  ['C6a Write after typed discuss', typedDiscuss(41), write(`${HUMAN}\nbody\n`), null],
  ['C6a Edit after typed discuss', typedDiscuss(41), edit(`${HUMAN}\nbody`), null],
  // astro-forge 223: a background run finished mid-discussion; the human's CONTEXT.md stays human
  ['C6a Write after typed discuss and a notification delivered into the turn', [...typedDiscuss(41), midTurn('<task-notification>plan done</task-notification>')], write(`${HUMAN}\nbody\n`), null],
  ['C6b Write after discuss of another phase', typedDiscuss(40), write(`${HUMAN}\nbody\n`), 'content'],
  ['C6b Write after composer astro-autonomous', [run('astro-autonomous', ''), submit('/astro-autonomous')], write(`${HUMAN}\nbody\n`), 'content'],
  ['C6b Write in an sdk turn', [run('astro-discuss', '41', 'sdk'), submit('/astro-discuss 41', 'sdk')], write(`${HUMAN}\nbody\n`), 'content'],
];

for (const [label, events, call, want, toast] of BASH) {
  test(`witness on: ${label}`, async () => {
    const eng = await armed();
    const out = await turnThen(eng, events, call);
    assert.equal(out.command, want);
    assert.ok(!(/--agent/.test(out.command) && /--witnessed/.test(out.command)), 'never both');
    assert.equal(out.deny, undefined, 'never a deny');
    assert.equal(eng.toasts.length, toast ? 1 : 0, `toasts: ${JSON.stringify(eng.toasts)}`);
    if (toast) assert.match(eng.toasts[0], toast);
  });
}

for (const [label, events, call] of IDENTICAL) {
  test(`witness on: ${label} is byte-identical`, async () => {
    const eng = await armed();
    const out = await turnThen(eng, events, call);
    assert.deepEqual(out, call);
    assert.equal(out.command, call.command);
  });
}

test('C4 witness off: every C1-C3 and C6 scenario is byte-identical and silent', async () => {
  for (const [label, events, call] of [...BASH, ...FILES].map(([l, ev, c]) => [l, ev, c])) {
    const eng = await armed({ witness: false });
    const out = await turnThen(eng, events, call);
    assert.equal(out, call, `${label}: the very event, untouched`);
    assert.deepEqual(eng.toasts, [], label);
  }
});

test('C5 no prompt event after session.start: gate calls and a marker Write are byte-identical, one toast across them', async () => {
  const eng = await armed();
  for (const call of [bash('ac phase accept 41'), bash('ac fix accept foo'), write(`${HUMAN}\nbody\n`)]) {
    assert.deepEqual(await eng.invoke('tool.call', call), call);
  }
  assert.equal(eng.toasts.length, 1, JSON.stringify(eng.toasts));
  assert.match(eng.toasts[0], /could not tell/);
});

test('C5 a reload (session.start) loses the turn: the next gate call is byte-identical', async () => {
  const eng = await armed();
  for (const ev of typedAccept(41)) await eng.invoke(ev.name, ev.e);
  await eng.invoke('session.start', { ...SESSION_START });
  const call = bash('ac phase accept 41');
  assert.deepEqual(await eng.invoke('tool.call', call), call);
});

test('C5 malformed events never reject and pass through', async () => {
  const eng = await armed();
  for (const ev of typedAccept(41)) await eng.invoke(ev.name, ev.e);
  const bad = bash(42);
  assert.equal(await eng.invoke('tool.call', bad), bad);
  const noOrigin = { text: '/astro-accept 41' };
  assert.equal(await eng.invoke('prompt.submit', noOrigin), noOrigin);
  const call = bash('ac phase accept 41');
  assert.equal((await eng.invoke('tool.call', call)).command, 'ac phase accept 41', 'a missing origin makes the turn unknown');
});

test('C5 an empty-arg composer astro-accept leaves the call as declared and says it could not tell', async () => {
  const eng = await armed();
  const call = bash('ac phase accept 41');
  const out = await turnThen(eng, [run('astro-accept', ''), submit('/astro-accept')], call);
  assert.deepEqual(out, call);
  assert.equal(eng.toasts.length, 1);
  assert.match(eng.toasts[0], /could not tell/);
});

for (const [label, events, call, field] of FILES) {
  test(`witness on: ${label}`, async () => {
    const eng = await armed();
    const { AGENT_MARKER } = await import('../mods/astro-mods/hooks/lib/gates.js');
    const out = await turnThen(eng, events, call);
    if (field === null) {
      assert.deepEqual(out, call);
      assert.deepEqual(eng.toasts, []);
      return;
    }
    assert.equal(out[field], call[field].replace(HUMAN, AGENT_MARKER), 'line 1 only');
    assert.equal(out.file_path, call.file_path);
    assert.equal(eng.toasts.length, 1);
  });
}

// An Edit is judged by where its text lands in the file (phase 41 verify, C6): the engine reads the
// file, so these scenarios give it one.
test('C6b an Edit that makes line 1 the human marker becomes the agent marker; one landing on line 2 is left alone', async () => {
  const { AGENT_MARKER } = await import('../mods/astro-mods/hooks/lib/gates.js');
  const eng = await armed();
  eng.setRead(() => 'x\nbody\n');
  const line1 = await turnThen(eng, typedDiscuss(40), edit(`${HUMAN}`));
  assert.equal(line1.old_string, 'x\nbody\n');
  assert.equal(line1.new_string, `${AGENT_MARKER}\nbody\n`);
  const eng2 = await armed();
  eng2.setRead(() => '# Title\nbody\n');
  const line2 = { ...edit(`${HUMAN}\nbody`), old_string: 'body' };
  assert.deepEqual(await turnThen(eng2, typedDiscuss(40), line2), line2, 'a marker landing on line 2 is prose (C6 d)');
});

test('C6c/d an agent-form marker, another file, or an Edit marker on line 3 is unchanged in every turn', async () => {
  const { AGENT_MARKER } = await import('../mods/astro-mods/hooks/lib/gates.js');
  const calls = [
    write(`${AGENT_MARKER}\nbody\n`),
    edit(`${AGENT_MARKER}\nbody`),
    write(`${HUMAN}\nbody\n`, '/p/notes/CONTEXT.md'),
    edit(`# t\n\n${HUMAN}`),
  ];
  for (const call of calls) {
    for (const events of [[run('astro-autonomous', ''), submit('/astro-autonomous')], [run('astro-discuss', '41', 'sdk'), submit('/astro-discuss 41', 'sdk')]]) {
      const eng = await armed();
      assert.deepEqual(await turnThen(eng, events, call), call);
    }
  }
});

test('C8 the UAT verdict in PROBE.md and the code agree', async () => {
  const v = /^Verdict \(decision 2\): (observable|not-observable)$/m.exec(readFileSync(P41, 'utf8'));
  assert.ok(v, 'PROBE.md carries exactly one machine-read verdict line');
  if (v[1] === 'not-observable') {
    const eng = await armed();
    const out = await turnThen(eng, typedAccept(41), bash('ac phase accept 41'));
    assert.equal(out.command, `ac phase accept 41${W}`, 'the typed command alone is the signal; no AskUserQuestion event is needed');
    const ask = { tool: 'AskUserQuestion', questions: [], tool_use_id: 'toolu_q' };
    assert.equal(await eng.invoke('tool.call', ask), ask, 'witness registers nothing for AskUserQuestion');
  } else {
    assert.fail('PROBE.md says observable: add the P7 accept/reject/absent cases from its recorded field paths');
  }
});

// ── brief-section (phase 42): one cached system-prompt section, and no second copy of the brief ──
// The engine below is the same simulator; `next` on classic.SessionStart / prompt.compose /
// session.append is whatever the test says sits beneath. Everything the feature reads comes from a
// scripted `ac` (ADR-071 c), keyed by argv; an argv outside the three brief-section shapes throws.
// The feature module is reached only through register.js (ADR-018). A `turn.start` hook is NOT
// required (PROBE.md F18: compose runs before turn.start in -p, so position is read at compose);
// the tests fire it anyway, so a feature that does register one is exercised too.

const BRIEF_ARGV = ['ac', 'principles', 'brief', '--stage', 'session', '--by', 'session'];
const FEED_ARGV = ['ac', 'mods', 'feed', 'brief-section'];
const POS_ARGV = [...FEED_ARGV, '--position'];
const key = (argv) => argv.join(' ');
const BRIEF = 'HARD RULES\n- RULE one\n- RULE two\n\nIN SCOPE\n- RULE three';
const PARTS = ['SESSION BRIEF part 1\n- RULE one', 'SESSION BRIEF part 2\n- RULE two'];
const POS1 = 'proj · M1 · Phase 42 executing · Next: /astro-verify 42';
const POS2 = 'proj · M1 · Phase 42 verified · Next: /astro-accept 42';
const okRun = (stdout) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false });
const CORE = [{ id: 'lean_body', text: 'core', scope: 'shared' }, { id: 'env_info_simple', text: 'env', scope: 'session' }];

/** A scripted ac. `s` is live state: a test edits it between turns to move the project. */
function acStub(over = {}) {
  const s = { position: POS1, serve: true, parts: PARTS, brief: `${BRIEF}\n`, briefMode: 'ok', switchOn: true, others: {}, ...over };
  const impl = async (argv) => {
    const k = key(argv);
    if (k === key(ARGV)) return okRun(JSON.stringify(switches({ ...s.others, 'brief-section': s.switchOn })));
    if (k === key(BRIEF_ARGV)) {
      if (s.briefMode === 'enoent') throw new Error('spawn ac ENOENT');
      if (s.briefMode === 'exit1') return { ...okRun(''), exitCode: 1, stderr: 'boom' };
      if (s.briefMode === 'empty') return okRun('');
      if (s.briefMode === 'timeout') return new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 20));
      return okRun(s.brief);
    }
    if (k === key(FEED_ARGV)) return okRun(JSON.stringify({ serve: s.serve, parts: s.parts, position: s.position }));
    if (k === key(POS_ARGV)) return okRun(JSON.stringify({ position: s.position }));
    throw new Error(`unscripted argv: ${k}`);
  };
  impl.s = s;
  return impl;
}
const countRuns = (eng, argv) => eng.runs.filter((r) => key(r.argv) === key(argv)).length;
const sessionOf = async (stub, opts) => {
  const eng = await boot(stub, opts);
  await eng.invoke('session.start', { ...SESSION_START });
  return eng;
};
const composeOf = (eng, sections = CORE) => eng.invoke('prompt.compose', {}, { beneath: { sections: sections.map((x) => ({ ...x })) } });
const hookOut = (eng, entries, source = 'startup') => eng.invoke('classic.SessionStart', { source, cwd: SESSION_START.cwd }, { beneath: { additionalContext: [...entries] } });
const preCompactRow = (position, order = 'astro-first') => {
  const astro = `PreCompact ["/usr/bin/node" "/h/hooks/astro-precompact.mjs"] completed successfully: ${JSON.stringify({ systemMessage: position })}`;
  const foreign = 'PreCompact ["/usr/bin/node" "/x/foreign.mjs"] completed successfully: {"systemMessage":"FOREIGN-PC"}';
  const text = `<local-command-stdout>Compacted ${order === 'astro-first' ? `${astro}\n${foreign}` : `${foreign}\n${astro}`}</local-command-stdout>`;
  return { astro, foreign, e: { door: 'command', message: { role: 'user', content: [{ type: 'text', text }] } } };
};
const rowText = (out) => out.message.content.map((b) => b.text).join('');
const FOREIGN = ['a foreign hook says: - RULE one', 'unrelated context'];

test('brief-section on: one astro-mods:brief section, session scope, appended last, text = BRIEF + position; core sections unchanged', async () => {
  const eng = await sessionOf(acStub());
  const out = await composeOf(eng);
  assert.deepEqual(out.sections.slice(0, CORE.length), CORE);
  assert.equal(out.sections.length, CORE.length + 1);
  const mine = out.sections.filter((x) => x.id === 'astro-mods:brief');
  assert.equal(mine.length, 1, 'exactly one');
  assert.equal(out.sections.at(-1), mine[0], 'appended last');
  assert.equal(mine[0].scope, 'session');
  assert.equal(mine[0].text, `${BRIEF}\n\n${POS1}`, 'BRIEF trimmed like the hooks trim it, then one position line');
});

test('brief-section on: an empty position leaves the section BRIEF alone', async () => {
  const eng = await sessionOf(acStub({ position: '' }));
  assert.equal((await composeOf(eng)).sections.at(-1).text, BRIEF);
});

test('brief-section on: five turns give the identical string and the brief ran once; a changed position changes only the last line', async () => {
  const stub = acStub();
  const eng = await sessionOf(stub);
  const texts = [];
  for (let i = 0; i < 5; i++) {
    await eng.invoke('turn.start', { cwd: SESSION_START.cwd });
    texts.push((await composeOf(eng)).sections.at(-1).text);
  }
  assert.ok(texts.every((t) => t === texts[0]), 'byte-identical on every turn (===), or the prompt cache breaks each turn');
  assert.equal(countRuns(eng, BRIEF_ARGV), 1, 'the brief ran once per session');
  stub.s.position = POS2;
  await eng.invoke('turn.start', { cwd: SESSION_START.cwd });
  assert.equal((await composeOf(eng)).sections.at(-1).text, `${BRIEF}\n\n${POS2}`);
  assert.equal(countRuns(eng, BRIEF_ARGV), 1, 'a state change never re-runs the brief');
});

test('brief-section on: ac is read through the scripted argv shapes only, in the session cwd, inside the hook budget', async () => {
  const eng = await sessionOf(acStub());
  await composeOf(eng);
  await hookOut(eng, PARTS);
  await eng.invoke('session.append', preCompactRow(POS1).e);
  const allowed = [ARGV, BRIEF_ARGV, FEED_ARGV, POS_ARGV].map(key);
  assert.ok(eng.runs.every((r) => allowed.includes(key(r.argv))), `argv: ${eng.runs.map((r) => key(r.argv))}`);
  const { SWITCHES_TIMEOUT_MS } = await import('../mods/astro-mods/hooks/lib/switches.js');
  const mine = eng.runs.filter((r) => [BRIEF_ARGV, FEED_ARGV].map(key).includes(key(r.argv)));
  assert.ok(mine.length >= 2 && mine.every((r) => r.init.cwd === SESSION_START.cwd && r.init.timeoutMs > 0));
  assert.ok(SWITCHES_TIMEOUT_MS + mine.slice(0, 2).reduce((n, r) => n + r.init.timeoutMs, 0) <= 9000, 'session.start stays 1 s under its 10 s budget');
});

for (const source of ['startup', 'clear', 'compact']) {
  test(`brief-section on, SessionStart (${source}): entries equal to the parts are dropped, a foreign entry quoting a BRIEF line is kept, order preserved`, async () => {
    const eng = await sessionOf(acStub());
    const out = await hookOut(eng, [FOREIGN[0], PARTS[0], FOREIGN[1], PARTS[1]], source);
    assert.deepEqual(out.additionalContext, [FOREIGN[0], FOREIGN[1]]);
    const near = [`${PARTS[0]} x`, PARTS[0].slice(0, -1)];
    assert.deepEqual((await hookOut(eng, near, source)).additionalContext, near, 'exact match only, never prefix or similarity');
  });
}

test('brief-section on, PreCompact: the astro segment is dropped from the command row, the foreign one is kept', async () => {
  const stub = acStub();
  const eng = await sessionOf(stub);
  stub.s.position = POS2; // the row carries the position as it is NOW; the match re-reads it first
  for (const order of ['astro-first', 'astro-last']) {
    const row = preCompactRow(POS2, order);
    const text = rowText(await eng.invoke('session.append', row.e));
    assert.ok(!text.includes(row.astro), `${order}: astro segment gone`);
    assert.ok(text.includes(row.foreign), `${order}: foreign kept byte-identical`);
    assert.ok(text.startsWith('<local-command-stdout>') && text.endsWith('</local-command-stdout>'), 'the wrapper survives');
  }
  const foreignOnly = { door: 'command', message: { role: 'user', content: [{ type: 'text', text: `<local-command-stdout>Compacted ${preCompactRow(POS2).foreign}</local-command-stdout>` }] } };
  assert.equal(await eng.invoke('session.append', foreignOnly), foreignOnly, 'a foreign-only row is the very event');
  const other = { door: 'user', message: { role: 'user', content: [{ type: 'text', text: preCompactRow(POS2).astro }] } };
  assert.equal(await eng.invoke('session.append', other), other, 'only the command door is touched');
});

const FAIL_MODES = {
  'ac is missing (ENOENT)': 'enoent',
  'the brief exits 1': 'exit1',
  'the brief prints nothing': 'empty',
  'the brief call rejects at its timeout': 'timeout',
};
for (const [label, briefMode] of Object.entries(FAIL_MODES)) {
  test(`fail open, ${label}: bounded, no section, nothing dropped, one notice across turns and events, other mods untouched`, async () => {
    const eng = await boot(acStub({ briefMode, others: { blindfold: true } }));
    const t0 = Date.now();
    const e = { ...SESSION_START };
    assert.equal(await eng.invoke('session.start', e), e);
    assert.ok(Date.now() - t0 < 2000, 'bounded');
    for (let i = 0; i < 3; i++) {
      assert.deepEqual((await composeOf(eng)).sections, CORE, 'no section');
      await eng.invoke('turn.start', { cwd: SESSION_START.cwd });
    }
    assert.deepEqual((await hookOut(eng, [...PARTS, FOREIGN[0]])).additionalContext, [...PARTS, FOREIGN[0]], 'the hooks deliver the brief as today');
    const row = preCompactRow(POS1).e;
    assert.equal(await eng.invoke('session.append', row), row);
    assert.equal(eng.toasts.length, 1, `one notice, got ${JSON.stringify(eng.toasts)}`);
    assert.match(eng.toasts[0], /brief-section/);
    const { isOn } = await import('../mods/astro-mods/hooks/lib/switches.js');
    assert.equal(isOn('blindfold'), true, 'the failure is the feature\'s own: it does not reset the other mods');
  });
}

test('serve false (not an astro-code project, or the #116 opt-out): no section, no notice, everything passes through', async () => {
  const eng = await sessionOf(acStub({ serve: false }));
  assert.deepEqual((await composeOf(eng)).sections, CORE);
  assert.deepEqual((await hookOut(eng, PARTS)).additionalContext, PARTS);
  const row = preCompactRow(POS1).e;
  assert.equal(await eng.invoke('session.append', row), row);
  assert.deepEqual(eng.toasts, []);
});

test('switch off: no section, no brief run, every hook output passes through untouched', async () => {
  const eng = await sessionOf(acStub({ switchOn: false }));
  assert.deepEqual((await composeOf(eng)).sections, CORE);
  assert.deepEqual((await hookOut(eng, PARTS)).additionalContext, PARTS);
  const row = preCompactRow(POS1).e;
  assert.equal(await eng.invoke('session.append', row), row);
  assert.equal(countRuns(eng, BRIEF_ARGV), 0);
  assert.deepEqual(eng.toasts, []);
});

test('the invariant: drop only while served. After a drop, a forced failOpen keeps the section; before any drop it removes it', async () => {
  const malformed = (eng) => eng.invoke('classic.SessionStart', { source: 'startup', cwd: SESSION_START.cwd }, { beneath: { additionalContext: 'not an array' } });
  const dropped = await sessionOf(acStub());
  assert.deepEqual((await hookOut(dropped, PARTS)).additionalContext, [], 'a part was dropped');
  await malformed(dropped);
  assert.equal((await composeOf(dropped)).sections.at(-1).id, 'astro-mods:brief', 'the model must not be left with ZERO copies');
  const fresh = await sessionOf(acStub());
  await malformed(fresh);
  assert.deepEqual((await composeOf(fresh)).sections, CORE, 'nothing of ours has passed through: reset removes the section');
  assert.deepEqual((await hookOut(fresh, PARTS)).additionalContext, PARTS, 'and later outputs pass through');
});

test('a reload (a fresh register + session.start) recomputes the brief exactly once more', async () => {
  const stub = acStub();
  const briefRuns = [];
  const spy = async (argv, init) => { if (key(argv) === key(BRIEF_ARGV)) briefRuns.push(argv); return stub(argv, init); };
  await sessionOf(spy);
  assert.equal(briefRuns.length, 1);
  const again = await sessionOf(spy);
  assert.equal(briefRuns.length, 2);
  assert.equal((await composeOf(again)).sections.at(-1).id, 'astro-mods:brief');
});

test('event order: classic.SessionStart before session.start yields section-and-drop or neither, never one without the other', async () => {
  const eng = await boot(acStub());
  const first = await hookOut(eng, PARTS);
  await eng.invoke('session.start', { ...SESSION_START });
  const droppedAny = first.additionalContext.length < PARTS.length;
  const hasSection = (await composeOf(eng)).sections.some((x) => x.id === 'astro-mods:brief');
  assert.equal(droppedAny, hasSection, `dropped=${droppedAny} section=${hasSection}`);
});

// ── phase 46 (ADR-081): machine-typed prefixes, a cold --witnessed, variable verbs, Bash marker writes ──

async function armedWith(machinePrefixes, over = { witness: true }) {
  const eng = await boot(answer({ ...switches(over), machinePrefixes }));
  await eng.invoke('session.start', { ...SESSION_START });
  return eng;
}
const PFX = ['[relay] ', '/astro-accept', '.*'];
const sdkAccept = (n) => [run('astro-accept', String(n), 'sdk'), submit(`/astro-accept ${n}`, 'sdk')];
const EV = '--evidence "https://board.example/d/42?x=1&y=2"';

test('C5a a composer prompt starting with a machine-typed prefix never unlocks a gate, leading spaces included', async () => {
  for (const text of ['[relay] /astro-accept 41', '   [relay] ! ac phase accept 41']) {
    const eng = await armedWith(PFX);
    const out = await turnThen(eng, [submit(text)], bash('ac phase accept 41'));
    assert.equal(out.command, `ac phase accept 41${A}`, text);
    assert.doesNotMatch(out.command, /--witnessed/);
  }
});

test('C5b a typed slash command matching a prefix is a machine turn: the gate is agent-signed, the marker is the agent marker', async () => {
  const { AGENT_MARKER } = await import('../mods/astro-mods/hooks/lib/gates.js');
  const eng = await armedWith(PFX);
  const out = await turnThen(eng, typedAccept(41), bash('ac phase accept 41'));
  assert.equal(out.command, `ac phase accept 41${A}`);
  const eng2 = await armedWith(['/astro-discuss']);
  const w = await turnThen(eng2, typedDiscuss(41), write(`${HUMAN}\nbody\n`));
  assert.equal(w.content, `${AGENT_MARKER}\nbody\n`);
});

test('C5c controls: a narrower list, a different case, a mid-text prefix and a .* entry leave a typed accept witnessed', async () => {
  const cases = [
    [['[relay] '], typedAccept(41)],
    [['[relay] '], [submit('[RELAY] /astro-accept 41'), ...[]]],
    [['[relay] '], [run('astro-accept', '41'), submit('hi [relay] /astro-accept 41')]],
    [['.*'], typedAccept(41)],
  ];
  const eng0 = await armedWith(['[relay] ']);
  assert.equal((await turnThen(eng0, typedAccept(41), bash('ac phase accept 41'))).command, `ac phase accept 41${W}`);
  for (const [list, events] of cases.slice(1)) {
    const eng = await armedWith(list);
    const out = await turnThen(eng, events, bash('ac phase accept 41'));
    if (events === cases[1][1]) assert.equal(out.command, `ac phase accept 41${A}`, 'a non-gate composer turn is still the agent');
    else assert.equal(out.command, `ac phase accept 41${W}`);
  }
});

test('C6 a missing or malformed prefix list changes nothing: typed accept witnessed, sdk accept agent, no hook throws, no toast', async () => {
  for (const bad of [undefined, 'x', [1], ['ok', 2], {}]) {
    const eng = await armedWith(bad);
    assert.equal((await turnThen(eng, typedAccept(41), bash('ac phase accept 41'))).command, `ac phase accept 41${W}`);
    assert.equal((await turnThen(eng, sdkAccept(41), bash('ac phase accept 41'))).command, `ac phase accept 41${A}`);
    assert.deepEqual(eng.toasts.filter((t) => /prefix/i.test(t)), []);
  }
});

test('C4 a citation never earns --witnessed and is left byte-identical by every rewrite', async () => {
  const call = bash(`ac phase accept 41 ${EV}`);
  const eng = await armed();
  assert.equal((await turnThen(eng, typedAccept(41), call)).command, `ac phase accept 41${W} ${EV}`);
  for (const events of [sdkAccept(41), [submit('hi')]]) {
    const e2 = await armed();
    const out = await turnThen(e2, events, call);
    assert.equal(out.command, `ac phase accept 41${A} ${EV}`);
    assert.doesNotMatch(out.command, /--witnessed/);
  }
  const fix = bash('ac fix accept 2026-10-01-foo --evidence "DEC-1"');
  const e3 = await armed();
  assert.equal((await turnThen(e3, typedFixAccept('2026-10-01-foo'), fix)).command, `ac fix accept 2026-10-01-foo${W} --evidence "DEC-1"`);
  const e4 = await armed();
  assert.equal((await turnThen(e4, [submit('hi')], fix)).command, `ac fix accept 2026-10-01-foo${A} --evidence "DEC-1"`);
});

test('C9 a cold --witnessed is dropped, never denied, with one undetermined toast', async () => {
  const eng = await armed();
  const wants = [
    ['ac phase accept 41 --witnessed composer', 'ac phase accept 41'],
    ['ac phase reject 41 --witnessed composer --reason x', 'ac phase reject 41 --reason x'],
    ['ac fix accept 2026-10-01-foo --witnessed composer', 'ac fix accept 2026-10-01-foo'],
    ['bash -c "ac phase accept 41 --witnessed composer"', 'bash -c "ac phase accept 41"'],
  ];
  for (const [cmd, want] of wants) {
    const out = await eng.invoke('tool.call', bash(cmd));
    assert.equal(out.command, want);
    assert.equal(out.deny, undefined);
  }
  assert.equal(eng.toasts.length, 1);
  assert.match(eng.toasts[0], /could not tell/);
});

test('C9 the same holds after a typed accept and a reload, and for a typed gate with no id', async () => {
  const eng = await armed();
  for (const ev of typedAccept(41)) await eng.invoke(ev.name, ev.e);
  await eng.invoke('session.start', { ...SESSION_START });
  assert.equal((await eng.invoke('tool.call', bash('ac phase accept 41 --witnessed composer'))).command, 'ac phase accept 41');
  const e2 = await armed();
  const out = await turnThen(e2, [run('astro-accept', ''), submit('/astro-accept')], bash('ac phase accept 41 --witnessed composer'));
  assert.equal(out.command, 'ac phase accept 41');
});

test('C10 a gate verb held in a shell variable is agent-signed on the ac segment in every unlocking-less turn', async () => {
  // a variable verb is signed through the environment and can never carry a witnessed claim (C9)
  const E = 'export ASTRO_WITNESS_DROP=1; export ASTRO_SIGNER_AGENT=claude; ';
  const cases = [
    ['V=accept; ac phase $V 41', `${E}V=accept; ac phase $V 41${A}`],
    ['V=accept && ac phase "$V" 41', `${E}V=accept && ac phase "$V" 41${A}`],
    ['export V=reject; ac phase $V 41 --reason x', `${E}export V=reject; ac phase $V 41 --reason x${A}`],
    ['G=accept; ac fix $G 2026-10-01-foo', `${E}G=accept; ac fix $G 2026-10-01-foo${A}`],
  ];
  for (const events of [sdkAccept(40), [submit('hi')], typedAccept(40)]) {
    for (const [cmd, want] of cases) {
      const eng = await armed();
      assert.equal((await turnThen(eng, events, bash(cmd))).command, want, cmd);
    }
    // run 5: a nested shell however quoted gets the signer in the environment every nested ac inherits
    for (const cmd of ['V=accept; bash --norc -c "ac phase $V 41"', 'V=accept; bash -c -- "ac phase $V 41"', "V=accept; bash -c 'ac phase '\"$V\"' 41'"]) {
      const eng = await armed();
      assert.ok((await turnThen(eng, events, bash(cmd))).command.startsWith(E), cmd);
    }
  }
});

test('C9 run 7: a quoted --witnessed in an unreadable call never yields a witnessed record, cold or in an sdk turn; executed against the real ac', async () => {
  const { git } = await import('../lib/git.mjs');
  const { initPlanning } = await import('../lib/planning.mjs');
  const { addPhase, setPhaseStatus, loadRoadmap } = await import('../lib/roadmap.mjs');
  const AC = join(ROOT, 'bin', 'ac.mjs');
  const HOME = mkdtempSync(join(tmpdir(), 'w46h-'));
  const forms = [
    'V=accept; ac phase $V 1 "--witnessed" composer',
    'bash -c "ac phase accept 1 \\"--witnessed\\" composer"',
    "V=accept; ac phase $V 1 '--witnessed' composer",
    'V=accept; ac phase $V 1 "--witnessed=composer"',
    'V=accept; x=`ac phase $V 1 "--witnessed" composer`',
    // run 8: the claim held in a variable behind a readable gate
    'W=--witnessed; ac phase accept 1 $W composer',
    'export W=--witnessed; ac phase accept 1 ${W} composer',
    'W=--witnessed; ac phase reject 1 --reason x $W composer',
    // run 9: the claim split into the ref word, or by quote concatenation behind a variable ref
    'A="1 --witn"; ac phase accept ${A}essed composer',
    'A="--witn"; ac phase accept 1${A:+ }${A}essed composer',
    "ac phase accept $(printf '1 --witn%s' essed) composer",
    'R=1; ac phase accept $R --witn""essed composer',
    // no trace of the word at all: built from escapes inside a substitution
    "ac phase accept $(printf '1 \\x2d\\x2dwi\\x74nessed') composer",
  ];
  for (const when of ['cold', 'sdk']) {
    for (const form of forms) {
      const eng = await armed();
      const out = when === 'cold' ? (await eng.invoke('tool.call', bash(form))).command : (await turnThen(eng, sdkAccept(2), bash(form))).command;
      const dir = mkdtempSync(join(tmpdir(), 'w46p-'));
      git(['init', '--quiet'], { cwd: dir });
      git(['config', 'user.email', 't@t'], { cwd: dir });
      git(['config', 'user.name', 't'], { cwd: dir });
      initPlanning(dir, { name: 'p' });
      await addPhase(dir, { number: 1, name: 'alpha', milestone: 1 });
      await setPhaseStatus(dir, loadRoadmap(dir).phases[0].slug, 'verified');
      const shim = `ac() { "${process.execPath}" "${AC}" "$@"; }; export -f ac; `;
      const r = spawnSync('bash', ['-c', shim + out], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME } });
      assert.equal(r.status, 0, `${when} ${form} -> ${out}: ${r.stderr}`);
      const ph = loadRoadmap(dir).phases[0];
      assert.equal(ph.accepted_evidence, undefined, `${when} ${form} -> ${out}`);
      assert.ok(!JSON.stringify(ph.rejections ?? []).includes('composer'), `${when} ${form} -> ${out}`);
      if (when === 'sdk') assert.equal(ph.accepted_kind ?? ph.rejections?.at(-1)?.kind, 'agent', `${when} ${form} -> ${out}`);
    }
  }
});

test('C10 run 6: backticks and a here-string are signed through the environment and still run; executed against the real ac', async () => {
  const { git } = await import('../lib/git.mjs');
  const { initPlanning } = await import('../lib/planning.mjs');
  const { addPhase, setPhaseStatus, loadRoadmap } = await import('../lib/roadmap.mjs');
  const AC = join(ROOT, 'bin', 'ac.mjs');
  const HOME = mkdtempSync(join(tmpdir(), 'w46h-'));
  const forms = [
    'V=accept; x=`ac phase $V 1`',
    'V=accept; echo `ac phase $V 1`',
    'V=accept; bash <<< "ac phase $V 1"',
    'V=accept; bash --norc -c "ac phase $V 1"',
    'V=reject; x=`ac phase $V 1 --reason x`',
  ];
  for (const events of [sdkAccept(2), [submit('hi')], typedAccept(2)]) {
    for (const form of forms) {
      const eng = await armed();
      const out = (await turnThen(eng, events, bash(form))).command;
      const dir = mkdtempSync(join(tmpdir(), 'w46p-'));
      git(['init', '--quiet'], { cwd: dir });
      git(['config', 'user.email', 't@t'], { cwd: dir });
      git(['config', 'user.name', 't'], { cwd: dir });
      initPlanning(dir, { name: 'p' });
      await addPhase(dir, { number: 1, name: 'alpha', milestone: 1 });
      await setPhaseStatus(dir, loadRoadmap(dir).phases[0].slug, 'verified');
      const shim = `ac() { "${process.execPath}" "${AC}" "$@"; }; export -f ac; `;
      const r = spawnSync('bash', ['-c', shim + out], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOME } });
      assert.equal(r.status, 0, `${form} -> ${out}: ${r.stderr}`);
      const ph = loadRoadmap(dir).phases[0];
      const kind = ph.accepted_kind ?? ph.rejections?.at(-1)?.kind;
      assert.equal(kind, 'agent', `${form} -> ${out}`);
    }
  }
});

test('C11 an ADR title quoting a gate with escaped quotes is byte-identical; a real gate after escaped quotes is still signed', async () => {
  const adr = 'ac decision add "A human gate (phase accept/reject, fix accept) may cite a decision made elsewhere with --evidence \\"<id or URL>\\", stored beside the record; a citation never makes the signer human"';
  const commit = 'git commit -m "docs: say \\"ac phase accept 41\\" in the manual"';
  for (const events of [sdkAccept(41), [submit('hi')]]) {
    for (const cmd of [adr, commit]) {
      const eng = await armed();
      const call = bash(cmd);
      assert.deepEqual(await turnThen(eng, events, call), call);
      assert.deepEqual(eng.toasts, []);
    }
  }
  const eng = await armed();
  const out = await turnThen(eng, sdkAccept(41), bash('echo "say \\"hi\\"" && ac phase accept 41'));
  assert.equal(out.command, `echo "say \\"hi\\"" && ac phase accept 41${A}`);
});

test('C8 a Bash write of the human marker becomes the agent marker outside a typed discuss of that phase', async () => {
  const { AGENT_MARKER, effectGuard } = await import('../mods/astro-mods/hooks/lib/gates.js');
  const ctx = '.astrocode/phases/41-x/CONTEXT.md';
  const forms = [
    `printf '${HUMAN}\\nbody\\n' > ${ctx}`,
    `sed -i '1s/.*/${HUMAN}/' ${ctx}`,
    `cat > ${ctx} <<'EOF'\n${HUMAN}\nbody\nEOF`,
  ];
  for (const events of [sdkAccept(41), [run('astro-autonomous', ''), submit('/astro-autonomous')], typedDiscuss(40)]) {
    for (const cmd of forms) {
      const eng = await armed();
      const out = await turnThen(eng, events, bash(cmd));
      // the text is rewritten, then the call is judged by its effect on line 1 (phase 46 C8)
      assert.equal(out.command, effectGuard(cmd.replace(HUMAN, AGENT_MARKER)));
      assert.equal(eng.toasts.length, 1);
      assert.match(eng.toasts[0], /CONTEXT\.md marker/);
    }
  }
  const eng = await armed();
  const call = bash(forms[0]);
  assert.deepEqual(await turnThen(eng, typedDiscuss(41), call), call, 'a typed discuss of that phase stays human');
  const cold = await armed();
  assert.deepEqual(await cold.invoke('tool.call', call), call, 'no known turn: left as declared');
  assert.match(cold.toasts[0], /could not tell/);
  // a write whose text shows no marker is still guarded by its effect; a read is not touched
  const sneaky = bash(`sed -i '1d' ${ctx}`);
  const e2 = await armed();
  assert.equal((await turnThen(e2, sdkAccept(41), sneaky)).command, effectGuard(sneaky.command));
  const e3 = await armed();
  assert.deepEqual(await turnThen(e3, typedDiscuss(41), sneaky), sneaky, 'the typed discuss of that phase: no guard');
  const read = bash(`cat ${ctx}`);
  const e4 = await armed();
  assert.deepEqual(await turnThen(e4, sdkAccept(41), read), read);
});
