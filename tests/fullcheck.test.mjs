// ADR-094 (phase 57 t11): the milestone full check. Real scratch git repo with a roadmap (the C8 layout: P1 has
// two Cheap lines, P2 one, P3 none). Cheap lines append `<phase>:<id>:<HEAD>` to a log outside the repo, and the
// suite (`verify.suite_command`) appends `SUITE:<HEAD>`. Dynamic imports (ADR-018), the real shell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase, setPhaseStatus } from '../lib/roadmap.mjs';

const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const head = (cwd) => sh(cwd, 'rev-parse', 'HEAD').stdout.trim();
const put = (root, rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const commit = (root, msg) => { sh(root, 'add', '-A'); sh(root, 'commit', '-qm', msg); };
const { NODE_TEST_CONTEXT, ...CLEAN_ENV } = process.env;
const spawn = (cmd, o) => spawnSync(cmd, { ...o, env: CLEAN_ENV });
const OK = 'node -e "process.exit(0)"';
const BAD = 'node -e "process.exit(1)"';

const logCmd = (log, tag) => `echo "${tag}:$(git rev-parse HEAD)" >> '${log}'`;
const crit = (log, tag, n) => Array.from({ length: n }, (_, i) =>
  [`### C${i + 1} — claim ${i + 1}`, `- **Cheap:** \`${logCmd(log, `${tag}:C${i + 1}`)}\``, ''].join('\n')).join('\n');

async function project({ suite = true, setting = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fullcheck-'));
  const out = mkdtempSync(join(tmpdir(), 'ac-fullcheck-out-'));
  const log = join(out, 'log');
  writeFileSync(log, '');
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'fproj' });
  for (const [n, name] of [[1, 'One'], [2, 'Two'], [3, 'Three']]) await addPhase(dir, { number: n, name, milestone: 1 });
  const slugs = [1, 2, 3].map((n) => findPhase(dir, String(n)).slug);
  put(dir, `.astrocode/phases/${slugs[0]}/CRITERIA.md`, crit(log, 'P1', 2));
  put(dir, `.astrocode/phases/${slugs[1]}/CRITERIA.md`, crit(log, 'P2', 1));
  put(dir, `.astrocode/phases/${slugs[2]}/CRITERIA.md`, '### C1 — nothing cheap\n- **Observe:** by hand\n');
  const cfgFile = join(dir, '.astrocode', 'config.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
  cfg.verify = { ...(suite ? { suite_command: logCmd(log, 'SUITE') } : {}), ...setting };
  writeFileSync(cfgFile, JSON.stringify(cfg));
  commit(dir, 'init');
  return { dir, log, slugs, lines: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

// A fast verdict on P1 (docs-only phase: no linked tests), then the status moves to verified.
async function fastVerify(p, i = 0) {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  put(p.dir, `docs${i}.md`, 'docs\n');
  commit(p.dir, `docs (phase 0${i + 1} t1)`);
  const out = await recordVerdict(p.dir, p.slugs[i], { mode: 'full', criteria: [{ id: 'C1', passed: true }, ...(i === 0 ? [{ id: 'C2', passed: true }] : [])] });
  assert.equal(out.passed, true, JSON.stringify(out));
  await setPhaseStatus(p.dir, p.slugs[i], 'verified');
  commit(p.dir, 'status');
}

test('C8: one suite run and exactly the three Cheap lines, all at the tip; the result is stored by tip', async () => {
  const { runFullCheck, readFullCheck, fullCheckDir } = await import('../lib/fullcheck.mjs');
  const p = await project();
  const tip = head(p.dir);
  const res = await runFullCheck(p.dir, { spawn });
  assert.equal(res.passed, true, JSON.stringify(res.failures));
  const lines = p.lines();
  assert.deepEqual(lines.filter((l) => l.startsWith('SUITE:')), [`SUITE:${tip}`]);
  assert.deepEqual(lines.filter((l) => !l.startsWith('SUITE:')).sort(), [`P1:C1:${tip}`, `P1:C2:${tip}`, `P2:C1:${tip}`]);
  assert.ok(existsSync(join(fullCheckDir(p.dir), `${tip}.json`)));
  assert.equal(readFullCheck(p.dir, tip).passed, true);
  assert.equal(res.cheap.length, 3);
});

test('C9: failures become fixes tied to the phase (criterion, stamped test, unstamped test), deduplicated, flaky ignored', async () => {
  const { runFullCheck } = await import('../lib/fullcheck.mjs');
  const { fullCheckFixes } = await import('../lib/fixes.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ac-fullcheck9-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'f9' });
  await addPhase(dir, { number: 1, name: 'One', milestone: 1 });
  await addPhase(dir, { number: 2, name: 'Two', milestone: 1 });
  const [s1, s2] = [1, 2].map((n) => findPhase(dir, String(n)).slug);
  put(dir, `.astrocode/phases/${s1}/CRITERIA.md`, '### C1 — fine\n- **Cheap:** `' + OK + '`\n');
  put(dir, `.astrocode/phases/${s2}/CRITERIA.md`, '### C1 — two is broken\n- **Cheap:** `' + BAD + '`\n');
  put(dir, 'src/s1.mjs', 'export const v = 1;\n');
  put(dir, 'src/s2.mjs', 'export const v = 1;\n');
  put(dir, 'src/ok.mjs', 'export const v = 1;\n');
  put(dir, 'tests/t1.test.mjs', "import '../src/s1.mjs';\nprocess.exit(1);\n");
  put(dir, 'tests/t2.test.mjs', "import '../src/s2.mjs';\nprocess.exit(1);\n");
  put(dir, 'tests/ok.test.mjs', "import '../src/ok.mjs';\n");
  put(dir, 'tests/flaky.test.mjs', "import '../src/ok.mjs';\nif (process.env.FLAKY) process.exit(1);\n");
  const cfgFile = join(dir, '.astrocode', 'config.json');
  writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(readFileSync(cfgFile, 'utf8')), verify: { suite_command: 'FLAKY=1 node --test tests/t1.test.mjs tests/t2.test.mjs tests/ok.test.mjs tests/flaky.test.mjs' } }));
  commit(dir, 'base');
  put(dir, 'src/s1.mjs', 'export const v = 2;\n');
  commit(dir, 'feat s1 (phase 01 t1)');
  put(dir, 'src/s2.mjs', 'export const v = 2;\n');
  commit(dir, 'chore: unstamped s2');

  const res = await runFullCheck(dir, { spawn });
  assert.equal(res.passed, false);
  assert.deepEqual(res.flaky, ['tests/flaky.test.mjs']);
  const fixes = fullCheckFixes(dir, { milestone: 1 });
  const by = (f) => `${f.fullcheck_from.phase}|${f.fullcheck_from.criterion}|${f.fullcheck_from.test}`;
  assert.deepEqual(fixes.map(by).sort(), [`${s2}|C1|null`, `${s1}|null|tests/t1.test.mjs`, `null|null|tests/t2.test.mjs`].sort());
  const crit2 = fixes.find((f) => f.fullcheck_from.criterion === 'C1');
  assert.equal(crit2.fullcheck_from.command, BAD);
  assert.match(crit2.repro, /process\.exit\(1\)/);
  assert.equal(sh(dir, 'status', '--porcelain').stdout.trim(), '', 'fixes.json was committed');
  assert.match(sh(dir, 'log', '-1', '--format=%s').stdout, /^chore\(fullcheck\): milestone 1 — 3 fix\(es\) opened/);

  const again = await runFullCheck(dir, { spawn });
  assert.equal(again.passed, false);
  assert.equal(fullCheckFixes(dir, { milestone: 1 }).length, 3, 'a second run opens no duplicate');
});

test('C10 gate: no result, open fixes, a passing result at HEAD, then a new commit', async () => {
  const { runFullCheck, fullCheckGate, milestonePhases } = await import('../lib/fullcheck.mjs');
  const { fullCheckFixes, setFixStatus } = await import('../lib/fixes.mjs');
  const p = await project();
  await fastVerify(p);
  const g = () => fullCheckGate(p.dir, milestonePhases(p.dir));
  // (a) no result
  let r = g();
  assert.equal(r.ok, false);
  assert.equal(r.required, true);
  assert.match(r.reason, /ac milestone verify/);
  // (b) a failing check with open fixes
  put(p.dir, `.astrocode/phases/${p.slugs[1]}/CRITERIA.md`, `### C1 — claim\n- **Cheap:** \`${BAD}\`\n`);
  commit(p.dir, 'break p2');
  const failed = await runFullCheck(p.dir, { spawn });
  assert.equal(failed.passed, false);
  const [fix] = fullCheckFixes(p.dir, { milestone: 1 });
  r = g();
  assert.equal(r.ok, false);
  assert.ok(r.reason.includes(fix.id));
  // (c) fixed, verified, a passing check at HEAD
  put(p.dir, `.astrocode/phases/${p.slugs[1]}/CRITERIA.md`, `### C1 — claim\n- **Cheap:** \`${OK}\`\n`);
  await setFixStatus(p.dir, fix.id, 'verified');
  commit(p.dir, 'repair p2');
  const passed = await runFullCheck(p.dir, { spawn });
  assert.equal(passed.passed, true, JSON.stringify(passed.failures));
  assert.deepEqual(g(), { ok: true, required: true, reason: null });
  // (d) one more commit
  put(p.dir, 'more.md', 'more\n');
  commit(p.dir, 'more');
  r = g();
  assert.equal(r.ok, false);
  assert.match(r.reason, /not the current tip/);
});

test('C6/C14: a milestone with no fast verdict does not require a check', async () => {
  const { fullCheckGate, milestonePhases } = await import('../lib/fullcheck.mjs');
  const p = await project();
  assert.deepEqual(fullCheckGate(p.dir, milestonePhases(p.dir)), { ok: true, required: false, reason: null });
});

test('pending: a fast-verified phase is pending until a passing check covers its verdict; a verdict without fast never is', async () => {
  const { runFullCheck, pendingPhases, milestonePhases } = await import('../lib/fullcheck.mjs');
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const p = await project();
  await fastVerify(p, 0);
  // P2 verified in phase mode: its verdict carries no `fast`
  const cfgFile = join(p.dir, '.astrocode', 'config.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
  writeFileSync(cfgFile, JSON.stringify({ ...cfg, verify: { ...cfg.verify, full_suite: 'phase' } }));
  commit(p.dir, 'phase mode');
  assert.equal((await recordVerdict(p.dir, p.slugs[1], { mode: 'full', criteria: [{ id: 'C1', passed: true }] })).passed, true);
  await setPhaseStatus(p.dir, p.slugs[1], 'verified');
  writeFileSync(cfgFile, JSON.stringify(cfg));
  commit(p.dir, 'back to fast mode');
  assert.deepEqual(pendingPhases(p.dir, milestonePhases(p.dir).phases).map((x) => x.slug), [p.slugs[0]]);
  assert.equal((await runFullCheck(p.dir, { spawn })).passed, true);
  assert.deepEqual(pendingPhases(p.dir, milestonePhases(p.dir).phases), []);
});

test('suite command resolution: setting, then a [suite] criterion, then npm test, then none', async () => {
  const { fullCheckSuiteCommand, runFullCheck } = await import('../lib/fullcheck.mjs');
  const p = await project({ suite: false });
  const phases = () => JSON.parse(readFileSync(join(p.dir, '.astrocode/roadmap.json'), 'utf8')).phases;
  assert.equal(fullCheckSuiteCommand(p.dir, phases()), null);
  put(p.dir, 'package.json', JSON.stringify({ scripts: { test: 'x' } }));
  assert.equal(fullCheckSuiteCommand(p.dir, phases()), 'npm test');
  put(p.dir, `.astrocode/phases/${p.slugs[2]}/CRITERIA.md`, '### C1 [suite] — the suite\n- **Observe:** `make check`\n');
  assert.equal(fullCheckSuiteCommand(p.dir, phases()), 'make check');
  const cfgFile = join(p.dir, '.astrocode', 'config.json');
  writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(readFileSync(cfgFile, 'utf8')), verify: { suite_command: ' echo mine ' } }));
  assert.equal(fullCheckSuiteCommand(p.dir, phases()), 'echo mine');
  // none at all: the check fails saying so
  const q = await project({ suite: false });
  commit(q.dir, 'noop');
  const res = await runFullCheck(q.dir, { spawn });
  assert.equal(res.passed, false);
  assert.match(res.failures[0].output, /no suite command — set verify\.suite_command/);
});

test('a dirty tree is refused', async () => {
  const { runFullCheck } = await import('../lib/fullcheck.mjs');
  const p = await project();
  put(p.dir, 'dirty.txt', 'd');
  await assert.rejects(runFullCheck(p.dir, { spawn }), /dirty/);
});

test('stampedPhase reads the same stamp rule as the phase->commits direction', async () => {
  const { stampedPhase } = await import('../lib/fixtures.mjs');
  assert.equal(stampedPhase('feat x (phase 07 t3)'), '7');
  assert.equal(stampedPhase('fix y (phase 12 remediate-c1)'), '12');
  assert.equal(stampedPhase('chore: nothing'), null);
});
