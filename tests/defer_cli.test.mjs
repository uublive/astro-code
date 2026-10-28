// Phase 54 t16 (C4, C5, C6): `ac verdict defer`, the deferrable line, and the deferred surfaces in
// `ac phase show`, `ac status` and `ac fix list`, driven through the real CLI in a real tmp project.
// Fixture: C1 plain, C2 [edge], C3 [core], C4 untagged, C5 [suite]; PLAN.md committed after CRITERIA.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase } from '../lib/roadmap.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
// A human session: the agent-signer env a witness exports must not leak in from the machine running the suite.
const ac = (cwd, ...a) => spawnSync(process.execPath, [AC, ...a], { cwd, encoding: 'utf8', env: { ...process.env, ASTRO_SIGNER_AGENT: '' } });
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const ids = ['C1', 'C2', 'C3', 'C4', 'C5'];
const CRIT = [
  '### C1 — plain', '- **Observe:** y', '',
  '### C2 [edge] — an edge claim', '- **Observe:** y', '',
  '### C3 [core] — a core claim', '- **Observe:** y', '',
  '### C4 — untagged', '- **Observe:** y', '',
  '### C5 [suite] — the suite', '- **Observe:** `npm test`', '',
].join('\n');
const res = (failed = [], omit = []) => JSON.stringify({
  mode: 'full',
  criteria: ids.filter((id) => !omit.includes(id)).map((id) => (failed.includes(id)
    ? { id, passed: false, command: `check ${id}`, output: `${id} said no` } : { id, passed: true })),
});

async function project() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-defer-cli-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'vproj' });
  await addPhase(dir, { number: 1, name: 'Do a thing' });
  const ph = findPhase(dir, '1');
  const base = join(dir, '.astrocode', 'phases', ph.slug);
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'CRITERIA.md'), CRIT);
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'criteria');
  writeFileSync(join(base, 'PLAN.md'), '# plan');
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'plan');
  return { dir, slug: ph.slug, vfile: join(base, 'VERDICT.json'), ffile: join(dir, '.astrocode', 'fixes.json'), done: () => rmSync(dir, { recursive: true, force: true }) };
}
const snap = (p) => [readFileSync(p.vfile, 'utf8'), (() => { try { return readFileSync(p.ffile, 'utf8'); } catch { return ''; } })()];
const phaseStatus = (dir) => JSON.parse(ac(dir, 'phase', 'show', '1').stdout).status;

test('ac verdict record prints the deferrable line on stderr, and nothing when there is none', async () => {
  const p = await project();
  try {
    const r = ac(p.dir, 'verdict', 'record', '1', '--result', res(['C2', 'C3', 'C4', 'C5']));
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /^• deferrable: C2 — a human may defer with `ac verdict defer 1 C2`$/m);
    assert.deepEqual(JSON.parse(r.stdout).deferrable, ['C2']);
    const none = ac(p.dir, 'verdict', 'record', '1', '--result', res(['C3']));
    assert.doesNotMatch(none.stderr, /deferrable/);
    const pass = ac(p.dir, 'verdict', 'record', '1', '--result', res());
    assert.doesNotMatch(pass.stderr, /deferrable/);
  } finally { p.done(); }
});

test('ac verdict defer opens a fix and says whether the phase can verify; fix list shows where it came from', async () => {
  const p = await project();
  try {
    ac(p.dir, 'verdict', 'record', '1', '--result', res(['C2', 'C3']));
    const d = ac(p.dir, 'verdict', 'defer', '1', 'C2');
    assert.equal(d.status, 0, d.stderr);
    assert.match(d.stdout, /^✓ C2 deferred → fix \d{4}-\d\d-\d\d-deferred-phase-01-c2/m);
    assert.match(d.stdout, /the phase cannot verify yet: .*C3/);
    const list = ac(p.dir, 'fix', 'list');
    assert.match(list.stdout, /deferred from 01 C2/);
    const fixes = JSON.parse(ac(p.dir, 'fix', 'list', '--json').stdout);
    assert.match(fixes[0].repro, /check C2/);
    assert.match(fixes[0].repro, /C2 said no/);
    assert.equal(fixes[0].deferred_from.criterion, 'C2');
  } finally { p.done(); }
});

test('refusals: C3, C4, C5, --agent, an env agent signer and a bare call exit non-zero with a reason and change nothing', async () => {
  const p = await project();
  try {
    ac(p.dir, 'verdict', 'record', '1', '--result', res(['C2', 'C3', 'C4', 'C5']));
    const before = snap(p);
    for (const args of [['C3'], ['C4'], ['C5'], ['C2', 'C3'], ['C2', '--agent', 'claude'], []]) {
      const r = ac(p.dir, 'verdict', 'defer', '1', ...args);
      assert.notEqual(r.status, 0, JSON.stringify(args));
      assert.ok(r.stderr.length > 0, JSON.stringify(args));
      assert.deepEqual(snap(p), before, `unchanged after ${JSON.stringify(args)}`);
    }
    assert.match(ac(p.dir, 'verdict', 'defer', '1', 'C3').stderr, /core criterion/);
    assert.match(ac(p.dir, 'verdict', 'defer', '1', 'C5').stderr, /C5.*never deferrable/);
    assert.match(ac(p.dir, 'verdict', 'defer', '1', 'C2', '--agent', 'x').stderr, /human act/);
    const env = spawnSync(process.execPath, [AC, 'verdict', 'defer', '1', 'C2'], { cwd: p.dir, encoding: 'utf8', env: { ...process.env, ASTRO_SIGNER_AGENT: 'bot' } });
    assert.notEqual(env.status, 0);
    assert.match(env.stderr, /human act/);
    assert.match(ac(p.dir, 'verdict', 'defer', '1').stderr, /name the criteria to defer/);
    assert.deepEqual(snap(p), before);
  } finally { p.done(); }
});

test('after deferring, a passing record lets ac phase verify then ac phase accept succeed --agent claude', async () => {
  const p = await project();
  try {
    ac(p.dir, 'verdict', 'record', '1', '--result', res(['C2']));
    assert.notEqual(ac(p.dir, 'phase', 'verify', '1').status, 0, 'not verifiable while C2 fails');
    const d = ac(p.dir, 'verdict', 'defer', '1', 'C2');
    assert.equal(d.status, 0, d.stderr);
    assert.match(d.stdout, /the phase can now verify/);
    const rec = ac(p.dir, 'verdict', 'record', '1', '--result', res([], ['C2']));
    assert.equal(JSON.parse(rec.stdout).passed, true);
    const v = ac(p.dir, 'phase', 'verify', '1');
    assert.equal(v.status, 0, v.stderr);
    assert.equal(phaseStatus(p.dir), 'verified');
    const a = ac(p.dir, 'phase', 'accept', '1', '--by', 'matteo');
    assert.equal(a.status, 0, a.stderr);
    assert.equal(phaseStatus(p.dir), 'complete');
  } finally { p.done(); }
});

test('the open deferred fix is listed by phase show (JSON) and by one Deferred: line of ac status', async () => {
  const p = await project();
  try {
    ac(p.dir, 'verdict', 'record', '1', '--result', res(['C2']));
    assert.equal(JSON.parse(ac(p.dir, 'phase', 'show', '1').stdout).deferred_fixes, undefined);
    assert.doesNotMatch(ac(p.dir, 'status').stdout, /Deferred:/);
    ac(p.dir, 'verdict', 'defer', '1', 'C2');
    const show = JSON.parse(ac(p.dir, 'phase', 'show', '1').stdout);
    assert.equal(show.deferred_fixes.length, 1);
    assert.equal(show.deferred_fixes[0].criterion, 'C2');
    const status = ac(p.dir, 'status');
    const lines = status.stdout.split('\n').filter((l) => l.startsWith('Deferred:'));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /deferred-phase-01-c2.* \(01 C2\)/);
    assert.equal(JSON.parse(ac(p.dir, 'status', '--json').stdout).deferred_fixes.length, 1);
  } finally { p.done(); }
});
