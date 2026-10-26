// Phase 51 t9 — end-to-end calibration scenarios, driven only through `node bin/ac.mjs` with the
// recording stub `claude` (C2 to C9), plus the producer-to-consumer check: a real `ac mutate` run
// feeds `ac verify calibrate`. Explicitly test-after: there is no production code in this task.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeCalibrationProject, writeVerifierStub, readStubLog, sh } from './fixtures/calibrate/project.mjs';
import { makeProject, installStub, restrictedEnv, commit, FX } from './fixtures/mutate/project.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const LEAK = /calibrat|plant|mutant|mutat|defect|mutmut|stryker/i;
const GIT_BIN_DIR = dirname(spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim());

// The smallest environment `ac` needs: a hermetic one, so no stray variable can hold a leak word.
function minimalEnv(scratch, bin) {
  return { PATH: [bin, dirname(process.execPath), GIT_BIN_DIR, '/usr/bin', '/bin'].join(delimiter), TMPDIR: join(scratch, 'tmp'), CLAUDE_CONFIG_DIR: join(scratch, 'cfg'), HOME: join(scratch, 'home') };
}
async function rig(projectOpts = {}, script = {}) {
  const p = await makeCalibrationProject(projectOpts);
  attach(p, script);
  return p;
}
function attach(p, script = {}, env = null) {
  const scratch = mkdtempSync(join(tmpdir(), 'ac-cal-rig-'));
  mkdirSync(join(scratch, 'tmp')); mkdirSync(join(scratch, 'cfg')); mkdirSync(join(scratch, 'home'));
  p.scratch = scratch;
  p.tmp = join(scratch, 'tmp');
  p.logFile = join(scratch, 'stub.log');
  p.bin = join(scratch, 'bin');
  writeVerifierStub(p.bin, { original: p.dir, logFile: p.logFile, script });
  p.env = env ? { ...env, PATH: `${p.bin}${delimiter}${env.PATH}`, TMPDIR: p.tmp, CLAUDE_CONFIG_DIR: join(scratch, 'cfg') } : minimalEnv(scratch, p.bin);
  return p;
}
const done = (p) => { rmSync(p.dir, { recursive: true, force: true }); rmSync(p.scratch, { recursive: true, force: true }); };
const ac = (p, args) => spawnSync(process.execPath, [AC, ...args], { cwd: p.dir, encoding: 'utf8', env: p.env, input: '', timeout: 180000 });
const run = (p, args) => { const r = ac(p, args); assert.equal(r.status, 0, r.stderr); return args.includes('--json') ? JSON.parse(r.stdout) : r.stdout; };
const stub = (p) => readStubLog(p.logFile);
const listLine = (p, slug, key) => readFileSync(join(p.dir, '.astrocode', '.local', 'mutate-runs', `${slug}.mutants.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.key === key);
const byKey = (p) => new Map([...p.expected.easy, ...p.expected.hard].map((e) => [e.key, e]));

test('C2: the defects listed are the fixture\'s killed keys (easy) and test-gap keys (hard) from accepted phases only, with two separate rates', async () => {
  const p = await rig({ killed: 4 });
  try {
    const j = run(p, ['verify', 'calibrate', '--defects', '4', '--runs', '1', '--seed', '2', '--yes', '--json']);
    assert.equal(j.defects.length, 4);
    for (const d of j.defects) {
      assert.ok(d.phase && d.tool && d.set, 'each defect names its phase, tool and set');
      const pool = d.set === 'easy' ? p.expected.easy : p.expected.hard;
      const e = pool.find((x) => x.key === d.key);
      assert.ok(e, `${d.id} ${d.key} is in the fixture's ${d.set} keys`);
      assert.equal(e.tool, d.tool);
      assert.ok(!p.expected.trap.includes(d.key), 'never from a pending or verified phase');
      assert.ok([1, 2].includes(d.phase));
    }
    assert.ok(j.sets.easy.defect_rate && j.sets.hard.defect_rate && j.sets.easy !== j.sets.hard, 'two separate rates, never one blended');
    for (const s of ['easy', 'hard']) {
      assert.ok(j.sets[s].defect_rate.n === 2 && j.sets[s].trial_rate.n === 2, `${s} has its own counts`);
    }
  } finally { done(p); }
});

test('C3: every copy sits outside the fixture and differs by exactly the recorded change, for both tools; the fixture is untouched and no copy remains', async () => {
  const p = await rig({ killed: 4 });
  try {
    const j = run(p, ['verify', 'calibrate', '--defects', '14', '--runs', '1', '--seed', '3', '--yes', '--json']);
    const recs = stub(p);
    assert.equal(recs.length, j.defects.length);
    assert.deepEqual(new Set(j.defects.map((d) => d.tool)), new Set(['stryker', 'mutmut']), 'a defect from each tool');
    const { plantChange } = await import('../lib/plant.mjs');
    recs.forEach((rec, i) => {
      const d = j.defects[i];
      const line = listLine(p, byKey(p).get(d.key).slug, d.key);
      assert.ok(!rec.cwd.startsWith(p.dir) && !rec.cwd.startsWith(dirname(p.dir) + '/ac-cal-proj-'), 'never the working tree');
      assert.equal(rec.changed.length, 1, 'one file differs');
      assert.equal(rec.changed[0].file, line.file);
      const before = readFileSync(join(p.dir, line.file), 'utf8').split('\n');
      const after = plantChange(before.join('\n'), line).split('\n');
      const minus = before.filter((l, n) => l !== after[n]);
      const plus = after.filter((l, n) => l !== before[n]);
      const diffMinus = rec.changed[0].diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).map((l) => l.slice(1));
      const diffPlus = rec.changed[0].diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
      assert.deepEqual([diffMinus, diffPlus], [minus, plus], `${d.id}: exactly the tool's change`);
      assert.equal(rec.changed[0].diff.split('\n').filter((l) => l.startsWith('@@')).length, 1, 'one hunk');
      assert.deepEqual([...rec.removed].sort(), [...j.trials[i].scrubbed].sort(), 'each removal is listed in the JSON');
      assert.equal(rec.added.length, 0);
    });
    assert.equal(sh(p.dir, 'status', '--porcelain').stdout, '');
    assert.equal(sh(p.dir, 'diff').stdout, '');
    assert.deepEqual(readdirSync(p.tmp), []);
  } finally { done(p); }
});

test('C4: nothing the verifier can see names the plant, and it gets the same agent and contract as /astro-verify', async () => {
  const p = await rig({ killed: 4 });
  try {
    run(p, ['verify', 'calibrate', '--defects', '6', '--runs', '1', '--seed', '4', '--yes', '--json']);
    const { verifierContract } = await import('../lib/verifyrun.mjs');
    const recs = stub(p);
    assert.equal(recs.length, 6);
    for (const rec of recs) {
      for (const [what, text] of Object.entries({
        argv: rec.argv.join('\n'), stdin: rec.stdin, envNames: Object.keys(rec.env).join('\n'), envValues: Object.values(rec.env).join('\n'),
        status: rec.status, log: rec.log.join('\n'), refs: rec.refs.join('\n'), files: rec.files.join('\n'), cwd: rec.cwd,
      })) {
        // the phase's own name ("Second") and slug are project-sourced and reach /astro-verify too
        assert.doesNotMatch(text, LEAK, `${what} names the plant`);
      }
      assert.equal(rec.status, '', 'the plant is not an uncommitted modification');
      assert.ok(!rec.files.some((f) => /(^|\/)(mutants\/|reports\/mutation|SURVIVORS\.json$|VERDICT\.json$|CALIBRATION\.jsonl$)/.test(f)));
      const prompt = rec.argv.at(-1);
      assert.ok(prompt.includes(verifierContract()), 'the contract text is /astro-verify\'s own');
      assert.equal(rec.argv[rec.argv.indexOf('--agent') + 1], 'astro-verifier');
      assert.ok(rec.argv.includes('--allowedTools') && rec.argv.includes('--max-budget-usd'));
      assert.match(prompt, /CRITERIA\.md/);
      assert.match(prompt, /full verify, not narrowed/);
    }
  } finally { done(p); }
});

test('C5: always / one-of-three / never PASSed defects give n × 3 invocations, the right rates and pass^k', async () => {
  const p = await rig({ killed: 4 });
  try {
    const plan = run(p, ['verify', 'calibrate', '--defects', '4', '--runs', '3', '--seed', '5', '--json']);
    const [e1, e2] = plan.defects.filter((d) => d.set === 'easy');
    const { plantChange } = await import('../lib/plant.mjs');
    // The distinctive line a plant adds to the diff; the trailing newline stops `x - 1` matching `x - 10`.
    const mutated = (d) => {
      const line = listLine(p, byKey(p).get(d.key).slug, d.key);
      const before = readFileSync(join(p.dir, line.file), 'utf8').split('\n');
      const after = plantChange(before.join('\n'), line).split('\n');
      return `+${after.find((l, n) => l !== before[n])}\n`;
    };
    writeVerifierStub(p.bin, { original: p.dir, logFile: p.logFile, script: { default: ['fail'], rules: [{ includes: mutated(e1), outcomes: ['pass'] }, { includes: mutated(e2), outcomes: ['pass', 'fail', 'fail'] }], cost: 0.5 } });
    const j = run(p, ['verify', 'calibrate', '--defects', '4', '--runs', '3', '--seed', '5', '--yes', '--json']);
    assert.equal(stub(p).length, 12);
    const by = Object.fromEntries(j.defects.map((d) => [d.id, d]));
    assert.deepEqual([by[e1.id].passes, by[e1.id].trials], [3, 3]);
    assert.deepEqual([by[e2.id].passes, by[e2.id].trials], [1, 3]);
    assert.deepEqual(by[e1.id].pass_k, [0, 0, 0]);
    assert.ok(Math.abs(by[e2.id].pass_k[0] - 2 / 3) < 1e-9 && by[e2.id].pass_k[2] === 0);
    assert.deepEqual(j.defects.filter((d) => d.set === 'hard').map((d) => d.pass_k), [[1, 1, 1], [1, 1, 1]]);
    const { easy, hard } = j.sets;
    assert.deepEqual([easy.defect_rate.x, easy.defect_rate.n, easy.trial_rate.x, easy.trial_rate.n], [2, 2, 4, 6]);
    assert.deepEqual([hard.defect_rate.x, hard.defect_rate.n, hard.trial_rate.x], [0, 2, 0]);
    for (const r of [easy.defect_rate, easy.trial_rate, hard.defect_rate, hard.trial_rate]) assert.ok(r.lo >= 0 && r.hi <= 1 && r.lo <= r.p && r.p <= r.hi);
    assert.ok(hard.defect_rate.hi > 0, 'zero false PASSes still has an upper bound');
  } finally { done(p); }
});

test('C6: the same seed plants the same defects and diffs, and seed 8 differs, over a pool of 20+', async () => {
  const p = await rig({ killed: 12 }, { default: ['fail'], cost: 0.1 });
  try {
    const go = (seed) => { const j = run(p, ['verify', 'calibrate', '--defects', '4', '--runs', '1', '--seed', String(seed), '--yes', '--json']); return { keys: j.defects.map((d) => d.key), diffs: stub(p).slice(-4).map((r) => r.changed[0].diff) }; };
    const a = go(7); const b = go(7); const c = go(8);
    assert.deepEqual(a.keys, b.keys);
    assert.deepEqual(a.diffs, b.diffs);
    assert.notDeepEqual(a.keys, c.keys);
  } finally { done(p); }
});

test('C7: a --budget below the bill stops early with honest counts, in stdout, JSON and the log', async () => {
  const p = await rig({ killed: 4 }, { default: ['fail'], cost: 2 });
  try {
    const j = run(p, ['verify', 'calibrate', '--defects', '4', '--runs', '3', '--seed', '5', '--budget', '5', '--yes', '--json']);
    assert.equal(stub(p).length, 2);
    assert.equal(j.stopped, 'budget');
    assert.deepEqual(j.completed, { trials: 2, planned_trials: 12, defects: 2 });
    assert.equal(j.spent_usd, 4);
    const h = run(p, ['verify', 'calibrate', '--defects', '4', '--runs', '3', '--seed', '5', '--budget', '5', '--yes']);
    assert.match(h, /stopped: budget/);
    assert.match(h, /ran 2 of 12 planned trials/);
    const log = readFileSync(join(p.dir, '.astrocode', 'CALIBRATION.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(log.map((r) => r.stopped), ['budget', 'budget']);
    assert.equal(stub(p).length, 4);
  } finally { done(p); }
});

test('C8a: 2 easy and 1 hard with --defects 10 gives real counts and too-few marks', async () => {
  const p = await rig({ tools: ['stryker'], killed: 2, testGap: 1, equivalent: 1, unjudged: 1 }, { default: ['fail'], cost: 1 });
  try {
    const j = run(p, ['verify', 'calibrate', '--defects', '10', '--runs', '2', '--yes', '--json']);
    assert.deepEqual(j.requested, { defects: 10, runs: 2 });
    assert.deepEqual(j.selected, { easy: 2, hard: 1 });
    assert.equal(new Set(j.defects.map((d) => d.key)).size, 3, 'nothing repeated or padded');
    assert.equal(j.completed.trials, 6);
    assert.deepEqual([j.sets.easy.too_few, j.sets.hard.too_few], [true, true]);
    const h = run(p, ['verify', 'calibrate', '--defects', '10', '--runs', '2', '--yes']);
    assert.match(h, /too few defects to rely on/);
  } finally { done(p); }
});

test('C8b: no test-gap survivors makes the hard rate unavailable, not 0%', async () => {
  const p = await rig({ tools: ['stryker'], killed: 4, testGap: 0, equivalent: 1, unjudged: 1 }, { default: ['fail'], cost: 1 });
  try {
    const j = run(p, ['verify', 'calibrate', '--defects', '4', '--runs', '1', '--yes', '--json']);
    assert.equal(j.selected.hard, 0);
    assert.match(j.sets.hard.unavailable, /no test-gap survivors/);
    assert.equal(j.sets.hard.defect_rate, null);
    assert.equal(j.sets.hard.trial_rate, null);
    assert.match(run(p, ['verify', 'calibrate', '--defects', '4', '--runs', '1', '--yes']), /hard unavailable/);
  } finally { done(p); }
});

test('C8c: Gremlins-only data says Gremlins is not supported, with or without a kept run', async () => {
  for (const noRuns of [false, true]) {
    const p = await rig({ tools: ['gremlins'], noRuns });
    try {
      for (const args of [['--yes'], ['--yes', '--json'], []]) {
        const out = run(p, ['verify', 'calibrate', ...args]);
        assert.match(typeof out === 'string' ? out : JSON.stringify(out), /Gremlins is not supported/);
      }
      assert.deepEqual(stub(p), []);
    } finally { done(p); }
  }
});

test('C9: two runs with the agent edited between give two records, the first untouched, the hashes differing, and numbers equal to stdout and JSON', async () => {
  const p = await rig({ killed: 4 }, { default: ['fail'], cost: 1 });
  try {
    mkdirSync(join(p.scratch, 'cfg', 'agents'), { recursive: true });
    const agent = join(p.scratch, 'cfg', 'agents', 'astro-verifier.md');
    const file = join(p.dir, '.astrocode', 'CALIBRATION.jsonl');
    const args = ['verify', 'calibrate', '--defects', '4', '--runs', '2', '--seed', '6', '--yes'];
    writeFileSync(agent, 'verifier prompt v1\n');
    const j1 = run(p, [...args, '--json']);
    const first = readFileSync(file, 'utf8');
    writeFileSync(agent, 'verifier prompt v2\n');
    const human = run(p, args);
    const lines = readFileSync(file, 'utf8');
    assert.ok(lines.startsWith(first), 'the first record is unchanged');
    const [r1, r2] = lines.trim().split('\n').map((l) => JSON.parse(l));
    assert.notEqual(r1.verifier.prompt_hash, r2.verifier.prompt_hash);
    assert.equal(r1.defect_set_hash, r2.defect_set_hash, 'same seed, comparable runs');
    for (const k of ['date', 'seed', 'sets', 'defects', 'completed', 'verifier', 'budget_usd', 'spent_usd']) assert.ok(k in r1, k);
    // the record is the run's own JSON, and the printed rates are the record's
    for (const k of Object.keys(r1)) assert.deepEqual(j1[k], r1[k], k);
    const pct = (x) => `${Math.round(x * 100)}%`;
    const d = r2.sets.easy.defect_rate;
    assert.ok(human.includes(`easy ${d.x}/${d.n} ${pct(d.p)} (${pct(d.lo)}–${pct(d.hi)})`));
    assert.ok(human.includes(`prompt ${r2.verifier.prompt_hash}`));
    assert.equal(sh(p.dir, 'check-ignore', '-q', '.astrocode/CALIBRATION.jsonl').status, 1);
    assert.equal(sh(p.dir, 'status', '--porcelain').stdout, '');
  } finally { done(p); }
});

test('producer to consumer: a real `ac mutate` run on an accepted phase feeds `ac verify calibrate`, which plants its killed mutant exactly', async () => {
  const { findPhase, setPhaseStatus } = await import('../lib/roadmap.mjs');
  const { plantChange } = await import('../lib/plant.mjs');
  const rep = JSON.parse(readFileSync(join(FX, 'stryker-triage.json'), 'utf8'));
  const p = await makeProject('js');
  try {
    writeFileSync(join(p.dir, 'src', 'a.mjs'), rep.files['src/a.mjs'].source);
    commit(p.dir, 'feat: real source (phase 1 t2)');
    installStub(p.dir, 'stryker', 'node_modules/.bin');
    writeFileSync(join(p.dir, 'rep.json'), JSON.stringify(rep));
    commit(p.dir, 'chore: fixture report');
    const slug = findPhase(p.dir, '1').slug;
    mkdirSync(join(p.dir, '.astrocode', 'phases', slug), { recursive: true });
    writeFileSync(join(p.dir, '.astrocode', 'phases', slug, 'CRITERIA.md'), '### C1 — works\n- **Observe:** run it\n\n### C2 — tidy\n- **Observe:** read it\n');
    await setPhaseStatus(p.dir, slug, 'complete');
    commit(p.dir, 'chore: phase 1 accepted');
    const mutEnv = restrictedEnv([], { MUTATE_STUB_REPORT: join(p.dir, 'rep.json') });
    p.scratch = null;
    attach(p, { default: ['fail'], cost: 1 }, mutEnv);
    const m = ac(p, ['mutate', '1', '--json']);
    assert.equal(m.status, 0, m.stderr);
    const j = run(p, ['verify', 'calibrate', '--defects', '1', '--runs', '1', '--seed', '1', '--yes', '--json']);
    assert.equal(j.defects.length, 1);
    assert.equal(j.defects[0].set, 'easy');
    assert.equal(j.defects[0].tool, 'stryker');
    const line = listLine(p, slug, j.defects[0].key);
    assert.equal(line.status, 'killed');
    const before = readFileSync(join(p.dir, line.file), 'utf8').split('\n');
    const after = plantChange(before.join('\n'), line).split('\n');
    const [rec] = stub(p);
    const plus = rec.changed[0].diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
    assert.deepEqual(plus, after.filter((l, n) => l !== before[n]));
    assert.equal(rec.changed.length, 1);
    assert.equal(rec.changed[0].file, 'src/a.mjs');
    assert.equal(existsSync(join(p.dir, '.astrocode', 'CALIBRATION.jsonl')), true);
  } finally { if (p.scratch) rmSync(p.scratch, { recursive: true, force: true }); rmSync(p.dir, { recursive: true, force: true }); }
});
