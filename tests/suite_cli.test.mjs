// Phase 52 t5 — `ac suite run|receipt` through the real CLI in a real tmp git project (D6, #141).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const ac = (cwd, ...a) => spawnSync(process.execPath, [AC, ...a], { cwd, encoding: 'utf8' });
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const OK = 'node -e "process.exit(0)"';
const BAD = 'node -e "process.exit(4)"';

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-suite-cli-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'sproj' });
  writeFileSync(join(dir, 'a.mjs'), 'x');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'init');
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('ac suite run --command exits with the suite\'s status and prints one receipt line', () => {
  const p = project();
  try {
    const ok = ac(p.dir, 'suite', 'run', '--command', OK);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^✓ suite receipt [0-9a-f]{8}: exit 0 on a clean tree at [0-9a-f]{7} \(reusable\)\n$/);
    const bad = ac(p.dir, 'suite', 'run', '--command', BAD);
    assert.equal(bad.status, 4);
    assert.match(bad.stdout, /^⚠ suite receipt [0-9a-f]{8}: not reusable — suite exit status was 4\n$/);
  } finally { p.done(); }
});

test('--json keeps stdout pure JSON with the receipt', () => {
  const p = project();
  try {
    const r = ac(p.dir, 'suite', 'run', '--command', 'node -e "console.log(\'noise\')"', '--json');
    assert.equal(r.status, 0, r.stderr);
    const rc = JSON.parse(r.stdout);
    assert.equal(rc.exit, 0);
    assert.equal(rc.clean, true);
    assert.match(rc.key, /^[0-9a-f]{64}$/);
    assert.match(r.stderr, /noise/);
  } finally { p.done(); }
});

test('ac suite receipt --command reports reusable on the same clean tree and a reason after a tracked edit, an untracked file, a new commit, another command or a failing run', () => {
  const p = project();
  try {
    const q = (cmd) => { const r = ac(p.dir, 'suite', 'receipt', '--command', cmd); assert.equal(r.status, 0, r.stderr); return r.stdout; };
    assert.match(q(OK), /^• no reusable receipt: no receipt for this command/);
    ac(p.dir, 'suite', 'run', '--command', OK);
    ac(p.dir, 'suite', 'run', '--command', BAD);
    assert.match(q(OK), /^✓ reusable receipt [0-9a-f]{8} for "node -e \\?"process\.exit\(0\)\\?"" at [0-9a-f]{7}\n$/);
    const j = JSON.parse(ac(p.dir, 'suite', 'receipt', '--command', OK, '--json').stdout);
    assert.equal(j.reusable, true);
    assert.equal(j.reason, null);
    assert.equal(j.receipt.command, OK);
    assert.match(q(BAD), /^• no reusable receipt: suite exit status was 4/);
    assert.match(q(`${OK} `), /^• no reusable receipt: no receipt/);
    writeFileSync(join(p.dir, 'a.mjs'), 'edited');
    assert.match(q(OK), /^• no reusable receipt: tree is dirty now \(a\.mjs\)/);
    sh(p.dir, 'checkout', '--', 'a.mjs');
    writeFileSync(join(p.dir, 'new.mjs'), 'x');
    assert.match(q(OK), /^• no reusable receipt: tree is dirty now \(new\.mjs\)/);
    sh(p.dir, 'add', '-A');
    sh(p.dir, 'commit', '-q', '-m', 'later');
    assert.match(q(OK), /^• no reusable receipt: no receipt/);
    const nj = JSON.parse(ac(p.dir, 'suite', 'receipt', '--command', OK, '--json').stdout);
    assert.equal(nj.reusable, false);
    assert.equal(nj.receipt, null);
  } finally { p.done(); }
});

test('a missing --command dies', () => {
  const p = project();
  try {
    for (const sub of ['run', 'receipt']) {
      const r = ac(p.dir, 'suite', sub);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /--command/);
    }
    assert.notEqual(ac(p.dir, 'suite').status, 0);
  } finally { p.done(); }
});

test('an unknown flag (--comand) dies', () => {
  const p = project();
  try {
    for (const sub of ['run', 'receipt']) {
      const r = ac(p.dir, 'suite', sub, '--comand', OK);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /unknown flag/);
    }
  } finally { p.done(); }
});
