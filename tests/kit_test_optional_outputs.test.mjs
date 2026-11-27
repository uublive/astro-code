// Fix 2026-11-27-kit-test-r-11-fails-a-recipe-whose (owner's go, relayed by astro-port-6e): a recipe phase
// output may be marked optional. An entry is a string (required, as before) or {path, optional: true}.
// R-11 counts an artifact as produced when any phase lists it, required or optional; R-07 needs at least one
// REQUIRED output per phase and refuses a malformed entry; R-09 and R-10 read both forms. Every case runs on
// both recipe parsers: PyYAML and the builtin fallback (KIT_TEST_NO_PYYAML=1).
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

// A recipe in the template's block style. `outputs` per phase: a string is a required output, an object is
// written as a block mapping ({path, optional}) or, with `flow: true`, as a `{ … }` flow mapping.
function recipe(phases) {
  const out = (o) => {
    if (typeof o === 'string') return `      - ${o}`;
    if (o.raw) return `      - ${o.raw}`;
    if (o.flow) return `      - {path: ${o.path}, optional: ${o.optional}}`;
    return [`      - path: ${o.path}`, ...(o.optional === undefined ? [] : [`        optional: ${o.optional}`])].join('\n');
  };
  return [
    'name: commit-digest',
    'description: >',
    '  A test recipe.',
    'version: 1',
    'phases:',
    ...phases.flatMap((p) => [
      `  - name: ${p.name}`,
      '    goal: >',
      `      Do the ${p.name} step.`,
      `    input: ${p.input?.length ? '' : '[]'}`,
      ...(p.input?.length ? p.input.map((i) => `      - ${i}`) : []),
      '    output:',
      ...p.output.map(out),
    ]),
    '',
  ].join('\n');
}

function scratchKit(phases, artifacts) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-kittest-optout-'));
  cpSync(KIT_SRC, dir, { recursive: true });
  cpSync(TOOLS_DIR, join(dir, 'tools'), { recursive: true });
  writeFileSync(join(dir, RECIPE), recipe(phases));
  const m = JSON.parse(readFileSync(join(dir, 'kit.json'), 'utf8'));
  m.outputs = { ...(m.outputs || {}), artifacts: artifacts.map((path) => ({ path })) };
  writeFileSync(join(dir, 'kit.json'), JSON.stringify(m, null, 2));
  return dir;
}

function runKitTest(dir, { builtin = false } = {}) {
  const env = { ...process.env, ...(builtin ? { KIT_TEST_NO_PYYAML: '1' } : {}) };
  const res = spawnSync('python3', ['tools/kit_test.py', '--json', '--skip-parity'], { cwd: dir, encoding: 'utf8', env });
  let report = null;
  try { report = JSON.parse(res.stdout); } catch { /* ignore */ }
  const rows = (report?.results ?? []).filter((r) => r.group === 'recipe');
  const of = (status) => rows.filter((r) => r.status === status);
  return { out: `${res.stdout || ''}${res.stderr || ''}`, rows, fails: of('FAIL'), warns: of('WARN'), has: (status, id, re) => of(status).some((r) => r.id === id && (!re || re.test(r.message ?? r.detail ?? JSON.stringify(r)))) };
}

const PARSERS = [['PyYAML', false], ['builtin', true]];
const GAPS = [
  { name: 'prepare', output: ['_report/state.json'] },
  { name: 'answer', input: ['_report/state.json'], output: ['_report/gaps.json', { path: '_report/change_set.json', optional: true }] },
];

for (const [parser, builtin] of PARSERS) {
  test(`[${parser}] an artifact only an optional output produces passes R-11 (the EnviroTech gaps-only case)`, { skip: !hasPython && 'no python3' }, () => {
    const dir = scratchKit(GAPS, ['_report/gaps.json', '_report/change_set.json']);
    try {
      const r = runKitTest(dir, { builtin });
      assert.deepEqual(r.fails.map((f) => f.id), [], r.out);
      assert.ok(r.has('PASS', 'R-11', /2\/2/), r.out);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`[${parser}] the flow form {path, optional: true} reads the same`, { skip: !hasPython && 'no python3' }, () => {
    const dir = scratchKit([
      { name: 'prepare', output: ['_report/state.json'] },
      { name: 'answer', output: ['_report/gaps.json', { path: '_report/change_set.json', optional: true, flow: true }] },
    ], ['_report/change_set.json']);
    try {
      const r = runKitTest(dir, { builtin });
      assert.deepEqual(r.fails.map((f) => f.id), [], r.out);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`[${parser}] a phase whose outputs are all optional fails R-07: at least one REQUIRED output`, { skip: !hasPython && 'no python3' }, () => {
    const dir = scratchKit([
      { name: 'prepare', output: ['_report/state.json'] },
      { name: 'answer', output: [{ path: '_report/change_set.json', optional: true }] },
    ], ['_report/change_set.json']);
    try {
      const r = runKitTest(dir, { builtin });
      assert.ok(r.has('FAIL', 'R-07', /required/i), r.out);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`[${parser}] a malformed output entry fails R-07`, { skip: !hasPython && 'no python3' }, () => {
    for (const bad of [{ path: '_report/x.json', optional: '"yes"' }, { raw: '{optional: true}' }, { raw: '{path: 42}' }]) {
      const dir = scratchKit([{ name: 'prepare', output: ['_report/state.json', bad] }], ['_report/state.json']);
      try {
        const r = runKitTest(dir, { builtin });
        assert.ok(r.has('FAIL', 'R-07'), `${JSON.stringify(bad)}\n${r.out}`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  });

  test(`[${parser}] an optional output that escapes the work dir fails R-09; one used later is not an R-10 warning`, { skip: !hasPython && 'no python3' }, () => {
    const dir = scratchKit([
      { name: 'prepare', output: ['_report/state.json', { path: '../outside.json', optional: true }, { path: '_report/extra.json', optional: true }] },
      { name: 'answer', input: ['_report/extra.json'], output: ['_report/gaps.json'] },
    ], ['_report/gaps.json']);
    try {
      const r = runKitTest(dir, { builtin });
      assert.ok(r.has('FAIL', 'R-09', /outside\.json/), r.out);
      assert.ok(!r.warns.some((w) => w.id === 'R-10'), r.out);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`[${parser}] plain string outputs behave as before: an artifact no phase lists still fails R-11`, { skip: !hasPython && 'no python3' }, () => {
    const dir = scratchKit([{ name: 'prepare', output: ['_report/state.json'] }], ['_report/state.json', '_report/missing.json']);
    try {
      const r = runKitTest(dir, { builtin });
      assert.ok(r.has('FAIL', 'R-11', /missing\.json/), r.out);
      assert.ok(!r.has('FAIL', 'R-07'), r.out);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('the Tier 2 runner reports a missing optional output as skipped, never as a failure', { skip: !hasPython && 'no python3' }, () => {
  const dir = scratchKit(GAPS, ['_report/gaps.json']);
  try {
    const py = `import sys; sys.path.insert(0, "tools"); import kit_run_local as k; from pathlib import Path\nfor ph, outs in k.declared_outputs(Path(".")): print(ph, [(o, opt) for o, opt in outs])`;
    const res = spawnSync('python3', ['-c', py], { cwd: dir, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /answer \[\('_report\/gaps\.json', False\), \('_report\/change_set\.json', True\)\]/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
