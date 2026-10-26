// Phase 43 t3 — the phase-band view model (pure helpers, no `$`, no fs).
// Symbols arrive through `await import(...)` inside each test (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const band = () => import('../mods/astro-mods/hooks/lib/band.js');

const STATUS = {
  root: '/p', project: 'p', milestone: 12,
  phase: { number: 38, slug: '38-x', name: 'X', status: 'pending' },
  next: '/astro-execute 38',
  siblings: ['/astro-discuss 44', '/astro-accept 40', '/astro-plan 45'],
  phases: [
    { number: 38, name: 'X', slug: '38-x', status: 'pending', planned: true, discussed: true },
    { number: 40, name: 'Y', slug: '40-y', status: 'verified', planned: true, discussed: true },
    { number: 41, name: 'Z', slug: '41-z', status: 'complete', planned: true, discussed: true },
  ],
  activity: null,
};

test('readJsonResult: parsed object, or null for every failure, never throws', async () => {
  const { readJsonResult } = await band();
  assert.deepEqual(readJsonResult({ exitCode: 0, stdout: '{"a":1}' }), { a: 1 });
  for (const ran of [
    { exitCode: 1, stdout: '{"a":1}' },
    { exitCode: 0, stdout: 'nope' },
    { exitCode: 0, stdout: '{"a":' },
    { exitCode: 0, stdout: '{"a":1}', isStdoutTruncated: true },
    { exitCode: 0, stdout: '5' },
    { exitCode: 0, stdout: 'null' },
    { exitCode: 0, stdout: '"s"' },
    { exitCode: 0 },
    null,
    undefined,
  ]) assert.equal(readJsonResult(ran), null);
});

test('rootCandidates: cwd/.astrocode then each parent up to /', async () => {
  const { rootCandidates } = await band();
  assert.deepEqual(rootCandidates('/a/b/c'), ['/a/b/c/.astrocode', '/a/b/.astrocode', '/a/.astrocode', '/.astrocode']);
  assert.deepEqual(rootCandidates('/'), ['/.astrocode']);
  assert.deepEqual(rootCandidates('/a/b/'), ['/a/b/.astrocode', '/a/.astrocode', '/.astrocode']);
});

test('signature: changes with any mtime, ignores order', async () => {
  const { signature } = await band();
  const a = [{ path: '/x', mtimeMs: 1 }, { path: '/y', mtimeMs: null }];
  assert.equal(signature(a), signature([...a].reverse()));
  assert.notEqual(signature(a), signature([{ path: '/x', mtimeMs: 2 }, { path: '/y', mtimeMs: null }]));
  assert.notEqual(signature(a), signature([{ path: '/x', mtimeMs: 1 }, { path: '/y', mtimeMs: 3 }]));
});

test('stalePaths: state files plus non-complete phase dirs, all inside .astrocode', async () => {
  const { stalePaths } = await band();
  for (const root of ['/p', '/p/.astrocode']) {
    const paths = stalePaths(root, STATUS);
    assert.ok(paths.every(p => p.startsWith('/p/.astrocode/')), root);
    for (const f of ['state', 'roadmap', 'debt', 'backlog', 'fixes']) assert.ok(paths.includes(`/p/.astrocode/${f}.json`), f);
    assert.ok(paths.includes('/p/.astrocode/phases/38-x'));
    assert.ok(paths.includes('/p/.astrocode/phases/40-y'));
    assert.ok(!paths.some(p => p.endsWith('/phases/41-z')));
  }
  assert.equal(stalePaths('/p', { ...STATUS, phases: undefined }).length, 5);
});

test('bandView: idle is a ROADMAP row of every phase, next first, at most 3 buttons, deduped', async () => {
  const { bandView } = await band();
  const v = bandView(STATUS, null, {});
  assert.deepEqual(v.lines, ['ROADMAP  ▸38  ◉40  ✓41']);
  assert.equal(v.title, 'M12');
  assert.deepEqual(v.buttons.map(b => b.command), ['/astro-execute 38', '/astro-discuss 44', '/astro-accept 40']);
  assert.equal(v.buttons[0].label, 'Execute 38');
  assert.equal(new Set(v.buttons.map(b => b.key)).size, v.buttons.length);
  const d = bandView({ ...STATUS, siblings: ['/astro-execute 38', '/astro-plan 3'] }, null, {});
  assert.deepEqual(d.buttons.map(b => b.command), ['/astro-execute 38', '/astro-plan 3']);
});

test('bandView: drops commands that are not loop verbs with a numeric id', async () => {
  const { bandView } = await band();
  const v = bandView({ ...STATUS, next: '/astro-status', siblings: ['/astro-plan 38-slug', '/astro-debt-pay 3', 'x', '/astro-verify 7'] }, null, {});
  assert.deepEqual(v.buttons.map(b => b.command), ['/astro-verify 7']);
});

test('bandView: a live verb with no tracked run is the RUNNING row; none, no row', async () => {
  const { bandView } = await band();
  const v = bandView({ ...STATUS, activity: '⚙ executing' }, null, {});
  assert.deepEqual(v.lines, ['ROADMAP  ▸38  ◉40  ✓41', 'RUNNING  ⚙ executing']);
  assert.equal(bandView({ ...STATUS, phase: null }, null, {}).lines.length, 1);
});

test('bandView: an Agent-tool agent is listed with its observed state', async () => {
  const { bandView } = await band();
  const v = bandView(STATUS, { live: true, agents: [{ name: 'astro-executor', state: 'running' }, { name: 'astro-verifier', state: 'failed' }], source: 'agent.list' }, {});
  assert.equal(v.lines[1], 'RUNNING  astro-executor — running   astro-verifier — failed');
});

test('bandView: runs fill RUNNING with their crews, mark their phases, and are not offered again', async () => {
  const { bandView } = await band();
  const runs = [
    { kind: 'execute', phase: 38, agents: ['astro-executor', 'astro-executor'] },
    { kind: 'plan', phase: 44, agents: [] },
  ];
  const v = bandView({ ...STATUS, phases: [...STATUS.phases, { number: 44, status: 'pending', planned: false, discussed: true }] }, null, { runs });
  assert.deepEqual(v.lines, ['ROADMAP  ⚙38  ◉40  ✓41  ✎44', 'RUNNING  ⚙ execute 38 · 2 executors   ✎ plan 44 · starting']);
  assert.ok(!v.buttons.some(b => b.command === '/astro-execute 38'));
  assert.equal(v.parts[0].find(t => t.text === '⚙38').current, true, 'the current phase is marked');
});

test('bandView: more than three finished phases fold into one chip', async () => {
  const { bandView } = await band();
  const phases = [1, 2, 3, 4, 5].map(n => ({ number: n, status: n < 5 ? 'complete' : 'pending', planned: false, discussed: false }));
  assert.deepEqual(bandView({ ...STATUS, phase: null, phases }, null, {}).lines, ['ROADMAP  ✓ 4 done  ○5']);
});

test('runOf, notifiedTask and crewOf read what the engine hands the band', async () => {
  const { runOf, notifiedTask, crewOf } = await band();
  assert.deepEqual(runOf('astro-execute-phase', { phase: '110-session-tree' }), { kind: 'execute', phase: 110 });
  assert.deepEqual(runOf('astro-plan-phase', { phase: '7-x' }), { kind: 'plan', phase: 7 });
  assert.equal(runOf('review-changes', { phase: '1' }), null);
  assert.deepEqual(runOf('astro-plan-phase', null), { kind: 'plan', phase: null });
  assert.deepEqual(notifiedTask('<task-notification>\n<task-id>w3rahirgr</task-id>\n<status>completed</status>'), { taskId: 'w3rahirgr', status: 'completed' });
  assert.equal(notifiedTask('just text'), null);
  assert.equal(crewOf([]), 'starting');
  assert.equal(crewOf(['astro-researcher', 'astro-researcher', 'astro-planner']), '2 researchers · 1 planner');
  assert.equal(crewOf(['something-else']), '1 agent');
});

test('bandView: unavailable is one dim line, reason capped, no buttons', async () => {
  const { bandView } = await band();
  const v = bandView(STATUS, null, { unavailable: 'x'.repeat(200) });
  assert.deepEqual(v.buttons, []);
  assert.equal(v.lines.length, 1);
  assert.match(v.lines[0], /^astro-code status unavailable \(x{60}\)$/);
  assert.deepEqual(bandView(null, null, { unavailable: 'ac exited 1' }).lines, ['astro-code status unavailable (ac exited 1)']);
});

test('bandView: null status and not unavailable draws nothing', async () => {
  const { bandView } = await band();
  for (const v of [bandView(null, null, {}), bandView(undefined, null)]) {
    assert.deepEqual([v.lines, v.buttons, v.meter, v.hint], [[], [], null, null]);
  }
});

test('liveFrom: only executor/verifier, status mapped, unknown reads running', async () => {
  const { liveFrom } = await band();
  const rows = [
    { type: 'astro-executor', status: 'running', name: 'e1' },
    { type: 'astro-verifier', status: 'completed', name: 'v1' },
    { type: 'astro-executor', status: 'failed', name: 'e2' },
    { type: 'astro-executor', status: 'weird', name: 'e3' },
    { type: 'Explore', status: 'running', name: 'x' },
  ];
  assert.deepEqual(liveFrom(rows, null, true), {
    live: true,
    agents: [
      { name: 'e1', state: 'running' }, { name: 'v1', state: 'done' },
      { name: 'e2', state: 'failed' }, { name: 'e3', state: 'running' },
    ],
    source: 'agent.list',
  });
});

test('liveFrom: all done and no activity is not live; activity alone makes it live', async () => {
  const { liveFrom } = await band();
  const done = [{ type: 'astro-executor', status: 'completed', name: 'e' }];
  assert.equal(liveFrom(done, null, true).live, false);
  assert.equal(liveFrom(done, '⚙ executing', true).live, true);
  assert.equal(liveFrom([], null, true).live, false);
  assert.equal(liveFrom(undefined, null, true).live, false);
});

test('liveFrom: workflow agents not listed gives activity source, null agents, never fabricated', async () => {
  const { liveFrom } = await band();
  assert.deepEqual(liveFrom([], '⚙ executing', false), { live: true, agents: null, source: 'activity' });
  const kept = liveFrom([{ type: 'astro-executor', status: 'running', name: 'e' }], null, false);
  assert.deepEqual(kept, { live: true, agents: [{ name: 'e', state: 'running' }], source: 'activity' });
});

test('bandView: each row comes as coloured parts that join to exactly that row', async () => {
  const { bandView } = await band();
  const v = bandView({ ...STATUS, activity: '⚙ executing' }, { live: true, agents: [{ name: 'astro-executor', state: 'running' }], source: 'agent.list' }, {});
  assert.deepEqual(v.parts.map(p => p.map(t => t.text).join('')), v.lines);
  const tones = v.parts[0].map(t => t.tone);
  assert.ok(tones.includes('chip:planned') && tones.includes('chip:verified') && tones.includes('chip:done'), String(tones));
  assert.ok(v.parts[1].some(t => t.tone === 'agent:running'));
});

test('meterOf: done of total as a bar at most 10 cells wide; none without phases', async () => {
  const { meterOf } = await band();
  const ph = (...s) => ({ phases: s.map((status, i) => ({ number: i + 1, status })) });
  assert.deepEqual(meterOf(ph('complete', 'complete', 'verified', 'pending')), { done: 2, total: 4, bar: '▰▰▱▱' });
  assert.equal(meterOf(ph(...Array(20).fill('complete'))).bar, '▰'.repeat(10));
  assert.equal(meterOf(ph(...Array(25).fill('pending'))).bar.length, 10);
  assert.equal(meterOf({ phases: [] }), null);
  assert.equal(meterOf(null), null);
});

test('bandView: a next command that is not a phase button becomes the hint; a button never repeats as one', async () => {
  const { bandView } = await band();
  const v = bandView({ ...STATUS, phase: null, next: '/astro-milestone', siblings: [] }, null, {});
  assert.equal(v.hint, '/astro-milestone');
  assert.deepEqual(v.buttons, []);
  assert.equal(bandView(STATUS, null, {}).hint, null);
});

test('bandView: a teammate\'s phase chip carries their tag, e.g. ○84(a)', async () => {
  const { bandView } = await band();
  const phases = [...STATUS.phases, { number: 84, status: 'pending', owner: 'a', remote: true, planned: false, discussed: false }];
  const v = bandView({ ...STATUS, phases }, null, {});
  assert.match(v.lines[0], /○84\(a\)$/);
});

test('bandView: carries astro-code\'s version for the title', async () => {
  const { bandView } = await band();
  assert.equal(bandView({ ...STATUS, version: '0.50.0' }, null, {}).version, '0.50.0');
  assert.equal(bandView(STATUS, null, {}).version, null);
});

test('bandView: the roadmap row is the current milestone without rejected phases; other open milestones get one row', async () => {
  const { bandView, meterOf } = await band();
  const p = (number, milestone, status) => ({ number, name: 'n', slug: `${number}-n`, status, milestone, planned: false, discussed: false });
  const status = {
    ...STATUS, milestone: 5, phase: { number: 104, slug: '104-n', name: 'n', status: 'pending' }, next: null, siblings: [],
    phases: [p(54, 2, 'rejected'), p(58, 2, 'complete'), p(84, 2, 'pending'), p(87, 2, 'pending'),
      p(90, 4, 'verified'), p(91, 4, 'verified'), p(99, 4, 'pending'), p(76, 3, 'complete'),
      p(103, 5, 'rejected'), p(104, 5, 'pending'), p(105, 5, 'pending')],
  };
  const v = bandView(status, null, {});
  assert.equal(v.lines[0], 'ROADMAP  ○104  ○105');
  assert.equal(v.lines[1], 'OTHER    M2 2 open · M4 2 to accept, 1 open');
  assert.deepEqual([meterOf(status).done, meterOf(status).total], [0, 2]);
  // a closed milestone (complete and rejected only) is not listed; no other row when none hold work
  const closed = bandView({ ...status, phases: status.phases.filter((x) => x.milestone !== 2 && x.milestone !== 4) }, null, {});
  assert.equal(closed.lines.length, 1);
  // the current phase stays even when rejected; phases without a milestone (older roadmaps) stay
  const cur = bandView({ ...status, phase: { number: 103, slug: '103-n', name: 'n', status: 'rejected' }, phases: [...status.phases, { number: 110, status: 'pending' }] }, null, {});
  assert.equal(cur.lines[0], 'ROADMAP  ✗103  ○104  ○105  ○110');
});
