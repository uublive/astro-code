// Fix 2026-11-27-kit-tests-allow-only-one-artifact (envirotech-fuel-surcharge-d8, approved by the owner): Halo 0.8.3
// attaches EVERY artifact tagged `email_attachment`, by its literal path. The kit tests allowed at most one. Now 0..N
// tagged artifacts pass, each with a literal path (no glob, no placeholder) and no two the same; the rest of the checks
// are unchanged. Checked through both validate_manifest.py (M-02) and kit_test.py (R-12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT_SRC = join(ROOT, 'examples/kit-convert-demo/commit-digest');
const TOOLS_DIR = join(ROOT, 'templates/kit/tools');
const hasPython = spawnSync('python3', ['--version']).status === 0;
const RECIPE = 'src/recipes/commit-digest.yaml';

// A two-phase recipe producing every path in `produced`, and kit.json declaring `artifacts` ([path, tagged]).
function kit(produced, artifacts) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-kit-attach-'));
  cpSync(KIT_SRC, dir, { recursive: true });
  cpSync(TOOLS_DIR, join(dir, 'tools'), { recursive: true });
  writeFileSync(join(dir, RECIPE), [
    'name: commit-digest', 'description: >', '  A test recipe.', 'version: 1', 'phases:',
    '  - name: prepare', '    goal: >', '      Prepare.', '    input: []', '    output:', '      - _report/state.json',
    '  - name: report', '    goal: >', '      Report.', '    input: []', '    output:', ...produced.map((p) => `      - ${p}`), '',
  ].join('\n'));
  const m = JSON.parse(readFileSync(join(dir, 'kit.json'), 'utf8'));
  m.outputs = { format: 'json', artifacts: artifacts.map(([path, tagged]) => (tagged ? { path, tags: ['email_attachment'] } : { path })) };
  writeFileSync(join(dir, 'kit.json'), JSON.stringify(m, null, 2));
  return dir;
}

function run(dir) {
  const kt = spawnSync('python3', ['tools/kit_test.py', '--json', '--skip-parity'], { cwd: dir, encoding: 'utf8' });
  let report = null;
  try { report = JSON.parse(kt.stdout); } catch { /* ignore */ }
  const rows = report?.results ?? [];
  const vm = spawnSync('python3', ['tools/validate_manifest.py', 'kit.json'], { cwd: dir, encoding: 'utf8' });
  const fail = (id) => rows.filter((r) => r.status === 'FAIL' && r.id === id).map((r) => r.message ?? '');
  return { out: `${kt.stdout}${kt.stderr}`, r12: fail('R-12'), m02: fail('M-02'), vm: { status: vm.status, out: `${vm.stdout}${vm.stderr}` } };
}

test('two tagged artifacts, both produced: the FSC case (sign-off pack + fixed-name monthly PDF) passes M-02 and R-12', { skip: !hasPython && 'no python3' }, () => {
  const dir = kit(['_report/signoff_pack.pdf', '_report/fsc_monthly.pdf'], [['_report/signoff_pack.pdf', true], ['_report/fsc_monthly.pdf', true]]);
  try {
    const r = run(dir);
    assert.deepEqual(r.r12, [], r.out);
    assert.deepEqual(r.m02, [], r.out);
    assert.equal(r.vm.status, 0, r.vm.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('zero and one tagged artifacts still pass', { skip: !hasPython && 'no python3' }, () => {
  for (const tagged of [false, true]) {
    const dir = kit(['_report/out.pdf'], [['_report/out.pdf', tagged]]);
    try {
      const r = run(dir);
      assert.deepEqual([...r.r12, ...r.m02], [], r.out);
      assert.equal(r.vm.status, 0, r.vm.out);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('the same tagged path twice fails, in both tools', { skip: !hasPython && 'no python3' }, () => {
  const dir = kit(['_report/out.pdf'], [['_report/out.pdf', true], ['_report/out.pdf', true]]);
  try {
    const r = run(dir);
    assert.ok(r.r12.some((m) => /out\.pdf/.test(m) && /more than once|duplicate/i.test(m)), r.out);
    assert.notEqual(r.vm.status, 0, r.vm.out);
    assert.match(r.vm.out, /out\.pdf/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a tagged path with a glob or a placeholder fails: Halo attaches by literal path', { skip: !hasPython && 'no python3' }, () => {
  for (const bad of ['_report/*.pdf', '_report/fsc_{month}.pdf', '_report/fsc_<month>.pdf', '_report/${MONTH}.pdf', '_report/{{name}}.pdf']) {
    const dir = kit(['_report/out.pdf'], [['_report/out.pdf', true], [bad, true]]);
    try {
      const r = run(dir);
      assert.ok(r.r12.some((m) => m.includes(bad) && /literal/i.test(m)), `${bad}\n${r.out}`);
      assert.notEqual(r.vm.status, 0, `${bad}: ${r.vm.out}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('an untagged artifact with a glob is not judged by the attachment rule', { skip: !hasPython && 'no python3' }, () => {
  const dir = kit(['_report/out.pdf'], [['_report/out.pdf', true], ['_report/*.json', false]]);
  try {
    const r = run(dir);
    assert.deepEqual(r.r12, [], r.out);
    assert.equal(r.vm.status, 0, r.vm.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
