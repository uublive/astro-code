// Phase 52 t3 — the base, the targeted decision and the plan fields (amends ADR-079).
// Pure chooseMode cases need no git; planReverify cases use a real tmp repo. Dynamic imports (ADR-018).
// The base is seeded straight into VERDICT.json: the recorded targeted path lands in t4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const SLUG = '01-demo';
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const head = (cwd) => sh(cwd, 'rev-parse', 'HEAD').stdout.trim();
const put = (root, rel, body = 'x') => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const commit = (root, msg) => { sh(root, 'add', '-A'); sh(root, 'commit', '-q', '-m', msg); return head(root); };

const CRIT = [
  '# Criteria', '',
  '### C1 — a', '- **Observe:** read `src/a.mjs`', '',
  '### C2 — b', '- **Observe:** read `src/b.mjs`', '',
  '### C3 — c', '- **Observe:** read `src/c.mjs`', '',
  '### C4 [suite] — suite', '- **Observe:** the tests pass', '',
  '### C5 [mutation] — strength', '- **Observe:** mutate `src/m.mjs`', '',
  '### C6 — d', '- **Observe:** read `src/d.mjs`', '',
].join('\n');

function fixture(crit = CRIT) {
  const root = mkdtempSync(join(tmpdir(), 'vtarget-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  const dir = join(root, '.astrocode', 'phases', SLUG);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'CRITERIA.md'), crit);
  for (const f of ['a', 'b', 'c', 'd', 'm']) put(root, `src/${f}.mjs`);
  commit(root, 'init');
  // the phase's own stamped work: only these files are in the mutate scope
  put(root, 'src/m.mjs', 'v2');
  put(root, 'src/hidden.mjs');
  commit(root, 'feat: m (phase 01 t1)');
  return { root, dir, vfile: join(dir, 'VERDICT.json'), crit: join(dir, 'CRITERIA.md'), done: () => rmSync(root, { recursive: true, force: true }) };
}
const ids6 = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];

// Seed a verdict file as `ac verdict record` would have written it, then commit it like record does.
async function seed(s, { mode = 'full', run = 1, base = 'self', failed = [], marks = {}, extra = {}, crit } = {}) {
  const { criteriaHash } = await import('../lib/verdict.mjs');
  const text = readFileSync(s.crit, 'utf8');
  const commitSha = head(s.root);
  const ids = (crit ?? ids6);
  const v = {
    version: 1, run, mode, broad: false, commit: commitSha, criteria_sha: criteriaHash(text), at: 'x',
    base: base === 'self' ? { run, commit: commitSha } : base,
    criteria: ids.map((id) => ({ id, status: failed.includes(id) ? 'failed' : 'passed', evidence: 'observed', ...(marks[id] ?? {}) })),
    ...extra,
  };
  if (base === 'legacy') delete v.base;
  writeFileSync(s.vfile, JSON.stringify(v, null, 2));
  commit(s.root, `chore(verdict): phase 01 run ${run} — ${mode} PASS`);
  return v;
}

test('MAX_TARGETED_FILES and TARGETED_DENOMINATOR are exported integers', async () => {
  const m = await import('../lib/verdict.mjs');
  assert.ok(Number.isInteger(m.MAX_TARGETED_FILES) && m.MAX_TARGETED_FILES > 0);
  assert.ok(Number.isInteger(m.TARGETED_DENOMINATOR) && m.TARGETED_DENOMINATOR > 0);
});

test('after a full PASS a one-file follow-up plans targeted: the floor holds the criterion naming that file plus suite, every other id is carryable from the full PASS run and commit', async () => {
  const { planReverify } = await import('../lib/verdict.mjs');
  const s = fixture();
  try {
    const v = await seed(s);
    put(s.root, 'src/b.mjs', 'changed');
    commit(s.root, 'fix: b');
    const p = planReverify(s.root, SLUG);
    assert.equal(p.mode, 'targeted');
    assert.match(p.reason, /2 of 6 criteria affected since full PASS at [0-9a-f]{7} \(run 1\)/);
    assert.deepEqual(p.floor, ['C2', 'C4']);
    assert.deepEqual(p.carry, ['C1', 'C3', 'C5', 'C6'].map((id) => ({ id, from: { run: 1, commit: v.commit } })));
    assert.deepEqual(p.base, { run: 1, commit: v.commit });
    assert.equal(p.range, `${v.commit}..HEAD`);
    assert.deepEqual(p.changed, ['src/b.mjs']);
    assert.deepEqual(p.unmapped_files, []);
    assert.match(p.why.C2, /named file changed: src\/b\.mjs/);
    assert.match(p.why.C4, /suite criterion/);
    assert.deepEqual(p.first, []);
    assert.equal(p.total, 6);
  } finally { s.done(); }
});

test('planReverify prints byte-identical JSON on two runs of the same tree', async () => {
  const { planReverify } = await import('../lib/verdict.mjs');
  const s = fixture();
  try {
    await seed(s);
    put(s.root, 'src/b.mjs', 'changed');
    commit(s.root, 'fix: b');
    assert.equal(JSON.stringify(planReverify(s.root, SLUG)), JSON.stringify(planReverify(s.root, SLUG)));
  } finally { s.done(); }
});

test('first verify, FAIL-only history, a targeted verdict with no base, a non-ancestor base, a broad diff (files and criteria), an every-criterion floor, a no-criterion-touched diff, a CRITERIA edit and --full each go full with a distinct reason', async () => {
  const { planReverify } = await import('../lib/verdict.mjs');
  const reasons = {};
  const note = (k, p) => { assert.equal(p.mode, 'full', `${k}: ${p.reason}`); assert.deepEqual(p.carry, [], k); reasons[k] = p.reason; };
  const s = fixture();
  try {
    note('first', planReverify(s.root, SLUG));
    // FAIL-only: too many unmet to narrow
    await seed(s, { failed: ['C1', 'C2', 'C3', 'C4'] });
    note('failonly', planReverify(s.root, SLUG));
    // targeted verdict with no base
    await seed(s, { mode: 'targeted', run: 2, base: null });
    put(s.root, 'src/b.mjs', 'changed');
    commit(s.root, 'fix: b');
    note('nobase', planReverify(s.root, SLUG));
    // non-ancestor base
    await seed(s, { run: 3, base: { run: 3, commit: '0'.repeat(40) } });
    note('nonancestor', planReverify(s.root, SLUG));
    // good base, one-file diff, --full
    await seed(s, { run: 4 });
    put(s.root, 'src/c.mjs', 'changed');
    commit(s.root, 'fix: c');
    assert.equal(planReverify(s.root, SLUG).mode, 'targeted');
    note('full', planReverify(s.root, SLUG, { full: true }));
    // broad by criteria: 4 of 6 named files change
    put(s.root, 'src/a.mjs', 'changed');
    put(s.root, 'src/b.mjs', 'again');
    put(s.root, 'src/d.mjs', 'changed');
    commit(s.root, 'fix: many');
    note('broadcrit', planReverify(s.root, SLUG));
    // broad by files
    await seed(s, { run: 5 });
    for (let i = 0; i < 21; i++) put(s.root, `docs/f${i}.md`);
    commit(s.root, 'docs: lots');
    note('broadfiles', planReverify(s.root, SLUG));
    // CRITERIA edit
    await seed(s, { run: 6 });
    writeFileSync(s.crit, `${CRIT}\n`);
    note('critedit', planReverify(s.root, SLUG));
  } finally { s.done(); }
  assert.equal(new Set(Object.values(reasons)).size, Object.keys(reasons).length, JSON.stringify(reasons));
  assert.match(reasons.broadfiles, /broad diff: 21 files/);
  assert.match(reasons.broadcrit, /broad diff: 4 of 6 criteria affected/);

  // every criterion in the floor: C6 names no file, so it is always observed
  const crit = CRIT.replace('read `src/d.mjs`', 'read the docs');
  const t = fixture(crit);
  try {
    await seed(t);
    for (const f of ['a', 'b', 'c']) put(t.root, `src/${f}.mjs`, 'changed');
    put(t.root, 'src/hidden.mjs', 'changed');
    commit(t.root, 'fix: abc (phase 01 t2)');
    const p = planReverify(t.root, SLUG);
    assert.equal(p.mode, 'full');
    assert.match(p.reason, /every criterion is in the floor/);
  } finally { t.done(); }

  // a diff that touches no criterion's files (no suite, no unmapped, no mutation)
  const plain = '### C1 — a\n- **Observe:** `src/a.mjs`\n\n### C2 — b\n- **Observe:** `src/b.mjs`\n\n### C3 — c\n- **Observe:** `src/c.mjs`\n';
  const u = fixture(plain);
  try {
    await seed(u, { crit: ['C1', 'C2', 'C3'] });
    put(u.root, 'docs/x.md');
    commit(u.root, 'docs: x');
    const p = planReverify(u.root, SLUG);
    assert.equal(p.mode, 'full');
    assert.match(p.reason, /touches no criterion/);
  } finally { u.done(); }
});

test('a latest FAIL after a full PASS still narrows exactly as ADR-079 (first = unmet ids, carry = [])', async () => {
  const { planReverify } = await import('../lib/verdict.mjs');
  const s = fixture();
  try {
    await seed(s, { failed: ['C2'], base: { run: 1, commit: head(s.root) } });
    put(s.root, 'src/b.mjs', 'changed');
    commit(s.root, 'fix: b');
    const p = planReverify(s.root, SLUG);
    assert.equal(p.mode, 'narrowed');
    assert.deepEqual(p.first, ['C2']);
    assert.deepEqual(p.carry, []);
    assert.deepEqual(p.floor, []);
    assert.equal(p.reason, '1 of 6 unmet');
  } finally { s.done(); }
});

test('the base survives a narrowed record, a full FAIL ends it, and carries never cite a targeted run and carries never cite a targeted run', async () => {
  const { recordVerdict, planReverify } = await import('../lib/verdict.mjs');
  const s = fixture(CRIT.replace('[mutation] ', ''));
  try {
    const res = (failed = [], mode = 'full', only) => ({
      mode, criteria: (only ?? ids6).map((id) => ({ id, passed: !failed.includes(id) })),
    });
    const r1 = await recordVerdict(s.root, SLUG, res());
    const f1 = JSON.parse(readFileSync(s.vfile, 'utf8'));
    assert.deepEqual(f1.base, { run: 1, commit: r1.commit });
    assert.ok(f1.criteria.every((c) => c.evidence === 'observed'));
    put(s.root, 'src/a.mjs', 'changed');
    commit(s.root, 'fix: a');
    await recordVerdict(s.root, SLUG, res(['C2']));
    assert.equal(JSON.parse(readFileSync(s.vfile, 'utf8')).base, null); // a full FAIL ends the base
    await recordVerdict(s.root, SLUG, res([], 'narrowed', ['C2']));
    const n = JSON.parse(readFileSync(s.vfile, 'utf8'));
    assert.equal(n.base, null); // narrowed copies it forward
    put(s.root, 'src/d.mjs', 'changed');
    commit(s.root, 'fix: d');
    assert.equal(planReverify(s.root, SLUG).mode, 'full'); // no carry across the FAIL
    assert.equal(n.criteria.find((c) => c.id === 'C1').evidence, 'carried');
    // a seeded targeted run does not become the base; a later record copies the base forward
    await seed(s, { mode: 'targeted', run: 4, base: f1.base });
    put(s.root, 'src/c.mjs', 'changed');
    commit(s.root, 'fix: c');
    const p = planReverify(s.root, SLUG);
    assert.equal(p.mode, 'targeted');
    assert.ok(p.carry.every((c) => c.from.run === 1 && c.from.commit === r1.commit));
    await recordVerdict(s.root, SLUG, res(['C1']));
    assert.equal(JSON.parse(readFileSync(s.vfile, 'utf8')).base, null); // full FAIL after targeted
    // a second full PASS becomes the base
    const r6 = await recordVerdict(s.root, SLUG, res());
    assert.deepEqual(JSON.parse(readFileSync(s.vfile, 'utf8')).base, { run: r6.run, commit: r6.commit });
  } finally { s.done(); }
});

test('a legacy full PASS without a base key is a base', async () => {
  const { planReverify, baseOf } = await import('../lib/verdict.mjs');
  const s = fixture();
  try {
    const v = await seed(s, { base: 'legacy' });
    assert.equal('base' in v, false);
    assert.deepEqual(baseOf(v), { run: 1, commit: v.commit });
    assert.equal(baseOf({ ...v, mode: 'narrowed' }), null);
    assert.equal(baseOf({ ...v, criteria: [{ id: 'C1', status: 'failed' }] }), null);
    assert.equal(baseOf({ ...v, base: null }), null);
    assert.equal(baseOf(null), null);
    put(s.root, 'src/b.mjs', 'changed');
    commit(s.root, 'fix: b');
    const p = planReverify(s.root, SLUG);
    assert.equal(p.mode, 'targeted');
    assert.deepEqual(p.base, { run: 1, commit: v.commit });
  } finally { s.done(); }
});

test('a [mutation] or sticky test_strength criterion is in the floor when a stamped file changed and carryable when only an unstamped file changed', async () => {
  const { planReverify } = await import('../lib/verdict.mjs');
  const s = fixture();
  try {
    await seed(s, { marks: { C6: { test_strength: true } } });
    put(s.root, 'docs/x.md');
    commit(s.root, 'docs: x');
    const a = planReverify(s.root, SLUG);
    assert.equal(a.mode, 'targeted');
    assert.deepEqual(a.floor, ['C4']);
    assert.ok(a.carry.some((c) => c.id === 'C5') && a.carry.some((c) => c.id === 'C6'));
    // a stamped file the criteria do not name changes
    put(s.root, 'src/hidden.mjs', 'changed');
    commit(s.root, 'feat: hidden (phase 01 t2)');
    const b = planReverify(s.root, SLUG);
    assert.equal(b.mode, 'targeted');
    assert.deepEqual(b.floor, ['C4', 'C5', 'C6']);
    assert.match(b.why.C5, /test-strength: mutate scope changed \(src\/hidden\.mjs\)/);
    assert.deepEqual(b.unmapped_files, ['docs/x.md', 'src/hidden.mjs']);
  } finally { s.done(); }
});

test('an unmapped criterion is always in the floor', async () => {
  const { planReverify } = await import('../lib/verdict.mjs');
  const s = fixture(CRIT.replace('read `src/d.mjs`', 'read the docs'));
  try {
    await seed(s);
    put(s.root, 'src/b.mjs', 'changed');
    commit(s.root, 'fix: b');
    const p = planReverify(s.root, SLUG);
    assert.equal(p.mode, 'targeted');
    assert.deepEqual(p.floor, ['C2', 'C4', 'C6']);
    assert.match(p.why.C6, /names no files/);
  } finally { s.done(); }
});

test('a sticky suite mark puts an untagged criterion in the floor', async () => {
  const { planReverify } = await import('../lib/verdict.mjs');
  const s = fixture();
  try {
    await seed(s, { marks: { C3: { suite: true } } });
    put(s.root, 'src/b.mjs', 'changed');
    commit(s.root, 'fix: b');
    const p = planReverify(s.root, SLUG);
    assert.deepEqual(p.floor, ['C2', 'C3', 'C4']);
  } finally { s.done(); }
});

test('readVerdict accepts targeted, evidence, suite and base and still refuses unknown modes', async () => {
  const { readVerdict } = await import('../lib/verdict.mjs');
  const s = fixture();
  try {
    const ok = {
      version: 1, run: 2, mode: 'targeted', commit: 'abc1234', base: { run: 1, commit: 'abc1234' },
      criteria: [{ id: 'C1', status: 'carried', last: 'passed', evidence: 'carried', suite: true, from: { run: 1, commit: 'abc1234' } }],
    };
    writeFileSync(s.vfile, JSON.stringify(ok));
    assert.equal(readVerdict(s.vfile).verdict.mode, 'targeted');
    writeFileSync(s.vfile, JSON.stringify({ ...ok, base: null }));
    assert.ok(readVerdict(s.vfile).verdict);
    for (const bad of [
      { ...ok, mode: 'weird' },
      { ...ok, base: { run: 'x' } },
      { ...ok, criteria: [{ id: 'C1', status: 'passed', evidence: 'guessed' }] },
      { ...ok, criteria: [{ id: 'C1', status: 'passed', suite: 'yes' }] },
    ]) {
      writeFileSync(s.vfile, JSON.stringify(bad));
      assert.equal(readVerdict(s.vfile).verdict, null);
    }
    // legacy entries without evidence stay valid
    writeFileSync(s.vfile, JSON.stringify({ ...ok, mode: 'full', criteria: [{ id: 'C1', status: 'passed' }] }));
    assert.ok(readVerdict(s.vfile).verdict);
  } finally { s.done(); }
});

test('chooseMode keeps rule order: a FAIL beats targeting, and a missing diff or base goes full with its own reason', async () => {
  const { chooseMode } = await import('../lib/verdict.mjs');
  const verdict = { version: 1, run: 1, mode: 'full', commit: 'abc1234', criteria_sha: 'h', criteria: ids6.map((id) => ({ id, status: 'passed' })) };
  const t = (over = {}) => chooseMode({
    full: false, ids: ids6, verdict, hash: 'h', ancestor: true,
    base: { run: 1, commit: 'abc1234' }, baseAncestor: true, changed: ['src/b.mjs'],
    paths: new Map(ids6.map((id) => [id, [`src/${id}.mjs`]])), suite: [], strength: [], scope: [], ...over,
  });
  assert.equal(t({ paths: new Map(ids6.map((id) => [id, [id === 'C2' ? 'src/b.mjs' : `src/${id}.mjs`]])) }).mode, 'targeted');
  const failing = { ...verdict, criteria: verdict.criteria.map((c) => (c.id === 'C1' ? { ...c, status: 'failed' } : c)) };
  assert.equal(t({ verdict: failing }).mode, 'narrowed');
  const rs = [t({ base: null }), t({ baseAncestor: false }), t({ changed: null }), t({ changed: undefined })].map((d) => { assert.equal(d.mode, 'full'); return d.reason; });
  assert.equal(new Set(rs).size, 3); // changed null and undefined share one reason
});

test('a targeted FAIL ends the base too: after it and a narrowed fix, the plan goes full and a targeted record cannot pass (C10)', async () => {
  const { recordVerdict, planReverify } = await import('../lib/verdict.mjs');
  const s = fixture(CRIT.replace('[mutation] ', '').replace('[suite] ', ''));
  try {
    // C2 names src/b.mjs; C4 names no file, so it is always in the floor and always observed
    const targeted = (failC2) => ({ mode: 'targeted', criteria: ids6.map((id) => (id === 'C2' ? { id, passed: !failC2 } : id === 'C4' ? { id, passed: true } : { id, carried: true })) });
    await recordVerdict(s.root, SLUG, { mode: 'full', criteria: ids6.map((id) => ({ id, passed: true })) });
    put(s.root, 'src/b.mjs', 'v2');
    commit(s.root, 'fix: b');
    assert.deepEqual(planReverify(s.root, SLUG).floor, ['C2', 'C4']);
    const t = await recordVerdict(s.root, SLUG, targeted(true));
    assert.equal(t.passed, false);
    assert.equal(t.base, null); // a targeted FAIL ends the base
    put(s.root, 'src/b.mjs', 'v3');
    commit(s.root, 'fix: b again');
    const n = await recordVerdict(s.root, SLUG, { mode: 'narrowed', criteria: [{ id: 'C2', passed: true }] });
    assert.equal(n.base, null);
    const p = planReverify(s.root, SLUG);
    assert.equal(p.mode, 'full'); // no carry reaches across the targeted FAIL
    const again = await recordVerdict(s.root, SLUG, targeted(false));
    assert.equal(again.passed, false);
  } finally { s.done(); }
});
