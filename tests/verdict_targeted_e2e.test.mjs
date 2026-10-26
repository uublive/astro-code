// Phase 52 t9 — end-to-end targeted-verify scenarios through the shipped CLI verbs, one test per
// criterion of the phase (C1 to C12). Test-after, chosen explicitly: it only drives `ac`.
// A full PASS is seeded straight into VERDICT.json (a recorded one would need mutation evidence for
// the [mutation] criterion); everything after it goes through `ac verdict`, `ac suite`, `ac phase`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase } from '../lib/roadmap.mjs';
import { criteriaHash } from '../lib/verdict.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const ac = (cwd, ...a) => spawnSync(process.execPath, [AC, ...a], { cwd, encoding: 'utf8' });
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const head = (cwd) => sh(cwd, 'rev-parse', 'HEAD').stdout.trim();
const OK = 'node -e "process.exit(0)"';

const FILE = { C1: 'src/a.mjs', C2: 'src/b.mjs', C3: 'src/c.mjs', C4: 'src/d.mjs', C5: 'src/e.mjs', C6: 'src/f.mjs', C8: 'src/m.mjs' };
const IDS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'];
const CRITERIA = IDS.map((id) => {
  if (id === 'C7') return '### C7 [suite] — the suite passes\n- **Observe:** `npm test` exits 0\n';
  if (id === 'C8') return '### C8 [mutation] — the tests are strong\n- **Observe:** `ac mutate` on `src/m.mjs`\n';
  return `### ${id} — thing\n- **Observe:** read \`${FILE[id]}\`\n`;
}).join('\n');

const put = (dir, rel, body) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), body); };
const commit = (dir, msg) => { sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', msg); return head(dir); };
const change = (p, rel, msg = `fix ${rel}`) => { put(p.dir, rel, `v${Math.random()}`); return commit(p.dir, msg); };

async function project() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-vt-e2e-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'e2e' });
  await addPhase(dir, { number: 1, name: 'Do a thing' });
  const ph = findPhase(dir, '1');
  const pdir = join(dir, '.astrocode', 'phases', ph.slug);
  writeFileSync(join(pdir, 'CRITERIA.md'), CRITERIA);
  for (const f of Object.values(FILE)) put(dir, f, 'x');
  commit(dir, 'init');
  // the phase's own stamped work: only these files are in the mutate scope
  put(dir, 'src/m.mjs', 'v2');
  put(dir, 'src/hidden.mjs', 'x');
  commit(dir, 'feat: m (phase 01 t1)');
  return { dir, pdir, vfile: join(pdir, 'VERDICT.json'), done: () => rmSync(dir, { recursive: true, force: true }) };
}
const readV = (p) => JSON.parse(readFileSync(p.vfile, 'utf8'));
// A full PASS as `ac verdict record` would have written it, then committed the way it does.
function seedFull(p, { run = 1, commitSha = head(p.dir), failed = [], marks = { C8: { test_strength: true } }, mode = 'full', base = 'self' } = {}) {
  const v = {
    version: 1, run, mode, reason: 'seeded', broad: false, commit: commitSha,
    criteria_sha: criteriaHash(readFileSync(join(p.pdir, 'CRITERIA.md'), 'utf8')), at: 'x',
    base: base === 'self' ? { run, commit: commitSha } : base,
    criteria: IDS.map((id) => ({ id, status: failed.includes(id) ? 'failed' : 'passed', evidence: 'observed', ...(marks[id] ?? {}) })),
  };
  writeFileSync(p.vfile, JSON.stringify(v, null, 2));
  commit(p.dir, `chore(verdict): phase 01 run ${run} — ${mode} seed`);
  return v;
}
const plan = (p, ...extra) => ac(p.dir, 'verdict', 'plan', '1', '--json', ...extra);
const planJ = (p, ...extra) => { const r = plan(p, ...extra); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
const obs = (ids, failed = []) => ids.map((id) => ({ id, passed: !failed.includes(id) }));
const rec = (p, criteria, mode = 'targeted') => {
  const r = ac(p.dir, 'verdict', 'record', '1', '--result', JSON.stringify({ mode, criteria }));
  assert.equal(r.status, 0, r.stderr);
  return { out: JSON.parse(r.stdout), stderr: r.stderr };
};
const status = (p) => JSON.parse(ac(p.dir, 'phase', 'show', '1').stdout).status;

test('C1: targeted after a one-file follow-up, deterministic, with the human line', async () => {
  const p = await project();
  try {
    const f1 = seedFull(p);
    change(p, FILE.C2);
    const a = plan(p).stdout;
    assert.equal(a, plan(p).stdout);
    const j = JSON.parse(a);
    assert.equal(j.mode, 'targeted');
    assert.deepEqual(j.floor, ['C2', 'C7']);
    assert.deepEqual(j.carry.map((c) => c.id), ['C1', 'C3', 'C4', 'C5', 'C6', 'C8']);
    assert.ok(j.carry.every((c) => c.from.run === 1 && c.from.commit === f1.commit));
    assert.equal(ac(p.dir, 'verdict', 'plan', '1').stdout.trim(), `• targeted: 2 of 8 criteria affected since full PASS at ${f1.commit.slice(0, 7)} (run 1): re-check C2, C7; carry 6`);
  } finally { p.done(); }
});

test('C2: first verify, no full PASS, a broad diff, a moved base and --full each run full with their own reason; --fulll is refused', async () => {
  const reasons = {};
  const full = (k, j) => { assert.equal(j.mode, 'full', `${k}: ${j.reason}`); assert.deepEqual(j.carry, [], k); reasons[k] = j.reason; };
  let p = await project();
  try {
    full('first', planJ(p));
    seedFull(p, { failed: ['C1', 'C2', 'C3', 'C4'] });
    full('failonly', planJ(p));
    seedFull(p, { mode: 'targeted', run: 2, base: null });
    change(p, FILE.C2);
    full('nobase', planJ(p));
    seedFull(p, { run: 3 });
    change(p, FILE.C3);
    assert.equal(planJ(p).mode, 'targeted');
    full('flag', planJ(p, '--full'));
    for (const f of [FILE.C1, FILE.C2, FILE.C4, FILE.C5]) change(p, f);
    full('broadcrit', planJ(p));
    const typo = ac(p.dir, 'verdict', 'plan', '1', '--fulll');
    assert.notEqual(typo.status, 0);
    assert.match(typo.stderr, /unknown flag/);
  } finally { p.done(); }
  p = await project();
  try {
    // a base that is no longer an ancestor of HEAD: the full PASS graded a sibling branch's commit
    const main = sh(p.dir, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim();
    sh(p.dir, 'checkout', '-q', '-b', 'side');
    const z = change(p, 'side.txt', 'side work');
    sh(p.dir, 'checkout', '-q', main);
    seedFull(p, { commitSha: z });
    change(p, FILE.C2);
    full('moved', planJ(p));
    // broad by files
    seedFull(p, { run: 2 });
    for (let i = 0; i < 21; i++) put(p.dir, `docs/f${i}.md`, 'x');
    commit(p.dir, 'docs: lots');
    full('broadfiles', planJ(p));
  } finally { p.done(); }
  assert.equal(new Set(Object.values(reasons)).size, Object.keys(reasons).length, JSON.stringify(reasons));
});

test('C3: the verifier may widen the floor but a skipped floor criterion is refused, named, and the phase is not verified', async () => {
  const p = await project();
  try {
    seedFull(p);
    change(p, FILE.C2);
    const good = rec(p, obs(['C2', 'C7', 'C1']));
    assert.equal(good.out.passed, true);
    assert.equal(ac(p.dir, 'phase', 'verify', '1').status, 0);
    assert.equal(status(p), 'verified');
  } finally { p.done(); }
  const q = await project();
  try {
    seedFull(q);
    change(q, FILE.C2);
    const bad = rec(q, [...obs(['C7']), { id: 'C2', carried: true }]);
    assert.equal(bad.out.passed, false);
    assert.match(bad.stderr, /C2 refused: in the floor/);
    const v = ac(q.dir, 'phase', 'verify', '1');
    assert.notEqual(v.status, 0);
    assert.match(v.stderr, /C2/);
    assert.notEqual(status(q), 'verified');
  } finally { q.done(); }
});

test('C4: carries cite the most recent full PASS, never a targeted run, an older PASS or a non-ancestor', async () => {
  const p = await project();
  try {
    const f1 = seedFull(p);
    change(p, FILE.C2);
    const t1 = rec(p, obs(['C2', 'C7'])).out;
    assert.equal(t1.passed, true);
    const t1File = readFileSync(p.vfile, 'utf8');
    change(p, FILE.C3);
    const j = planJ(p);
    assert.ok(j.carry.every((c) => c.from.run === 1 && c.from.commit === f1.commit), 'carries cite F1, not T1');
    const cite = (from) => rec(p, [...obs(['C3', 'C7']), { id: 'C1', carried: true, from }]).out;
    assert.equal(cite({ run: 2, commit: t1.commit }).passed, false);
    writeFileSync(p.vfile, t1File);
    assert.equal(cite({ run: 1, commit: '0'.repeat(40) }).passed, false);
    writeFileSync(p.vfile, t1File);
    const f2 = seedFull(p, { run: 3 });
    change(p, FILE.C1);
    assert.ok(planJ(p).carry.every((c) => c.from.run === 3 && c.from.commit === f2.commit), 'carries cite F2 now');
    const f2File = readFileSync(p.vfile, 'utf8');
    const old = rec(p, [...obs(['C1', 'C7']), { id: 'C2', carried: true, from: { run: 1, commit: f1.commit } }]).out;
    assert.equal(old.passed, false);
    writeFileSync(p.vfile, f2File);
    assert.equal(rec(p, [...obs(['C1', 'C7']), { id: 'C2', carried: true, from: { run: 3, commit: f2.commit } }]).out.passed, true);
  } finally { p.done(); }
});

test('C5: a criterion whose named file changed is never carried and both sit in the floor', async () => {
  const p = await project();
  try {
    seedFull(p);
    change(p, FILE.C2);
    change(p, FILE.C3);
    assert.deepEqual(planJ(p).floor, ['C2', 'C3', 'C7']);
    const r = rec(p, [...obs(['C2', 'C7']), { id: 'C3', carried: true }]);
    assert.equal(r.out.passed, false);
    assert.deepEqual(r.out.refused.map((x) => x.id), ['C3']);
    assert.notEqual(ac(p.dir, 'phase', 'verify', '1').status, 0);
  } finally { p.done(); }
});

test('C6: a suite criterion is in the floor, refused when carried, and accepted once a receipt is cited', async () => {
  const p = await project();
  try {
    seedFull(p);
    change(p, 'docs/unrelated.md');
    const j = planJ(p);
    assert.deepEqual(j.floor, ['C7']);
    assert.match(j.why.C7, /suite criterion/);
    const before = readFileSync(p.vfile, 'utf8');
    const no = rec(p, [{ id: 'C7', carried: true }]);
    assert.equal(no.out.passed, false);
    writeFileSync(p.vfile, before);
    const run = ac(p.dir, 'suite', 'run', '--command', OK, '--json');
    assert.equal(run.status, 0, run.stderr);
    const key = JSON.parse(run.stdout).key;
    const ok = rec(p, [{ id: 'C7', carried: true, receipt: key }]);
    assert.equal(ok.out.passed, true, JSON.stringify(ok.out.refused));
    const e = readV(p).criteria.find((c) => c.id === 'C7');
    assert.equal(e.receipt.key, key);
    assert.equal(e.from, undefined);
    assert.equal(ac(p.dir, 'phase', 'verify', '1').status, 0);
  } finally { p.done(); }
});

test('C7: a receipt is reused only on the identical clean tree, the same command and a passing exit', async () => {
  const p = await project();
  try {
    const q = (cmd) => JSON.parse(ac(p.dir, 'suite', 'receipt', '--command', cmd, '--json').stdout);
    ac(p.dir, 'suite', 'run', '--command', OK);
    assert.equal(q(OK).reusable, true); // (a)
    const r = q(OK).receipt;
    for (const k of ['command', 'commit', 'clean', 'exit', 'at']) assert.ok(r[k] !== undefined, k);
    put(p.dir, FILE.C1, 'edited');
    assert.equal(q(OK).reusable, false); // (b)
    sh(p.dir, 'checkout', '--', FILE.C1);
    put(p.dir, 'src/untracked.mjs', 'x');
    assert.equal(q(OK).reusable, false); // (c)
    rmSync(join(p.dir, 'src/untracked.mjs'));
    assert.equal(q(`${OK} `).reusable, false); // (e)
    ac(p.dir, 'suite', 'run', '--command', 'node -e "process.exit(2)"');
    assert.equal(q('node -e "process.exit(2)"').reusable, false); // (f)
    // a receipt written on a dirty tree is never offered, even once clean again
    put(p.dir, FILE.C2, 'dirty');
    ac(p.dir, 'suite', 'run', '--command', 'node -e "process.exit(0);"');
    sh(p.dir, 'checkout', '--', FILE.C2);
    assert.equal(q('node -e "process.exit(0);"').reusable, false);
    change(p, FILE.C3);
    assert.equal(q(OK).reusable, false); // (d)
  } finally { p.done(); }
});

test('C8: a test-strength criterion (tagged or sticky) is in the floor only when its mutate scope changed', async () => {
  const p = await project();
  try {
    seedFull(p, { marks: { C8: { test_strength: true }, C6: { test_strength: true } } });
    change(p, 'docs/x.md');
    const out = planJ(p);
    assert.deepEqual(out.floor, ['C7']);
    assert.ok(out.carry.some((c) => c.id === 'C8') && out.carry.some((c) => c.id === 'C6'));
    change(p, 'src/hidden.mjs', 'feat: hidden (phase 01 t2)');
    const inScope = planJ(p);
    assert.deepEqual(inScope.floor, ['C6', 'C7', 'C8']);
    assert.match(inScope.why.C6, /test-strength: mutate scope changed \(src\/hidden\.mjs\)/);
    const bad = rec(p, [...obs(['C7']), { id: 'C6', carried: true }, { id: 'C8', carried: true }]);
    assert.equal(bad.out.passed, false);
    assert.deepEqual(bad.out.refused.map((x) => x.id), ['C6', 'C8']);
  } finally { p.done(); }
});

test('C9 and C11: a valid targeted PASS verifies the phase with a per-criterion verdict; a targeted FAIL is saved and the next plan narrows (C10)', async () => {
  const p = await project();
  try {
    const f1 = seedFull(p);
    change(p, FILE.C2);
    const before = readFileSync(p.vfile, 'utf8');
    // a targeted FAIL
    const fail = rec(p, obs(['C2', 'C7'], ['C2'])).out;
    assert.equal(fail.passed, false);
    assert.notEqual(ac(p.dir, 'phase', 'verify', '1').status, 0);
    const n = planJ(p);
    assert.equal(n.mode, 'narrowed'); // C10: ADR-079 untouched
    assert.deepEqual(n.first, ['C2']);
    assert.deepEqual(n.carry, []);
    assert.deepEqual(n.floor, []);
    // the valid pass
    writeFileSync(p.vfile, before);
    const ok = rec(p, obs(['C2', 'C7'])).out;
    assert.equal(ok.passed, true);
    assert.equal(ac(p.dir, 'phase', 'verify', '1').status, 0);
    assert.equal(status(p), 'verified');
    const v = readV(p);
    assert.equal(v.mode, 'targeted');
    assert.match(v.reason, /^2 of 8 criteria affected since full PASS at /);
    assert.deepEqual(v.base, { run: 1, commit: f1.commit });
    assert.deepEqual(v.criteria.map((c) => c.id), IDS);
    for (const c of v.criteria) {
      assert.ok(['observed', 'carried'].includes(c.evidence), c.id);
      if (c.evidence === 'carried') assert.deepEqual(c.from, { run: 1, commit: f1.commit });
    }
  } finally { p.done(); }
});

test('C12: ac phase show lists each carried criterion with run and commit, and has no carried key after a full PASS', async () => {
  const p = await project();
  try {
    const f1 = seedFull(p);
    assert.equal('carried' in JSON.parse(ac(p.dir, 'phase', 'show', '1').stdout), false);
    change(p, FILE.C2);
    assert.equal(rec(p, obs(['C2', 'C7'])).out.passed, true);
    const shown = JSON.parse(ac(p.dir, 'phase', 'show', '1').stdout);
    assert.deepEqual(shown.carried.map((c) => c.id), ['C1', 'C3', 'C4', 'C5', 'C6', 'C8']);
    assert.ok(shown.carried.every((c) => c.from.run === 1 && c.from.commit === f1.commit));
    assert.equal(shown.status !== undefined, true);
  } finally { p.done(); }
});
