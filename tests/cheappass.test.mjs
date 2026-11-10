// Phase 54 t11 (C2, C3a): the cheap first pass and the engine rules that keep it from ever passing a
// phase. Scratch project, real git. Dynamic imports (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const SLUG = '01-demo';
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body = 'x') => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const commit = (root, msg) => { sh(root, 'add', '-A'); sh(root, 'commit', '-q', '-m', msg); };
const OK = 'node -e "process.exit(0)"';
const BAD = 'node -e "process.exit(1)"';

const crit = ({ c2 = BAD, c3 = OK } = {}) => [
  '### C1 — one', `- **Cheap:** \`${OK}\``, '- **Observe:** the slow scenario', '',
  '### C2 — two', `- **Cheap:** \`${c2}\``, '',
  '### C3 — three', `- **Cheap:** \`${c3}\``, '',
  '### C4 [suite] — the suite', `- **Observe:** \`${OK}\``, '',
  '### C5 — no cheap line', '- **Observe:** the slow scenario', '',
].join('\n');
const ids = ['C1', 'C2', 'C3', 'C4', 'C5'];

function fixture(c = crit()) {
  const root = mkdtempSync(join(tmpdir(), 'cheap-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  put(root, `.astrocode/phases/${SLUG}/CRITERIA.md`, c);
  put(root, 'src/a.mjs');
  commit(root, 'init');
  return { root, vfile: join(root, '.astrocode', 'phases', SLUG, 'VERDICT.json'), done: () => rmSync(root, { recursive: true, force: true }) };
}
// A recorded run of `command` that took `seconds`, from a fake commit so it is never reusable at HEAD.
let seq = 0;
async function seed(root, { seconds, command = OK, exit = 0, at = new Date(Date.UTC(2026, 0, 1, 0, seq)).toISOString() }) {
  const { receiptDir, receiptKey } = await import('../lib/receipts.mjs');
  const key = receiptKey({ commit: `seed${seq++}`, tree: 't', command });
  mkdirSync(receiptDir(root), { recursive: true });
  writeFileSync(join(receiptDir(root), `${key}.json`), JSON.stringify({ key, command, commit: 'seed', tree: 't', exit, seconds, at, started_at: at }));
}
const verdictOf = (f) => JSON.parse(readFileSync(f.vfile, 'utf8'));

test('runCheapPass lists EVERY unmet id and records one narrowed cheap verdict naming exactly those', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const f = fixture(crit({ c2: BAD, c3: BAD }));
  try {
    const r = await runCheapPass(f.root, SLUG);
    assert.equal(r.clean, false);
    assert.deepEqual(r.unmet, ['C2', 'C3']);
    assert.deepEqual(r.unchecked, ['C5']);
    assert.deepEqual(r.ran.map((x) => x.id), ['C1', 'C2', 'C3']);
    assert.deepEqual(r.held.map((h) => h.id), ['C4'], 'an untimed suite is held back, not run (ADR-093)');
    assert.equal(r.recorded.mode, 'narrowed');
    assert.equal(r.recorded.passed, false);
    assert.deepEqual(r.recorded.failing, ['C2', 'C3']);
    assert.deepEqual(r.recorded.held, ['C4']);
    const v = verdictOf(f);
    assert.equal(v.stage, 'cheap');
    assert.deepEqual(v.criteria.filter((c) => c.status === 'failed').map((c) => c.id), ['C2', 'C3']);
    assert.deepEqual(v.criteria.filter((c) => c.last === 'unobserved').map((c) => c.id), ['C1', 'C4', 'C5']);
    assert.equal(v.criteria.find((c) => c.id === 'C4').held, 'slow suite');
    assert.equal(v.criteria.find((c) => c.id === 'C2').command, BAD);
  } finally { f.done(); }
});

test('a clean cheap pass records nothing', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const f = fixture(crit({ c2: OK }));
  try {
    const r = await runCheapPass(f.root, SLUG);
    assert.equal(r.clean, true);
    assert.deepEqual(r.unmet, []);
    assert.equal(r.recorded, null);
    assert.throws(() => readFileSync(f.vfile), /ENOENT/);
  } finally { f.done(); }
});

test('nothing declared: a pass over a CRITERIA.md without Cheap lines checks nothing', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const f = fixture('### C1 — a\n- **Observe:** x\n');
  try {
    const r = await runCheapPass(f.root, SLUG);
    assert.deepEqual([r.clean, r.ran.length, r.unchecked], [true, 0, ['C1']]);
  } finally { f.done(); }
});

test('the suite check reuses a valid receipt: a stub spawn counts zero suite runs after runSuite wrote one on the same clean tree', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const { runSuite } = await import('../lib/receipts.mjs');
  const f = fixture(crit({ c2: OK }));
  try {
    const rc = runSuite(f.root, OK, { json: true });
    assert.equal(rc.clean, true, 'the fixture tree is clean');
    const seen = [];
    const spawn = (cmd, opts) => { seen.push(cmd); return { status: 0, stdout: '', stderr: '' }; };
    // every Cheap command is the same string as the suite command in this fixture, so tell them apart by kind
    const r = await runCheapPass(f.root, SLUG, { spawn });
    const suite = r.ran.find((x) => x.kind === 'suite');
    assert.equal(suite.passed, true);
    assert.equal(suite.receipt, rc.key);
    assert.match(suite.output, /reused suite receipt/);
    assert.equal(seen.length, 3, 'only the three Cheap lines ran; the suite was not re-run');
  } finally { f.done(); }
});

test('with a fast timing and no reusable receipt the suite runs once, through runSuite, and a failing suite is unmet', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const f = fixture(crit({ c2: OK }).replace(`\`${OK}\`\n\n### C5`, `\`${BAD}\`\n\n### C5`));
  try {
    await seed(f.root, { seconds: 30, command: BAD });
    const r = await runCheapPass(f.root, SLUG);
    assert.deepEqual(r.unmet, ['C4']);
    assert.match(r.ran.find((x) => x.id === 'C4').output, /suite exited 1/);
  } finally { f.done(); }
});

test('a result { mode: full, stage: cheap, all passed } records not passed and verifiedGate refuses it', async () => {
  const { recordVerdict, verifiedGate } = await import('../lib/verdict.mjs');
  const f = fixture();
  try {
    const out = await recordVerdict(f.root, SLUG, { mode: 'full', stage: 'cheap', criteria: ids.map((id) => ({ id, passed: true })) });
    assert.equal(out.passed, false);
    assert.equal(out.mode, 'narrowed');
    assert.equal(verdictOf(f).stage, 'cheap');
    const g = verifiedGate(f.root, SLUG);
    assert.equal(g.ok, false);
    assert.match(g.reason, /cheap first pass/);
  } finally { f.done(); }
});

test('a full result where one criterion carries stage cheap passed is not passed', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const f = fixture();
  try {
    const out = await recordVerdict(f.root, SLUG, { mode: 'full', criteria: ids.map((id) => ({ id, passed: true, ...(id === 'C3' ? { stage: 'cheap' } : {}) })) });
    assert.equal(out.passed, false);
    const c3 = verdictOf(f).criteria.find((c) => c.id === 'C3');
    assert.equal(c3.status, 'carried');
    assert.equal(c3.last, 'unobserved');
  } finally { f.done(); }
});

test('a failed cheap criterion later passed by a real full run is passed; unobserved ones do not count as failing', async () => {
  const { recordVerdict, verifiedGate } = await import('../lib/verdict.mjs');
  const f = fixture();
  try {
    const first = await recordVerdict(f.root, SLUG, { mode: 'narrowed', stage: 'cheap', criteria: [{ id: 'C2', passed: false, command: BAD, output: 'x' }] });
    assert.deepEqual(first.failing, ['C2']);
    const full = await recordVerdict(f.root, SLUG, { mode: 'full', criteria: ids.map((id) => ({ id, passed: true })) });
    assert.equal(full.passed, true);
    assert.equal('stage' in verdictOf(f), false);
    assert.equal(verifiedGate(f.root, SLUG).ok, true);
  } finally { f.done(); }
});

// ── phase 56 t3: a slow suite is held back (ADR-093) ──

const counted = () => { const seen = []; return { seen, spawn: (cmd) => { seen.push(cmd); return { status: 0, stdout: '', stderr: '' }; } }; };

test('no timing: the suite is held, runSuite is never called, unmet is exactly the failing cheap ids, the record marks it held', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const f = fixture();
  try {
    const { seen, spawn } = counted();
    const r = await runCheapPass(f.root, SLUG, { spawn: (cmd, o) => (cmd === BAD ? { status: 1, stdout: '', stderr: '' } : spawn(cmd, o)) });
    assert.equal(r.held[0].id, 'C4');
    assert.match(r.held[0].reason, /no recorded run/);
    assert.deepEqual(r.unmet, ['C2']);
    assert.equal(r.ran.some((x) => x.kind === 'suite'), false);
    assert.equal(seen.filter((c) => c === OK).length, 2, 'only the OK Cheap lines of C1 and C3 ran; the suite did not');
    const c4 = verdictOf(f).criteria.find((c) => c.id === 'C4');
    assert.equal(c4.status, 'carried');
    assert.equal(c4.held, 'slow suite');
  } finally { f.done(); }
});

test('a 30s timing at an older commit runs the suite and writes a receipt at HEAD; exit 1 makes it unmet', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const { reusableReceipt } = await import('../lib/receipts.mjs');
  const f = fixture(crit({ c2: OK }));
  try {
    await seed(f.root, { seconds: 30 });
    const r = await runCheapPass(f.root, SLUG);
    assert.deepEqual(r.held, []);
    assert.equal(r.ran.find((x) => x.id === 'C4').passed, true);
    assert.equal(reusableReceipt(f.root, OK).ok, true, 'a fresh receipt at HEAD');
  } finally { f.done(); }
  const g = fixture(crit({ c2: OK }).replace(`\`${OK}\`\n\n### C5`, `\`${BAD}\`\n\n### C5`));
  try {
    await seed(g.root, { seconds: 30, command: BAD });
    assert.deepEqual((await runCheapPass(g.root, SLUG)).unmet, ['C4']);
  } finally { g.done(); }
});

test('a 900s timing is held', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const f = fixture(crit({ c2: OK }));
  try {
    await seed(f.root, { seconds: 900 });
    const r = await runCheapPass(f.root, SLUG);
    assert.equal(r.held[0].seconds, 900);
    assert.equal(r.held[0].threshold_seconds, 600);
    assert.equal(r.clean, true, 'held is not unmet');
    assert.equal(r.recorded, null, 'a clean pass with only a held suite records nothing');
  } finally { f.done(); }
});

test('a reusable receipt at HEAD whose seconds is 900 is met through the receipt, not held and not run', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const { runSuite, receiptDir } = await import('../lib/receipts.mjs');
  const f = fixture(crit({ c2: OK }));
  try {
    const rc = runSuite(f.root, OK, { json: true });
    const file = join(receiptDir(f.root), `${rc.key}.json`);
    writeFileSync(file, JSON.stringify({ ...rc, seconds: 900 }));
    const r = await runCheapPass(f.root, SLUG, { spawn: counted().spawn });
    assert.deepEqual(r.held, []);
    assert.equal(r.ran.find((x) => x.id === 'C4').receipt, rc.key);
    assert.match(r.ran.find((x) => x.id === 'C4').output, /reused suite receipt/);
  } finally { f.done(); }
});

test('a bad verify.slow_suite_minutes lands in warnings and the suite stays slow', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const f = fixture(crit({ c2: OK }));
  try {
    await seed(f.root, { seconds: 900 });
    writeFileSync(join(f.root, '.astrocode', 'config.json'), JSON.stringify({ verify: { slow_suite_minutes: 'abc' } }));
    const r = await runCheapPass(f.root, SLUG);
    assert.equal(r.held.length, 1);
    assert.match(r.warnings[0], /verify\.slow_suite_minutes "abc" is not a positive number/);
  } finally { f.done(); }
});
