// Fix 2026-11-09-ac-mutate-cannot-bound-mutmut-s-worker (GitHub #188): `ac mutate` started mutmut 3 with
// no way to bound its worker count, so on a many-core host a run used every CPU. `mutation.max_children`
// (or `mutation.phases.<n>.max_children`) is passed as `--max-children N` (mutmut 3.x's own flag) on the
// full run and on the `--survivors` re-run. mutmut 2 has no such flag: the key is reported as ignored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeProject, installStub, restrictedEnv, commit, FX } from './fixtures/mutate/project.mjs';

const REAL = join(FX, 'real');
const put = (dir, f, b) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), b); };
const logLines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const cfgSet = async (dir, patch) => {
  const { updateConfig } = await import('../lib/config.mjs');
  await updateConfig(dir, (c) => { c.mutation = { ...(c.mutation ?? {}), ...patch }; return c; });
};

async function rig(version, extra = {}) {
  const { addPhase, findPhase } = await import('../lib/roadmap.mjs');
  const p = await makeProject('py');
  await addPhase(p.dir, { number: 5, name: 'Workers' });
  put(p.dir, 'pkg/mod.py', 'def f(x):\n    return x + 1\n'); put(p.dir, 'tests/test_m.py', '# t\n'); commit(p.dir, 'work (phase 5 t1)');
  installStub(p.dir, 'mutmut');
  p.log = join(p.dir, 'stub.log');
  p.env = restrictedEnv([join(p.dir, 'stubbin')], { MUTATE_STUB_LOG: p.log, MUTATE_STUB_VERSION: version, ...extra });
  return { p, slug: findPhase(p.dir, '5').slug };
}
const runArgv = (p) => logLines(p.log).filter((l) => l.tool === 'mutmut' && l.argv[0] === 'run').map((l) => l.argv);

test('#188: mutation.max_children reaches mutmut 3 as --max-children, and the phase key wins', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const { p, slug } = await rig('mutmut, version 3.8.0');
  try {
    await runMutate(p.dir, slug, { env: p.env });
    assert.ok(runArgv(p).every((a) => !a.includes('--max-children')), 'no key, no flag: mutmut keeps its default');
    await cfgSet(p.dir, { max_children: 3 });
    await runMutate(p.dir, slug, { env: p.env });
    let a = runArgv(p).at(-1);
    assert.deepEqual(a.slice(0, 3), ['run', '--max-children', '3']);
    await cfgSet(p.dir, { phases: { 5: { max_children: 2 } } });
    await runMutate(p.dir, slug, { env: p.env });
    a = runArgv(p).at(-1);
    assert.deepEqual(a.slice(0, 3), ['run', '--max-children', '2'], 'mutation.phases.5.max_children beats the project key');
    const help = readFileSync(join(REAL, 'mutmut3-help.txt'), 'utf8');
    assert.ok(help.includes('--max-children'), 'the flag is in mutmut 3\'s real help');
  } finally { rmSync(p.dir, { recursive: true, force: true }); }
});

test('#188: a bad value is ignored with a warning; mutmut 2 says the key does not apply', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  let { p, slug } = await rig('mutmut, version 3.8.0');
  try {
    await cfgSet(p.dir, { max_children: 'lots' });
    const r = await runMutate(p.dir, slug, { env: p.env });
    assert.ok(runArgv(p).every((a) => !a.includes('--max-children')));
    assert.ok(r.warnings.some((w) => /mutation\.max_children/.test(w)), JSON.stringify(r.warnings));
  } finally { rmSync(p.dir, { recursive: true, force: true }); }
  ({ p, slug } = await rig('2.4.4', { MUTATE_STUB_V2_REAL: '1', MUTATE_STUB_REPORT: join(FX, 'mutmut2-junit.xml') }));
  try {
    await cfgSet(p.dir, { max_children: 3 });
    const r = await runMutate(p.dir, slug, { env: p.env });
    assert.ok(runArgv(p).every((a) => !a.includes('--max-children')), 'mutmut 2 has no such flag');
    assert.ok(r.warnings.some((w) => /max_children.*mutmut 2/.test(w)), JSON.stringify(r.warnings));
  } finally { rmSync(p.dir, { recursive: true, force: true }); }
});
