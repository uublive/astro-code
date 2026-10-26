// Phase 52 t4 — recording a targeted verdict, the amended gate and carriedOf (amends ADR-079).
// Real tmp git; receipts come from `runSuite` with a `node -e` command. Dynamic imports (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
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

const CRIT = (mutation = '') => [
  '# Criteria', '',
  '### C1 — a', '- **Observe:** read `src/a.mjs`', '',
  '### C2 — b', '- **Observe:** read `src/b.mjs`', '',
  '### C3 — c', '- **Observe:** read `src/c.mjs`', '',
  '### C4 [suite] — suite', '- **Observe:** `node -e "process.exit(0)"` exits 0', '',
  `### C5 ${mutation}— strength`, '- **Observe:** mutate `src/m.mjs`', '',
  '### C6 — d', '- **Observe:** read `src/d.mjs`', '',
].join('\n');
const ids6 = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];
const OK = 'node -e "process.exit(0)"';

function fixture(crit = CRIT()) {
  const root = mkdtempSync(join(tmpdir(), 'vrecord-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  const dir = join(root, '.astrocode', 'phases', SLUG);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'CRITERIA.md'), crit);
  for (const f of ['a', 'b', 'c', 'd', 'm']) put(root, `src/${f}.mjs`);
  commit(root, 'init');
  put(root, 'src/m.mjs', 'v2');
  put(root, 'src/hidden.mjs');
  commit(root, 'feat: m (phase 01 t1)');
  return { root, vfile: join(dir, 'VERDICT.json'), done: () => rmSync(root, { recursive: true, force: true }) };
}
const obs = (ids, failed = []) => ids.map((id) => ({ id, passed: !failed.includes(id) }));
const carry = (ids, extra = {}) => ids.map((id) => ({ id, carried: true, ...extra }));
const readV = (s) => JSON.parse(readFileSync(s.vfile, 'utf8'));
const mods = async () => ({ ...(await import('../lib/verdict.mjs')), ...(await import('../lib/receipts.mjs')) });
async function fullPass(s) {
  const { recordVerdict } = await mods();
  const r = await recordVerdict(s.root, SLUG, { mode: 'full', criteria: obs(ids6) });
  assert.equal(r.passed, true);
  return r;
}
// A refused record is SAVED as a FAIL (so the next plan narrows); tests that try several records
// from one state put the verdict file back between attempts.
const snap = (s) => readFileSync(s.vfile, 'utf8');
const restore = (s, text) => writeFileSync(s.vfile, text);
const change = (s, file, msg = 'fix') => { put(s.root, file, `v${Math.random()}`); return commit(s.root, msg); };

test('a targeted PASS that observes the floor plus one extra and carries the rest is passed and verifiedGate accepts it', async () => {
  const { recordVerdict, verifiedGate } = await mods();
  const s = fixture();
  try {
    const f1 = await fullPass(s);
    change(s, 'src/b.mjs');
    // C2 and C4 are the floor; C1 is an extra; C3 is carried explicitly, C5 and C6 implicitly
    const out = await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: [...obs(['C2', 'C4', 'C1']), ...carry(['C3'], { from: { run: 1, commit: f1.commit } })] });
    assert.equal(out.passed, true);
    assert.equal(out.mode, 'targeted');
    assert.deepEqual(out.floor, ['C2', 'C4']);
    assert.equal(out.observed, 3);
    assert.equal(out.carried, 3);
    assert.deepEqual(out.refused ?? [], []);
    assert.deepEqual(verifiedGate(s.root, SLUG), { ok: true, reason: null });
    assert.match(sh(s.root, 'log', '-1', '--format=%s').stdout, /chore\(verdict\): phase 01 run 2 — targeted PASS/);
  } finally { s.done(); }
});

test('a floor criterion omitted or carried is saved failed with a refusal naming it, and the gate refuses', async () => {
  const { recordVerdict, verifiedGate } = await mods();
  const s = fixture();
  try {
    await fullPass(s);
    change(s, 'src/b.mjs');
    const before = snap(s);
    for (const criteria of [[...obs(['C4']), ...carry(['C2'])], obs(['C4'])]) {
      const out = await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria });
      assert.equal(out.passed, false);
      assert.deepEqual(out.refused.map((r) => r.id), ['C2']);
      assert.match(out.refused[0].reason, /in the floor \(named file changed: src\/b\.mjs\) — must be observed/);
      const e = readV(s).criteria.find((c) => c.id === 'C2');
      assert.equal(e.status, 'failed');
      assert.match(e.refused, /must be observed/);
      const g = verifiedGate(s.root, SLUG);
      assert.equal(g.ok, false);
      assert.match(g.reason, /C2/);
      restore(s, before);
    }
  } finally { s.done(); }
});

test('a criterion whose named file changed cannot be carried (C5)', async () => {
  const { recordVerdict, verifiedGate } = await mods();
  const s = fixture();
  try {
    await fullPass(s);
    change(s, 'src/b.mjs');
    change(s, 'src/c.mjs');
    const out = await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: [...obs(['C2', 'C4']), ...carry(['C3'])] });
    assert.equal(out.passed, false);
    assert.deepEqual(out.refused.map((r) => r.id), ['C3']);
    assert.match(out.refused[0].reason, /named file changed: src\/c\.mjs/);
    assert.equal(verifiedGate(s.root, SLUG).ok, false);
  } finally { s.done(); }
});

test('a carry citing a targeted run, an older full PASS, or a non-ancestor commit is refused', async () => {
  const { recordVerdict, planReverify } = await mods();
  const s = fixture();
  try {
    const f1 = await fullPass(s);
    change(s, 'src/b.mjs');
    const t1 = await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: obs(['C2', 'C4']) });
    assert.equal(t1.passed, true);
    change(s, 'src/c.mjs');
    // the plan cites F1, never T1
    const p = planReverify(s.root, SLUG);
    assert.equal(p.mode, 'targeted');
    assert.ok(p.carry.every((c) => c.from.run === 1 && c.from.commit === f1.commit));
    const cite = (from) => recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: [...obs(['C3', 'C4']), ...carry(['C1'], { from })] });
    const t1File = snap(s);
    const viaT1 = await cite({ run: 2, commit: t1.commit });
    assert.equal(viaT1.passed, false);
    assert.match(viaT1.refused[0].reason, new RegExp(`carry must cite the most recent full PASS run 1 @ ${f1.commit.slice(0, 7)}, not run 2`));
    restore(s, t1File);
    const nonAnc = await cite({ run: 1, commit: '0'.repeat(40) });
    assert.equal(nonAnc.passed, false);
    // F2 becomes the base: citing F1 afterwards is refused, citing F2 passes
    change(s, 'src/d.mjs');
    const f2 = await fullPass(s);
    change(s, 'src/a.mjs');
    const f2File = snap(s);
    const old = await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: [...obs(['C1', 'C4']), ...carry(['C2'], { from: { run: 1, commit: f1.commit } })] });
    assert.equal(old.passed, false);
    assert.match(old.refused[0].reason, new RegExp(`run ${f2.run} @ ${f2.commit.slice(0, 7)}`));
    restore(s, f2File);
    const good = await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: [...obs(['C1', 'C4']), ...carry(['C2'], { from: { run: f2.run, commit: f2.commit } })] });
    assert.equal(good.passed, true);
    assert.deepEqual(good.base, { run: f2.run, commit: f2.commit });
  } finally { s.done(); }
});

test('a suite criterion carried from the full PASS is refused; carried by a reusable receipt on HEAD it is recorded with the receipt citation and passes', async () => {
  const { recordVerdict, verifiedGate, runSuite } = await mods();
  const s = fixture();
  try {
    await fullPass(s);
    change(s, 'src/b.mjs');
    const fullFile = snap(s);
    const no = await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: [...obs(['C2']), ...carry(['C4'])] });
    assert.equal(no.passed, false);
    assert.match(no.refused[0].reason, /suite criterion/);
    assert.match(no.refused[0].reason, /receipt/);
    restore(s, fullFile);
    const rc = runSuite(s.root, OK, { json: true });
    const out = await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: [...obs(['C2']), { id: 'C4', carried: true, receipt: rc.key }] });
    assert.equal(out.passed, true, JSON.stringify(out.refused));
    const e = readV(s).criteria.find((c) => c.id === 'C4');
    assert.equal(e.status, 'carried');
    assert.equal(e.evidence, 'carried');
    assert.equal(e.suite, true);
    assert.equal(e.receipt.key, rc.key);
    assert.equal(e.receipt.command, OK);
    assert.equal(e.receipt.commit, rc.commit);
    assert.equal(e.from, undefined);
    assert.deepEqual(verifiedGate(s.root, SLUG), { ok: true, reason: null });
    // a receipt cited for a non-suite criterion is refused
    const bad = await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: [...obs(['C2', 'C4']), { id: 'C1', carried: true, receipt: rc.key }] });
    assert.equal(bad.passed, false);
    assert.match(bad.refused[0].reason, /only stand in for a suite criterion/);
  } finally { s.done(); }
});

test('a receipt for another command than the criterion\'s suite command is refused at record time and by the gate (C7, D6)', async () => {
  const { recordVerdict, verifiedGate, runSuite } = await mods();
  const s = fixture();
  try {
    await fullPass(s);
    change(s, 'src/b.mjs');
    const fullFile = snap(s);
    const cheap = runSuite(s.root, 'true', { json: true });
    const out = await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: [...obs(['C2']), { id: 'C4', carried: true, receipt: cheap.key }] });
    assert.equal(out.passed, false);
    assert.match(out.refused[0].reason, /receipt is for `true`, not this criterion's suite command/);
    // a verdict file claiming that receipt anyway is refused by the gate
    restore(s, fullFile);
    const good = runSuite(s.root, OK, { json: true });
    const ok = await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: [...obs(['C2']), { id: 'C4', carried: true, receipt: good.key }] });
    assert.equal(ok.passed, true, JSON.stringify(ok.refused));
    const v = readV(s);
    v.criteria.find((c) => c.id === 'C4').receipt.command = 'true';
    writeFileSync(s.vfile, JSON.stringify(v, null, 2));
    commit(s.root, 'tamper');
    const g = verifiedGate(s.root, SLUG);
    assert.equal(g.ok, false);
    assert.match(g.reason, /receipt is for `true`/);
  } finally { s.done(); }
});

test('a receipt on a dirty tree, another commit or a failing exit is refused at record time', async () => {
  const { recordVerdict, runSuite } = await mods();
  const s = fixture();
  try {
    await fullPass(s);
    change(s, 'src/b.mjs');
    const fullFile = snap(s);
    const attempt = async (key) => {
      restore(s, fullFile);
      return recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: [...obs(['C2']), { id: 'C4', carried: true, receipt: key }] });
    };
    // dirty tree
    put(s.root, 'src/a.mjs', 'dirty');
    const dirty = runSuite(s.root, OK, { json: true });
    sh(s.root, 'checkout', '--', 'src/a.mjs');
    const r1 = await attempt(dirty.key);
    assert.equal(r1.passed, false);
    assert.match(r1.refused[0].reason, /dirty when the suite ran/);
    // failing exit
    const failing = runSuite(s.root, 'node -e "process.exit(1)"', { json: true });
    const r2 = await attempt(failing.key);
    assert.match(r2.refused[0].reason, /exit status was 1/);
    // another commit
    const old = runSuite(s.root, 'node -e "process.exit(0);"', { json: true });
    change(s, 'src/d.mjs');
    const r3 = await attempt(old.key);
    assert.match(r3.refused[0].reason, /is for commit/);
    const r4 = await attempt('f'.repeat(64));
    assert.match(r4.refused[0].reason, /not found/);
  } finally { s.done(); }
});

test('a test-strength criterion carried after a mutate-scope change is refused; after an out-of-scope change it carries and the gate accepts', async () => {
  const { recordVerdict, verifiedGate, criteriaHash } = await mods();
  const s = fixture(CRIT('[mutation] '));
  try {
    // seed a full PASS (a recorded one would need mutation evidence for C5)
    const commitSha = head(s.root);
    writeFileSync(s.vfile, JSON.stringify({
      version: 1, run: 1, mode: 'full', broad: false, commit: commitSha, criteria_sha: criteriaHash(readFileSync(join(dirname(s.vfile), 'CRITERIA.md'), 'utf8')),
      at: 'x', base: { run: 1, commit: commitSha },
      criteria: ids6.map((id) => ({ id, status: 'passed', evidence: 'observed', ...(id === 'C5' ? { test_strength: true } : {}) })),
    }));
    commit(s.root, 'chore(verdict): phase 01 run 1 — full PASS');
    // out of scope: only an unstamped docs file changed
    change(s, 'docs/x.md', 'docs: x');
    const ok = await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: obs(['C4']) });
    assert.equal(ok.passed, true, JSON.stringify(ok.refused));
    assert.equal(readV(s).criteria.find((c) => c.id === 'C5').status, 'carried');
    assert.equal(verifiedGate(s.root, SLUG).ok, true);
    // in scope: a stamped file the criteria do not name
    change(s, 'src/hidden.mjs', 'feat: hidden (phase 01 t2)');
    const bad = await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: obs(['C4']) });
    assert.equal(bad.passed, false);
    assert.deepEqual(bad.refused.map((r) => r.id), ['C5']);
    assert.match(bad.refused[0].reason, /test-strength: mutate scope changed \(src\/hidden\.mjs\)/);
    assert.equal(verifiedGate(s.root, SLUG).ok, false);
  } finally { s.done(); }
});

test('a targeted FAIL is saved, not verified, and the next plan narrows on it', async () => {
  const { recordVerdict, verifiedGate, planReverify } = await mods();
  const s = fixture();
  try {
    await fullPass(s);
    change(s, 'src/b.mjs');
    const out = await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: obs(['C2', 'C4'], ['C2']) });
    assert.equal(out.passed, false);
    assert.deepEqual(out.failing, ['C2']);
    assert.equal(verifiedGate(s.root, SLUG).ok, false);
    const p = planReverify(s.root, SLUG);
    assert.equal(p.mode, 'narrowed');
    assert.deepEqual(p.first, ['C2']);
    assert.deepEqual(p.carry, []);
  } finally { s.done(); }
});

test('a targeted result when the plan is full refuses every carry with the plan\'s reason', async () => {
  const { recordVerdict, verifiedGate } = await mods();
  const s = fixture();
  try {
    const out = await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: [...obs(['C1']), ...carry(['C2'])] });
    assert.equal(out.passed, false);
    assert.equal(out.refused.length, 5); // C2 explicit, C3..C6 implicit
    for (const r of out.refused) assert.match(r.reason, /^no carry allowed: no saved verdict/);
    assert.match(readV(s).reason, /verifier ran targeted \(plan: full: no saved verdict\)/);
    assert.equal(verifiedGate(s.root, SLUG).ok, false);
  } finally { s.done(); }
});

test('carried:true in a full or narrowed result is rejected and writes nothing', async () => {
  const { recordVerdict } = await mods();
  const s = fixture();
  try {
    for (const mode of ['full', 'narrowed']) {
      await assert.rejects(recordVerdict(s.root, SLUG, { mode, criteria: [...obs(['C1']), ...carry(['C2'])] }), /carried/);
    }
    assert.equal(existsSync(s.vfile), false);
    await fullPass(s);
    const before = readFileSync(s.vfile, 'utf8');
    const log = sh(s.root, 'log', '--oneline').stdout;
    await assert.rejects(recordVerdict(s.root, SLUG, { mode: 'narrowed', criteria: carry(['C2']) }));
    assert.equal(readFileSync(s.vfile, 'utf8'), before);
    assert.equal(sh(s.root, 'log', '--oneline').stdout, log);
  } finally { s.done(); }
});

test('every id appears exactly once with evidence observed or carried, and carried entries name their run and commit or receipt; mode and reason are recorded', async () => {
  const { recordVerdict } = await mods();
  const s = fixture();
  try {
    const f1 = await fullPass(s);
    assert.ok(readV(s).criteria.every((c) => c.evidence === 'observed'));
    assert.equal(readV(s).mode, 'full');
    change(s, 'src/b.mjs');
    await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: obs(['C2', 'C4']) });
    const v = readV(s);
    assert.equal(v.mode, 'targeted');
    assert.match(v.reason, /2 of 6 criteria affected since full PASS at/);
    assert.deepEqual(v.base, { run: 1, commit: f1.commit });
    assert.deepEqual(v.criteria.map((c) => c.id), ids6);
    for (const c of v.criteria) {
      assert.ok(['observed', 'carried'].includes(c.evidence), c.id);
      if (c.evidence === 'carried') assert.deepEqual(c.from, { run: 1, commit: f1.commit });
    }
  } finally { s.done(); }
});

test('code committed after a targeted PASS makes the gate refuse', async () => {
  const { recordVerdict, verifiedGate } = await mods();
  const s = fixture();
  try {
    await fullPass(s);
    change(s, 'src/b.mjs');
    await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: obs(['C2', 'C4']) });
    assert.equal(verifiedGate(s.root, SLUG).ok, true);
    change(s, 'src/c.mjs');
    const g = verifiedGate(s.root, SLUG);
    assert.equal(g.ok, false);
    assert.match(g.reason, /code changed/);
  } finally { s.done(); }
});

test('the gate re-derives the floor: a hand-edited targeted verdict that carries a floor criterion is refused', async () => {
  const { recordVerdict, verifiedGate } = await mods();
  const s = fixture();
  try {
    const f1 = await fullPass(s);
    change(s, 'src/b.mjs');
    await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: obs(['C2', 'C4']) });
    const v = readV(s);
    v.criteria = v.criteria.map((c) => (c.id === 'C2' ? { id: 'C2', status: 'carried', evidence: 'carried', last: 'passed', from: { run: 1, commit: f1.commit } } : c));
    writeFileSync(s.vfile, JSON.stringify(v));
    const g = verifiedGate(s.root, SLUG);
    assert.equal(g.ok, false);
    assert.match(g.reason, /C2 is in the floor/);
    v.criteria = readV(s).criteria.map((c) => (c.id === 'C1' ? { ...c, from: { run: 9, commit: f1.commit } } : c));
    v.base = { run: 1, commit: f1.commit };
    writeFileSync(s.vfile, JSON.stringify(v));
    assert.equal(verifiedGate(s.root, SLUG).ok, false);
  } finally { s.done(); }
});

test('carriedOf lists carried entries with their source and is empty on a full PASS', async () => {
  const { recordVerdict, carriedOf, runSuite } = await mods();
  const s = fixture();
  try {
    assert.deepEqual(carriedOf(s.root, SLUG), []);
    const f1 = await fullPass(s);
    assert.deepEqual(carriedOf(s.root, SLUG), []);
    change(s, 'src/b.mjs');
    const rc = runSuite(s.root, OK, { json: true });
    await recordVerdict(s.root, SLUG, { mode: 'targeted', criteria: [...obs(['C2']), { id: 'C4', carried: true, receipt: rc.key }] });
    const list = carriedOf(s.root, SLUG);
    assert.deepEqual(list.map((c) => c.id), ['C1', 'C3', 'C4', 'C5', 'C6']);
    assert.deepEqual(list[0], { id: 'C1', from: { run: 1, commit: f1.commit } });
    assert.deepEqual(list.find((c) => c.id === 'C4'), { id: 'C4', receipt: { key: rc.key, command: OK, commit: rc.commit } });
  } finally { s.done(); }
});
