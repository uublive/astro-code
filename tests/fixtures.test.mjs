// Behavioural cover for `ac fixtures check` (ADR-050/052/054), lib/fixtures.mjs.
//
// This is layer 3 — the advisory net for the lanes a behavioural CRITERIA.md entry
// never reaches (/astro-fast, or any run that skips the verifier). Every case here is
// driven either as a real subprocess against a real git repo (posture: exit code,
// stdout/stderr shape) or through `await import('../lib/fixtures.mjs')` for the
// helper-level pure decision (ADR-018's dynamic-import pattern, kept even though the
// module already exists on this branch — t3 was written test-after against t2 per the
// plan's declared strategy). Every repo lives under the OS temp dir and is never
// committed here, so `git status --porcelain` stays clean after `npm test` (C7).
//
// The attribution test comes FIRST on purpose (plan's own ordering): it is the one
// most likely to catch a wrong shape — a date-range or "since last check" heuristic
// would pass the happy path (C1) and fail this one (C2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');

const run = (args, cwd) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8' });

// A bare git repo with a `.astrocode/` project, ready for real commits. No
// RUN-CONTRACT.md yet — callers that want a declaration write one explicitly, so the
// "no declaration" scenario (C1's outcome C) is just a repo that skips this step.
function mkRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fixtures-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  initPlanning(dir, { name: 'fixturesdemo' });
  return dir;
}

// Pinned format (ADR-054): the marker line, then `data-model:`/`seed:`, comma-separated,
// repo-relative. Writing it as a plain project-root file, independent of git history —
// `readFixtureDeclaration` reads the working tree, not a historical blob.
function writeDeclaration(dir, { dataModel = [], seed = [] } = {}) {
  writeFileSync(
    join(dir, 'RUN-CONTRACT.md'),
    [
      '# Run contract',
      '',
      '<!-- astro-code: fixtures-declaration -->',
      `data-model: ${dataModel.join(', ')}`,
      `seed: ${seed.join(', ')}`,
      '',
    ].join('\n'),
  );
}

function commit(dir, files, message) {
  for (const [rel, content] of Object.entries(files)) {
    writeFileSync(join(dir, rel), content);
  }
  git(['add', '-A'], { cwd: dir });
  git(['commit', '-qm', message], { cwd: dir });
}

// ── C2 — attribution to the phase that actually changed the model ────────────────

test('ADR-054/D8: a finding is attributed to the phase that stamped the change, never to whichever phase ran last', () => {
  // Repo (i): the declared path changes under an EARLIER phase's stamp, plus an
  // unstamped commit that also touches it, then phase 17's own stamped work touches
  // only unrelated files. A branch-vs-base or "since last check" heuristic would fire
  // here — the pinned implementation must not.
  const older = mkRepo();
  writeDeclaration(older, { dataModel: ['schema.sql'], seed: ['seed.mjs'] });
  commit(older, { 'schema.sql': 'create table a();\n', 'seed.mjs': '// seed\n' }, 'baseline');
  commit(older, { 'schema.sql': 'create table b();\n' }, 'schema tweak (phase 15 t3)');
  commit(older, { 'schema.sql': 'create table c();\n' }, 'unstamped follow-up, still touches schema');
  commit(older, { 'README.md': 'unrelated\n' }, 'phase 17 work, unrelated file (phase 17 t1)');

  const resOlder = run(['fixtures', 'check', '--phase', '17'], older);
  assert.strictEqual(resOlder.status, 0);
  assert.strictEqual(resOlder.stdout, '', 'phase 17 must not be blamed for an earlier phase\'s schema change');
  assert.strictEqual(resOlder.stderr, '');

  // Repo (ii): the declared-path change lives INSIDE a phase-17-stamped commit, the
  // working tree is clean (matching how the real workflow commits once per task) — this
  // must fire, proving the check is not simply always silent.
  const current = mkRepo();
  writeDeclaration(current, { dataModel: ['schema.sql'], seed: ['seed.mjs'] });
  commit(current, { 'schema.sql': 'create table a();\n', 'seed.mjs': '// seed\n' }, 'baseline');
  commit(current, { 'schema.sql': 'create table b();\n' }, 'schema change (phase 17 t2)');

  const resCurrent = run(['fixtures', 'check', '--phase', '17'], current);
  assert.strictEqual(resCurrent.status, 0);
  assert.match(resCurrent.stdout, /stale fixtures/, 'the same-phase stamped change must fire');
  assert.strictEqual(resCurrent.stderr, '');
});

// ── C1 — three distinguishable outcomes, never a non-zero exit ───────────────────

test('ADR-054/C1: fired, clean and not-checked read as three distinct outcomes, all exit 0', () => {
  // A — declared data-model path changed under a phase-17 stamp, seed untouched.
  const repoA = mkRepo();
  writeDeclaration(repoA, { dataModel: ['schema.sql'], seed: ['seed.mjs'] });
  commit(repoA, { 'schema.sql': 'create table a();\n', 'seed.mjs': '// seed\n' }, 'baseline');
  commit(repoA, { 'schema.sql': 'create table b();\n' }, 'schema change (phase 17 t2)');
  const resA = run(['fixtures', 'check', '--phase', '17'], repoA);

  // B — the same stamped commit ALSO changes the declared seed path: must be silent.
  const repoB = mkRepo();
  writeDeclaration(repoB, { dataModel: ['schema.sql'], seed: ['seed.mjs'] });
  commit(repoB, { 'schema.sql': 'create table a();\n', 'seed.mjs': '// seed\n' }, 'baseline');
  commit(
    repoB,
    { 'schema.sql': 'create table b();\n', 'seed.mjs': '// seed, extended\n' },
    'schema + seed change (phase 17 t2)',
  );
  const resB = run(['fixtures', 'check', '--phase', '17'], repoB);

  // C — no declaration at all: "not checked", not "clean".
  const repoC = mkRepo();
  commit(repoC, { 'schema.sql': 'create table a();\n' }, 'no declaration here (phase 17 t2)');
  const resC = run(['fixtures', 'check', '--phase', '17'], repoC);

  // All three exit 0 — advisory, never a gate.
  for (const [name, res] of [['A', resA], ['B', resB], ['C', resC]]) {
    assert.strictEqual(res.status, 0, `${name} must exit 0 regardless of outcome`);
  }

  // A fires, and names the phase and the changed declared path — not merely non-empty,
  // so the check can't be satisfied by an unconditional generic warning (C7 mutation 1).
  assert.match(resA.stdout, /⚠/, 'A must print a warning glyph');
  assert.match(resA.stdout, /phase 17/, 'A must name the phase');
  assert.match(resA.stdout, /schema\.sql/, 'A must name the changed declared path');
  assert.strictEqual(resA.stderr, '');

  // B is clean: byte-empty on both streams.
  assert.strictEqual(resB.stdout, '', 'B must be silent when clean');
  assert.strictEqual(resB.stderr, '', 'B must never write to stderr, even to say nothing happened');

  // C is "not checked", textually distinguishable from both A and B — an un-opted-in
  // project must never read as passing (D5).
  assert.match(resC.stdout, /⊡/, 'C must print the not-checked glyph');
  assert.match(resC.stdout, /not checked/i);
  assert.strictEqual(resC.stderr, '');

  const stems = [resA.stdout.trim(), resB.stdout.trim(), resC.stdout.trim()];
  assert.equal(new Set(stems).size, 3, 'fired, clean and not-checked must read as three distinct things');

  // No stack traces on the malformed/absent-declaration path.
  assert.doesNotMatch(resC.stdout + resC.stderr, /at Object|at Module|\bError:/);
});

// ── C3 — a finding survives the run: filed as debt, repeat sighting stays one item ─

test('ADR-054/C3/D6: a fired result is filed as debt, and a later phase\'s repeat sighting does not become a second item', () => {
  const dir = mkRepo();
  writeDeclaration(dir, { dataModel: ['schema.sql'], seed: ['seed.mjs'] });
  commit(dir, { 'schema.sql': 'create table a();\n', 'seed.mjs': '// seed\n' }, 'baseline');
  commit(dir, { 'schema.sql': 'create table b();\n' }, 'phase 17 schema change (phase 17 t2)');

  const first = run(['fixtures', 'check', '--phase', '17'], dir);
  assert.strictEqual(first.status, 0);
  assert.match(first.stdout, /stale fixtures/);

  const listAfterFirst = run(['debt', 'list', '--json'], dir);
  assert.strictEqual(listAfterFirst.status, 0, listAfterFirst.stderr);
  const itemsAfterFirst = JSON.parse(listAfterFirst.stdout);
  assert.equal(itemsAfterFirst.length, 1, 'exactly one open item must be filed');
  assert.equal(itemsAfterFirst[0].phase, '17');
  assert.equal(itemsAfterFirst[0].file, 'schema.sql');

  // A later phase hits the SAME violation on the same declared path.
  commit(dir, { 'schema.sql': 'create table c();\n' }, 'phase 18 also touches schema (phase 18 t1)');
  const second = run(['fixtures', 'check', '--phase', '18'], dir);
  assert.strictEqual(second.status, 0);
  assert.match(second.stdout, /stale fixtures/);

  const listAfterSecond = run(['debt', 'list', '--json'], dir);
  const itemsAfterSecond = JSON.parse(listAfterSecond.stdout);
  assert.equal(itemsAfterSecond.length, 1, 'a repeat sighting must not inflate the register into a second item');
  assert.ok(
    (itemsAfterSecond[0].also_found_in || []).includes('18'),
    'the repeat sighting from phase 18 must be recorded on the existing item',
  );
});

// ── Helper-level cover, via dynamic import (ADR-018) ──────────────────────────────
//
// The subprocess tests above prove the shipped CLI posture; this proves the pure
// decision function agrees with them at the unit level, isolated from the `bin/ac.mjs`
// dispatcher and debt-filing side effects.

test('readFixtureDeclaration/checkFixtures agree with the CLI posture at the unit level', async () => {
  const { readFixtureDeclaration, checkFixtures } = await import('../lib/fixtures.mjs');

  const dir = mkRepo();
  const missing = readFixtureDeclaration(dir);
  assert.equal(missing.ok, false, 'no RUN-CONTRACT.md must read as not-ok, not throw');

  writeDeclaration(dir, { dataModel: ['schema.sql'], seed: ['seed.mjs'] });
  const declared = readFixtureDeclaration(dir);
  assert.equal(declared.ok, true);
  assert.deepEqual(declared.dataModel, ['schema.sql']);
  assert.deepEqual(declared.seed, ['seed.mjs']);

  commit(dir, { 'schema.sql': 'create table a();\n', 'seed.mjs': '// seed\n' }, 'baseline');
  commit(dir, { 'schema.sql': 'create table b();\n' }, 'phase 17 schema change (phase 17 t2)');

  const result = checkFixtures(dir, { phase: '17' });
  assert.equal(result.status, 'fired');
  assert.deepEqual(result.touched, ['schema.sql']);
});
