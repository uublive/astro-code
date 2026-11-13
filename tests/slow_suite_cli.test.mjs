// ADR-094: this file pins per-phase verify; fast mode is covered by verify_fast*.test.mjs
// Phase 56 t4 (C1-C9, C13): a slow suite is held back end to end, through the real CLI in a real tmp git
// project. The suite command appends a line to a marker file OUTSIDE the repo, so a run is countable.
// A timing is seeded exactly as CRITERIA.md describes: `ac suite run`, edit `seconds`, then commit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase } from '../lib/roadmap.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const ac = (cwd, ...a) => spawnSync(process.execPath, [AC, ...a], { cwd, encoding: 'utf8', env: { ...process.env, ASTRO_SIGNER_AGENT: '' } });
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body = 'x') => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const OK = 'node -e "process.exit(0)"';
const BAD = 'node -e "console.log(\'boom\');process.exit(1)"';

async function project({ c2 = BAD } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-slow-cli-'));
  const out = mkdtempSync(join(tmpdir(), 'ac-slow-marker-'));
  const marker = join(out, 'runs');
  writeFileSync(marker, '');
  // The suite exits 1 once the flag file exists, so ONE command string can be timed passing, then fail.
  const flag = join(out, 'fail');
  const suiteCmd = `echo x >> '${marker}'; test ! -f '${flag}'`;
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'vproj' });
  ac(dir, 'config', 'set', 'verify.full_suite', 'phase');
  await addPhase(dir, { number: 1, name: 'Do a thing' });
  const ph = findPhase(dir, '1');
  const crit = (cmd, c2cmd) => [
    '### C1 [suite] — the suite', `- **Observe:** \`${cmd}\``, '',
    '### C2 — two', `- **Cheap:** \`${c2cmd}\``, '',
    '### C3 — three', `- **Cheap:** \`${OK}\``, '',
  ].join('\n');
  const p = {
    dir, slug: ph.slug, marker, suiteCmd,
    crit,
    failSuite: () => writeFileSync(flag, ''),
    runs: () => readFileSync(marker, 'utf8').split('\n').filter(Boolean).length,
    commit: (m = 'c') => { put(dir, `src/${Math.random().toString(36).slice(2)}.mjs`); sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', m); },
    setCriteria: (cmd = suiteCmd, c2cmd = c2) => { put(dir, `.astrocode/phases/${ph.slug}/CRITERIA.md`, crit(cmd, c2cmd)); p.commit('criteria'); },
    // `ac suite run` once, set its receipt's seconds, then a new commit so it is no longer reusable at HEAD.
    seed: (seconds, cmd = suiteCmd, { commit = true } = {}) => {
      const r = ac(dir, 'suite', 'run', '--command', cmd);
      assert.equal(typeof r.status, 'number', r.stderr);
      const d = join(dir, '.astrocode', '.local', 'suite-receipts');
      for (const f of readdirSync(d)) {
        const rc = JSON.parse(readFileSync(join(d, f), 'utf8'));
        if (rc.command === cmd && rc.commit === sh(dir, 'rev-parse', 'HEAD').stdout.trim()) writeFileSync(join(d, f), JSON.stringify({ ...rc, seconds }));
      }
      if (commit) p.commit('after timing');
    },
    cheap: (...a) => ac(dir, 'verdict', 'cheap', '1', ...a),
    done: () => { rmSync(dir, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); },
  };
  p.setCriteria();
  return p;
}
const delta = (p, fn) => { const b = p.runs(); const r = fn(); return { r, ran: p.runs() - b }; };

test('C1: a 900s suite is held back by the cheap pass: no run, every other unmet listed, never recorded unmet, exit 1; phase verify refuses', async () => {
  const p = await project();
  try {
    p.seed(900);
    const { r, ran } = delta(p, () => p.cheap('--json'));
    assert.equal(ran, 0, 'the slow suite did not run');
    assert.equal(r.status, 1, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.unmet, ['C2']);
    assert.deepEqual(out.held.map((h) => h.id), ['C1']);
    const t = delta(p, () => p.cheap());
    assert.equal(t.ran, 0);
    assert.match(t.r.stdout, /• C1 suite: held back — last run 900s > 600s threshold; not run this round/);
    assert.match(t.r.stdout, /✖ cheap pass: 1 unmet — C2 \(1 held back\)/);
    assert.match(ac(p.dir, 'verdict', 'history', '1').stdout, /unmet: C2.*held: C1/);
    const show = JSON.parse(ac(p.dir, 'verdict', 'show', '1', '--json').stdout);
    assert.deepEqual(show.unmet, ['C2']);
    assert.deepEqual(show.held, ['C1']);
    assert.match(ac(p.dir, 'verdict', 'show', '1').stdout, /held back: C1 \(slow suite, not run\)/);
    assert.match(ac(p.dir, 'verdict', 'plan', '1').stdout, /• slow suite last: C1/);
    assert.deepEqual(JSON.parse(ac(p.dir, 'verdict', 'plan', '1', '--json').stdout).order, { first: ['C2'], last: ['C1'] });
  } finally { p.done(); }
});

test('C1: with C2 fixed the pass is clean-with-held, runs nothing, records nothing and phase verify refuses', async () => {
  const p = await project({ c2: OK });
  try {
    p.seed(900);
    const { r, ran } = delta(p, () => p.cheap());
    assert.equal(ran, 0);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /\(1 held back\)/);
    assert.equal(ac(p.dir, 'phase', 'verify', '1').status !== 0, true);
  } finally { p.done(); }
});

test('C2: an untimed suite is held; after one ac suite run and a commit it runs and is met', async () => {
  const p = await project({ c2: OK });
  try {
    let { r, ran } = delta(p, () => p.cheap('--json'));
    assert.equal(ran, 0);
    assert.match(JSON.parse(r.stdout).held[0].reason, /no recorded run/);
    p.seed(1);
    ({ r, ran } = delta(p, () => p.cheap('--json')));
    assert.equal(ran, 1, 'a fast timing (any commit) lets the suite run');
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.held, []);
    assert.equal(out.ran.find((x) => x.id === 'C1').passed, true);
  } finally { p.done(); }
});

test('C3: a 30s timing runs the suite and its failure is unmet next to the failing criterion', async () => {
  const p = await project();
  try {
    p.seed(30);
    p.failSuite();
    const { r, ran } = delta(p, () => p.cheap('--json'));
    assert.equal(ran, 1);
    assert.deepEqual(JSON.parse(r.stdout).unmet, ['C1', 'C2']);
  } finally { p.done(); }
});

test('C4: a reusable receipt at HEAD, even at 900s, is met through the receipt without a run', async () => {
  const p = await project({ c2: OK });
  try {
    p.seed(900, undefined, { commit: false });
    const { r, ran } = delta(p, () => p.cheap('--json'));
    assert.equal(ran, 0);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.held, []);
    assert.match(out.ran.find((x) => x.id === 'C1').output, /reused suite receipt/);
  } finally { p.done(); }
});

test('C5: 590 runs, 610 is held; a project setting of 1 holds 120s, 30 runs 610s', async () => {
  const p = await project({ c2: OK });
  try {
    p.seed(590);
    assert.equal(delta(p, () => p.cheap()).ran, 1);
    p.commit();
    p.seed(610);
    assert.equal(delta(p, () => p.cheap()).ran, 0);
    assert.equal(ac(p.dir, 'config', 'set', 'verify.slow_suite_minutes', '30').status, 0);
    p.commit();
    assert.equal(delta(p, () => p.cheap()).ran, 1);
    assert.equal(ac(p.dir, 'config', 'set', 'verify.slow_suite_minutes', '1').status, 0);
    p.seed(120);
    assert.equal(delta(p, () => p.cheap()).ran, 0);
  } finally { p.done(); }
});

test('C6: the most recent run decides, and another command does not leak in', async () => {
  const p = await project({ c2: OK });
  try {
    p.seed(900);
    p.seed(30);
    assert.equal(delta(p, () => p.cheap()).ran, 1, '900 then 30: runs');
  } finally { p.done(); }
  const q = await project({ c2: OK });
  try {
    q.seed(30);
    q.seed(900);
    assert.equal(delta(q, () => q.cheap()).ran, 0, '30 then 900: held');
  } finally { q.done(); }
  const o = await project({ c2: OK });
  try {
    o.seed(900, `${o.suiteCmd}; true`);
    const { r, ran } = delta(o, () => o.cheap('--json'));
    assert.equal(ran, 0, 'no timing for THIS command: held for that reason');
    assert.match(JSON.parse(r.stdout).held[0].reason, /no recorded run/);
  } finally { o.done(); }
});

test('C7: a bad threshold keeps a 900s suite held back and warns', async () => {
  for (const bad of ['abc', '-5']) {
    const p = await project({ c2: OK });
    try {
      p.seed(900);
      ac(p.dir, 'config', 'set', 'verify.slow_suite_minutes', bad);
      p.commit();
      const { r, ran } = delta(p, () => p.cheap());
      assert.equal(ran, 0, bad);
      assert.match(r.stderr, /⚠ verify\.slow_suite_minutes .* is not a positive number/);
    } finally { p.done(); }
  }
});

const rec = (p, criteria, mode = 'full') => JSON.parse(ac(p.dir, 'verdict', 'record', '1', '--result', JSON.stringify({ mode, criteria })).stdout);

test('C8: a held-back suite with two failures is a FAIL listing both; held is neither unmet, failed nor deferrable', async () => {
  const p = await project({ c2: BAD });
  try {
    const out = rec(p, [{ id: 'C1', held: true, suite: true }, { id: 'C2', passed: false }, { id: 'C3', passed: false }]);
    assert.equal(out.passed, false);
    assert.deepEqual(out.failing, ['C2', 'C3']);
    assert.deepEqual(out.held, ['C1']);
    assert.ok(!(out.deferrable ?? []).includes('C1'));
    const show = JSON.parse(ac(p.dir, 'verdict', 'show', '1', '--json').stdout);
    assert.deepEqual(show.unmet, ['C2', 'C3']);
    assert.deepEqual(show.held, ['C1']);
    assert.notEqual(ac(p.dir, 'phase', 'verify', '1').status, 0);
  } finally { p.done(); }
});

test('C9: held + everything else passed is no PASS; the suite run at HEAD and recorded passed is, and an older receipt is refused', async () => {
  const p = await project({ c2: OK });
  try {
    const out = rec(p, [{ id: 'C1', held: true, suite: true }, { id: 'C2', passed: true }, { id: 'C3', passed: true }]);
    assert.equal(out.passed, false);
    assert.notEqual(ac(p.dir, 'phase', 'verify', '1').status, 0);
    // an older receipt is not the suite's evidence at HEAD
    p.seed(1);
    const rcpt = JSON.parse(ac(p.dir, 'suite', 'receipt', '--command', p.suiteCmd, '--json').stdout);
    assert.equal(rcpt.reusable, false);
    // now observe it at the clean HEAD
    const run = ac(p.dir, 'suite', 'run', '--command', p.suiteCmd);
    assert.equal(run.status, 0, run.stderr);
    const ok = rec(p, [{ id: 'C1', passed: true, suite: true }, { id: 'C2', passed: true }, { id: 'C3', passed: true }]);
    assert.equal(ok.passed, true);
    const v = ac(p.dir, 'phase', 'verify', '1');
    assert.equal(v.status, 0, v.stderr + v.stdout);
  } finally { p.done(); }
});

test('C13: ac suite receipt prints the slow-or-fast decision, as JSON and text', async () => {
  const p = await project({ c2: OK });
  try {
    p.seed(900);
    const j = JSON.parse(ac(p.dir, 'suite', 'receipt', '--command', p.suiteCmd, '--json').stdout);
    assert.equal(j.slow.slow, true);
    assert.equal(j.slow.threshold_seconds, 600);
    assert.match(ac(p.dir, 'suite', 'receipt', '--command', p.suiteCmd).stdout, /• slow suite \(last run 900s > 600s threshold\) — held back: run it last, through ac suite run/);
    p.seed(30);
    const f = JSON.parse(ac(p.dir, 'suite', 'receipt', '--command', p.suiteCmd, '--json').stdout);
    assert.equal(f.slow.slow, false);
    assert.match(ac(p.dir, 'suite', 'receipt', '--command', p.suiteCmd).stdout, /• fast suite \(last run 30s ≤ 600s threshold\) — run it in order/);
  } finally { p.done(); }
});
