// Phase 54 t19 (C2, C7): `ac verdict plan --broad-files`, the broad refusal line on `ac verdict record`,
// and `ac verdict cheap`, driven through the real CLI in a real tmp git project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase } from '../lib/roadmap.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const ac = (cwd, ...a) => spawnSync(process.execPath, [AC, ...a], { cwd, encoding: 'utf8', env: { ...process.env, ASTRO_SIGNER_AGENT: '' } });
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const OK = 'node -e "process.exit(0)"';
const BAD = 'node -e "console.log(\'boom\');process.exit(1)"';
const put = (root, rel, body = 'x') => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };

async function project(crit) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-cheap-cli-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'vproj' });
  await addPhase(dir, { number: 1, name: 'Do a thing' });
  const ph = findPhase(dir, '1');
  put(dir, `.astrocode/phases/${ph.slug}/CRITERIA.md`, crit);
  for (const f of 'abcdef') put(dir, `src/${f}.mjs`);
  put(dir, 'README.md');
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'init');
  return { dir, slug: ph.slug, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const CHEAP = (c2 = BAD, c3 = BAD) => [
  '### C1 — one', `- **Cheap:** \`${OK}\``, '',
  '### C2 — two', `- **Cheap:** \`${c2}\``, '',
  '### C3 — three', `- **Cheap:** \`${c3}\``, '',
].join('\n');

test('ac verdict cheap exits 1 listing EVERY unmet id on a failing fixture, and --json matches the runCheapPass shape', async () => {
  const p = await project(CHEAP());
  try {
    const r = ac(p.dir, 'verdict', 'cheap', '1');
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stdout, /✖ C2 cheap: .* — boom/);
    assert.match(r.stdout, /✖ C3 cheap/);
    assert.match(r.stdout, /✖ cheap pass: 2 unmet — C2, C3/);
    const j = ac(p.dir, 'verdict', 'cheap', '1', '--json');
    assert.equal(j.status, 1);
    const out = JSON.parse(j.stdout);
    assert.deepEqual(Object.keys(out).sort(), ['clean', 'ran', 'recorded', 'unchecked', 'unmet']);
    assert.deepEqual(out.unmet, ['C2', 'C3']);
    assert.equal(out.recorded.mode, 'narrowed');
    assert.equal(ac(p.dir, 'verdict', 'history', '1').stdout.includes('narrowed/cheap'), true, 'the cheap round is in the history');
  } finally { p.done(); }
});

test('ac verdict cheap exits 0 when clean, and prints a ⊡ line when nothing is declared', async () => {
  const clean = await project(CHEAP(OK, OK));
  try {
    const r = ac(clean.dir, 'verdict', 'cheap', '1');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /✓ cheap pass clean \(3 checked\)/);
  } finally { clean.done(); }
  const none = await project('### C1 — one\n- **Observe:** x\n');
  try {
    const r = ac(none.dir, 'verdict', 'cheap', '1');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^⊡ no cheap observation declared — nothing checked$/m);
  } finally { none.done(); }
});

const BROAD = [1, 2, 3].flatMap((n) => [`### C${n} — c${n}`, `- **Files:** \`src/${'abc'[n - 1]}.mjs\``, '']).join('\n');
async function broadProject() {
  const p = await project(BROAD);
  const res = (failed) => JSON.stringify({ mode: 'full', criteria: ['C1', 'C2', 'C3'].map((id) => ({ id, passed: !failed.includes(id) })) });
  assert.equal(ac(p.dir, 'verdict', 'record', '1', '--result', res(['C2'])).status, 0);
  put(p.dir, 'src/b.mjs', 'fixed'); put(p.dir, 'README.md', 'changed');
  sh(p.dir, 'add', '-A'); sh(p.dir, 'commit', '-q', '-m', 'fix');
  return p;
}

test('ac verdict plan --broad-files returns full for a supported claim and narrowed with broad_refused otherwise', async () => {
  const p = await broadProject();
  try {
    const ok = JSON.parse(ac(p.dir, 'verdict', 'plan', '1', '--broad-files', 'src/b.mjs', '--json').stdout);
    assert.equal(ok.mode, 'full');
    assert.match(ok.reason, /^broad fix: src\/b\.mjs/);
    const bad = ac(p.dir, 'verdict', 'plan', '1', '--broad-files', 'README.md', '--json');
    const j = JSON.parse(bad.stdout);
    assert.equal(j.mode, 'narrowed');
    assert.match(j.broad_refused, /no criterion's file map names it/);
    assert.match(bad.stderr, /⚠ broad claim refused: .* — the plan stays narrowed/);
    const text = ac(p.dir, 'verdict', 'plan', '1', '--broad-files', 'src/c.mjs');
    assert.match(text.stderr, /broad claim refused: none of the named files/);
    assert.match(text.stdout, /^• narrowed:/m);
    const full = ac(p.dir, 'verdict', 'plan', '1', '--broad-files', 'src/b.mjs');
    assert.match(full.stdout, /^• full: broad fix: /m);
  } finally { p.done(); }
});

test('ac verdict record with a refused broad claim prints the refusal line and records narrowed', async () => {
  const p = await broadProject();
  try {
    const result = JSON.stringify({ mode: 'full', broad: true, broad_files: ['README.md'], criteria: ['C1', 'C2', 'C3'].map((id) => ({ id, passed: true })) });
    const r = ac(p.dir, 'verdict', 'record', '1', '--result', result);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /^⚠ broad claim refused: .* — recorded narrowed$/m);
    const out = JSON.parse(r.stdout);
    assert.equal(out.mode, 'narrowed');
    assert.equal(out.passed, false);
    assert.ok(out.broad_refused);
  } finally { p.done(); }
});

test('--broad-files with no value dies, and a typo\'d flag on cheap dies', async () => {
  const p = await broadProject();
  try {
    const none = ac(p.dir, 'verdict', 'plan', '1', '--broad-files');
    assert.notEqual(none.status, 0);
    assert.match(none.stderr, /--broad-files needs/);
    assert.notEqual(ac(p.dir, 'verdict', 'plan', '1', '--broad-files', '--json').status, 0);
    assert.notEqual(ac(p.dir, 'verdict', 'cheap', '1', '--jsno').status, 0);
  } finally { p.done(); }
});
