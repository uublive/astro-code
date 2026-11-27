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

// Halo 0.8.3 (confirmed by astro-port-6e): the object form needs Halo 0.8.3 or later, paths are literal, and only a
// regular file counts as a produced output.
for (const [parser, builtin] of PARSERS) {
  test(`[${parser}] a recipe using the object form is warned that it needs Halo 0.8.3+; a strings-only recipe is not`, { skip: !hasPython && 'no python3' }, () => {
    let dir = scratchKit(GAPS, ['_report/gaps.json']);
    try { assert.ok(runKitTest(dir, { builtin }).has('WARN', 'R-07', /Halo 0\.8\.3/)); } finally { rmSync(dir, { recursive: true, force: true }); }
    dir = scratchKit([{ name: 'prepare', output: ['_report/state.json'] }], ['_report/state.json']);
    try { assert.ok(!runKitTest(dir, { builtin }).has('WARN', 'R-07', /Halo 0\.8\.3/)); } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`[${parser}] an output path with a glob character is warned: Halo reads paths literally`, { skip: !hasPython && 'no python3' }, () => {
    const dir = scratchKit([{ name: 'prepare', output: ['_report/state.json', { path: '_report/*.json', optional: true }] }], ['_report/state.json']);
    try { assert.ok(runKitTest(dir, { builtin }).has('WARN', 'R-09', /glob/)); } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('the Tier 2 output check counts only a regular file: a directory fails, a missing optional is skipped', { skip: !hasPython && 'no python3' }, () => {
  const dir = scratchKit(GAPS, ['_report/gaps.json']);
  try {
    const py = [
      'import sys, os; sys.path.insert(0, "tools"); import kit_run_local as k; from pathlib import Path',
      'w = Path("work"); (w / "_report").mkdir(parents=True); (w / "_report/state.json").write_text("{}"); (w / "_report/gaps.json").mkdir()',
      'for o, opt in [("_report/state.json", False), ("_report/gaps.json", False), ("_report/change_set.json", True), ("_report/missing.json", False)]: print(o, k.output_status(w, o, opt))',
    ].join('\n');
    const res = spawnSync('python3', ['-c', py], { cwd: dir, encoding: 'utf8' });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /_report\/state\.json \('✓', '', False\)/);
    assert.match(res.stdout, /_report\/gaps\.json \('✗', '  \(not a regular file\)', True\)/);
    assert.match(res.stdout, /_report\/change_set\.json \('–', '  \(optional, not produced this run\)', False\)/);
    assert.match(res.stdout, /_report\/missing\.json \('✗', '', True\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Reported by the EnviroTech kit session (fix/gaps-recipe-output, d9181e9): its real recipe writes the output list
// inline, as a flow sequence with JSON-quoted keys. Halo reads it with a real YAML loader, so the builtin fallback
// parser must too, in both forms; the line below is the kit's own.
const ENVIRO_FLOW = 'output: ["_report/run_log.json", {"path": "_report/change_set.json", "optional": true}]';
function recipeText(outputBlock, inputBlock = 'input: []') {
  return ['name: commit-digest', 'description: >', '  A test recipe.', 'version: 1', 'phases:',
    '  - name: prepare', '    goal: >', '      Prepare.', '    input: []', '    output:', '      - _report/state.json',
    '  - name: answer', '    goal: >', '      Answer.', `    ${inputBlock}`, ...outputBlock.map((l) => `    ${l}`), ''].join('\n');
}
function kitWithRecipe(text, artifacts) {
  const dir = scratchKit([{ name: 'prepare', output: ['_report/state.json'] }], artifacts);
  writeFileSync(join(dir, RECIPE), text);
  return dir;
}

for (const [parser, builtin] of PARSERS) {
  test(`[${parser}] the EnviroTech flow line: an inline output list mixing a string and a quoted-key mapping`, { skip: !hasPython && 'no python3' }, () => {
    const dir = kitWithRecipe(recipeText([ENVIRO_FLOW]), ['_report/run_log.json', '_report/change_set.json']);
    try {
      const r = runKitTest(dir, { builtin });
      assert.deepEqual(r.fails.map((f) => f.id), [], r.out);
      assert.ok(r.has('PASS', 'R-11', /2\/2/), r.out);
      assert.ok(r.has('WARN', 'R-07', /Halo 0\.8\.3/), 'the object form is recognised');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`[${parser}] the block form: a list item that is a mapping, path then optional on the next line`, { skip: !hasPython && 'no python3' }, () => {
    const dir = kitWithRecipe(recipeText(['output:', '  - _report/run_log.json', '  - path: _report/change_set.json', '    optional: true']), ['_report/run_log.json', '_report/change_set.json']);
    try {
      const r = runKitTest(dir, { builtin });
      assert.deepEqual(r.fails.map((f) => f.id), [], r.out);
      assert.ok(r.has('PASS', 'R-11', /2\/2/), r.out);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`[${parser}] block mapping items with quoted keys and values, and an inline input list, read the same`, { skip: !hasPython && 'no python3' }, () => {
    const dir = kitWithRecipe(recipeText(['output:', '  - "_report/run_log.json"', '  - "path": "_report/change_set.json"', '    "optional": true'], 'input: ["_report/state.json"]'), ['_report/change_set.json']);
    try {
      const r = runKitTest(dir, { builtin });
      assert.deepEqual(r.fails.map((f) => f.id), [], r.out);
      assert.ok(!r.warns.some((w) => w.id === 'R-10'), `the inline input list is read: ${r.out}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test(`[${parser}] a malformed inline list is refused, never read as one literal path`, { skip: !hasPython && 'no python3' }, () => {
    const dir = kitWithRecipe(recipeText(['output: ["_report/run_log.json", {"path": "_report/x.json", "optional": true]']), ['_report/run_log.json']);
    try {
      const r = runKitTest(dir, { builtin });
      assert.ok(r.fails.length > 0, `an unbalanced line must fail, not pass: ${r.out}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
