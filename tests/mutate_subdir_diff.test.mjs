// Phase 59 t12 — a Go module below the repo root: Gremlins runs `--diff` inside a scratch git repo of the module
// (so only the phase's changed lines are mutated), or ac states why it fell back to whole-file mode.
// The stub stands in for gremlins and go, so this runs without Go; the real-tool proof is in mutate_real.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase } from '../lib/roadmap.mjs';
import { installStub, restrictedEnv, commit, sh, FX } from './fixtures/mutate/project.mjs';

const put = (dir, f, b) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), b); };
const lines = (tag) => Array.from({ length: 30 }, (_, i) => `// ${tag} ${i + 1}`).join('\n') + '\n';
const logLines = (f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

// svc/ holds the module; the phase changes line 5 of svc/a.go. `base` runs on the first commit.
async function rig(base = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-mutate-subdiff-'));
  sh(dir, 'init', '-q'); sh(dir, 'config', 'user.email', 't@t'); sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'subdiff' });
  await addPhase(dir, { number: 1, name: 'First' });
  const cfg = join(dir, '.astrocode/config.json');
  writeFileSync(cfg, JSON.stringify({ ...JSON.parse(readFileSync(cfg, 'utf8')), mutation: { tool: 'gremlins' } }));
  put(dir, 'svc/go.mod', 'module example.com/svc\n\ngo 1.22\n');
  put(dir, 'svc/a.go', lines('a'));
  put(dir, 'svc/c.go', lines('c'));
  base(dir);
  commit(dir, 'init');
  put(dir, 'svc/a.go', lines('a').replace('// a 5', '// a 5 changed'));
  put(dir, 'svc/a_test.go', 'package svc\n\nfunc TestA(t *testing.T) {}\n');
  commit(dir, 'feat: a (phase 1 t1)');
  installStub(dir, 'gremlins');
  installStub(dir, 'go');
  const log = join(dir, 'stub.log');
  const env = restrictedEnv([join(dir, 'stubbin')], { MUTATE_STUB_LOG: log, MUTATE_STUB_REPORT: join(FX, 'gremlins.json') });
  return { dir, log, env, slug: findPhase(dir, '1').slug };
}
const runs = (env) => (existsSync(join(env.ASTRO_HEAVY_DIR, 'runs')) ? readdirSync(join(env.ASTRO_HEAVY_DIR, 'runs')) : []);

test('a subfolder module runs gremlins --diff in a scratch repo under the run folder, with no exclusion list, and leaves nothing behind', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig();
  try {
    const r = await runMutate(p.dir, p.slug, { env: p.env });
    assert.notEqual(r.outcome, 'error', r.error);
    const c = logLines(p.log).find((l) => l.tool === 'gremlins' && l.argv[0] === 'unleash');
    assert.match(c.cwd.replace(/^\/private/, ''), new RegExp(`^${join(p.env.ASTRO_HEAVY_DIR, 'runs', 'ac-run-').replace(/^\/private/, '')}[^/]+/mod$`));
    assert.match(c.argv[c.argv.indexOf('--diff') + 1], /^[0-9a-f]{40}$/);
    assert.ok(!c.argv.includes('--exclude-files'), 'diff mode needs no exclusion list');
    assert.equal(r.scope_detail.narrowed, 'diff');
    assert.match(r.scope_detail.why, /scratch/);
    assert.deepEqual(r.scope, ['svc/a.go']);
    assert.ok(r.survivors.every((s) => s.file === 'svc/a.go'), 'results map back to repo-relative paths');
    assert.equal(existsSync(c.cwd), false, 'the scratch repo is gone after the run');
    assert.deepEqual(runs(p.env), []);
  } finally { rmSync(p.dir, { recursive: true, force: true }); }
});

test('with a go.work the run falls back to whole-file mode and says why', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig((dir) => put(dir, 'go.work', 'go 1.22\n\nuse ./svc\n'));
  try {
    const r = await runMutate(p.dir, p.slug, { env: p.env });
    assert.notEqual(r.outcome, 'error', r.error);
    const c = logLines(p.log).find((l) => l.tool === 'gremlins' && l.argv[0] === 'unleash');
    assert.ok(!c.argv.includes('--diff'));
    assert.deepEqual(c.argv.filter((a, i) => c.argv[i - 1] === '--exclude-files'), ['^c\\.go$'], 'file mode excludes the module\'s other files');
    assert.equal(r.scope_detail.narrowed, 'files');
    assert.match(r.scope_detail.fallback, /go\.work/);
    assert.match(r.scope_detail.why, /fell back to whole-file mode: .*go\.work/);
    assert.ok(r.survivors.every((s) => s.file === 'svc/a.go'));
  } finally { rmSync(p.dir, { recursive: true, force: true }); }
});

// Phase 59 remediate (C11): real Gremlins v0.6.0 `--diff` SKIPS the mutants on changed lines after the first
// ones of a merged hunk. A skipped mutant on a phase line is run by a second, whole-file pass over the files
// that hold one, and its result replaces the first pass's for those files, so one run ends complete.
test('mutants Gremlins --diff skipped on phase lines are run by a second whole-file pass, and the run ends complete', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig();
  const rep = (status) => JSON.stringify({ go_module: 'example.com/svc', files: [{ file_name: 'a.go', mutations: [
    { line: 5, column: 3, type: 'ARITHMETIC_BASE', status },
    { line: 9, column: 3, type: 'ARITHMETIC_BASE', status: 'LIVED' }, // off the phase's lines: out of scope either way
  ] }] });
  const first = join(p.dir, 'first.json'); const second = join(p.dir, 'second.json');
  writeFileSync(first, rep('SKIPPED')); writeFileSync(second, rep('LIVED'));
  try {
    const r = await runMutate(p.dir, p.slug, { env: { ...p.env, MUTATE_STUB_REPORT: first, MUTATE_STUB_REPORT_NODIFF: second } });
    const calls = logLines(p.log).filter((l) => l.tool === 'gremlins' && l.argv[0] === 'unleash');
    assert.equal(calls.length, 2, 'a second pass ran');
    assert.ok(calls[0].argv.includes('--diff') && !calls[1].argv.includes('--diff'));
    assert.deepEqual(calls[1].argv.filter((a, i) => calls[1].argv[i - 1] === '--exclude-files'), ['^c\\.go$'], 'the second pass keeps only the file holding a skipped mutant');
    assert.equal(calls[1].cwd, calls[0].cwd, 'same module copy');
    assert.equal(r.not_run_count, 0);
    assert.equal(r.counts.survived, 1);
    assert.deepEqual(r.survivors.map((s) => `${s.file}:${s.line}`), ['svc/a.go:5']);
    assert.equal(r.outcome, 'survivors');
    assert.equal(r.complete, true);
    assert.ok(r.warnings.some((w) => /--diff skipped 1 mutant/.test(w)), JSON.stringify(r.warnings));
    assert.deepEqual(runs(p.env), []);
  } finally { rmSync(p.dir, { recursive: true, force: true }); }
});
