// ADR-094 (phase 57 t16): `ac milestone verify|repair`, the close refusal and the release-notes line, through the
// real CLI in real tmp git projects. The C8 layout: P1 has two Cheap lines, P2 one, P3 none; Cheap lines append
// `<phase>:<id>:<HEAD>` to a log outside the repo, the suite (`verify.suite_command`) appends `SUITE:<HEAD>`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase, setPhaseStatus } from '../lib/roadmap.mjs';
import { paths } from '../lib/paths.mjs';
import { readJSON, atomicWriteJSON } from '../lib/util.mjs';
import { initRegistry } from '../lib/registry.mjs';
import { git } from '../lib/git.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const { NODE_TEST_CONTEXT, ...CLEAN_ENV } = process.env;
const ac = (cwd, ...a) => spawnSync(process.execPath, [AC, ...a], { cwd, encoding: 'utf8', env: { ...CLEAN_ENV, ASTRO_SIGNER_AGENT: '' } });
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const head = (cwd) => sh(cwd, 'rev-parse', 'HEAD').stdout.trim();
const put = (root, rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const commit = (root, msg) => { sh(root, 'add', '-A'); sh(root, 'commit', '-qm', msg); };
const OK = 'node -e "process.exit(0)"';
const logCmd = (log, tag) => `echo "${tag}:$(git rev-parse HEAD)" >> '${log}'`;
const crit = (log, tag, n) => Array.from({ length: n }, (_, i) =>
  [`### C${i + 1} — claim ${i + 1}`, `- **Cheap:** \`${logCmd(log, `${tag}:C${i + 1}`)}\``, ''].join('\n')).join('\n');

async function project({ fast = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-mfc-cli-'));
  const out = mkdtempSync(join(tmpdir(), 'ac-mfc-cli-out-'));
  const log = join(out, 'log');
  writeFileSync(log, '');
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'mproj' });
  for (const [n, name] of [[1, 'One'], [2, 'Two'], [3, 'Three']]) await addPhase(dir, { number: n, name, milestone: 1 });
  const slugs = [1, 2, 3].map((n) => findPhase(dir, String(n)).slug);
  put(dir, `.astrocode/phases/${slugs[0]}/CRITERIA.md`, crit(log, 'P1', 2));
  put(dir, `.astrocode/phases/${slugs[1]}/CRITERIA.md`, crit(log, 'P2', 1));
  put(dir, `.astrocode/phases/${slugs[2]}/CRITERIA.md`, '### C1 — nothing cheap\n- **Observe:** by hand\n');
  assert.equal(ac(dir, 'config', 'set', 'verify.suite_command', logCmd(log, 'SUITE')).status, 0);
  commit(dir, 'init');
  if (fast) {
    put(dir, 'docs.md', 'docs\n');
    commit(dir, 'docs (phase 1 t1)');
    const rec = ac(dir, 'verdict', 'record', '1', '--result', JSON.stringify({ mode: 'full', criteria: [{ id: 'C1', passed: true }, { id: 'C2', passed: true }] }));
    assert.equal(JSON.parse(rec.stdout).passed, true, rec.stderr);
    await setPhaseStatus(dir, slugs[0], 'verified');
    commit(dir, 'status');
  }
  return { dir, log, slugs, lines: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

test('C8: milestone verify --json exits 0 with one suite run and three Cheap lines at the tip; the text report leads with PASS', async () => {
  const p = await project();
  const tip = head(p.dir);
  const r = ac(p.dir, 'milestone', 'verify', '--json');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).passed, true);
  assert.deepEqual(p.lines().filter((l) => l.startsWith('SUITE:')), [`SUITE:${tip}`]);
  assert.equal(p.lines().filter((l) => !l.startsWith('SUITE:')).length, 3);
  assert.ok(p.lines().every((l) => l.endsWith(tip)));
  const text = ac(p.dir, 'milestone', 'verify');
  assert.equal(text.stdout.split('\n')[0], `✓ milestone 1 full check PASS on ${tip.slice(0, 7)}`);
});

// A failing layout: P2's Cheap check needs a flag file, and one test always fails.
async function failing() {
  const p = await project();
  const out = mkdtempSync(join(tmpdir(), 'ac-mfc-flag-'));
  const flag = join(out, 'ok');
  put(p.dir, `.astrocode/phases/${p.slugs[1]}/CRITERIA.md`, `### C1 — two needs the flag\n- **Cheap:** \`test -f '${flag}'\`\n`);
  put(p.dir, 'src/t.mjs', 'export const v = 1;\n');
  put(p.dir, 'tests/t.test.mjs', "import '../src/t.mjs';\nprocess.exit(1);\n");
  commit(p.dir, 'break');
  assert.equal(ac(p.dir, 'config', 'set', 'verify.suite_command', 'node --test tests/t.test.mjs').status, 0);
  commit(p.dir, 'suite');
  return { ...p, flag };
}
const fixesOf = (dir) => JSON.parse(ac(dir, 'fix', 'list', '--json').stdout).filter((f) => f.fullcheck_from);

test('C9: a failing check exits 1, opens fixes tied to P2 and the milestone, and a re-run adds none', async () => {
  const p = await failing();
  const r = ac(p.dir, 'milestone', 'verify');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^✖ milestone 1 full check FAIL on /);
  const phases = fixesOf(p.dir).map((f) => f.fullcheck_from.phase).sort((a, b) => String(a).localeCompare(String(b)));
  assert.deepEqual(phases.map((x) => x === null ? 'null' : x === p.slugs[1] ? 'P2' : x).sort(), ['P2', 'null']);
  assert.equal(ac(p.dir, 'milestone', 'verify').status, 1);
  assert.equal(fixesOf(p.dir).length, 2);
});

test('C10/C12: complete refuses with one line naming the command, then the open fixes, then a new commit; a passing check lets it through', async () => {
  const p = await project({ fast: true });
  const a = ac(p.dir, 'milestone', 'complete', '--force');
  assert.notEqual(a.status, 0);
  assert.match(a.stderr, /ac milestone verify/);
  assert.equal(a.stderr.trim().split('\n').length, 1, 'one line');
  // (b) a failing check
  put(p.dir, `.astrocode/phases/${p.slugs[1]}/CRITERIA.md`, '### C1 — two\n- **Cheap:** `node -e "process.exit(1)"`\n');
  commit(p.dir, 'break');
  assert.equal(ac(p.dir, 'milestone', 'verify').status, 1);
  const [fix] = fixesOf(p.dir);
  const b = ac(p.dir, 'milestone', 'complete', '--force');
  assert.notEqual(b.status, 0);
  assert.ok(b.stderr.includes(fix.id), b.stderr);
  // (c) fixed and verified, a passing check, then close on a copy
  put(p.dir, `.astrocode/phases/${p.slugs[1]}/CRITERIA.md`, `### C1 — two\n- **Cheap:** \`${OK}\`\n`);
  assert.equal(ac(p.dir, 'fix', 'status', fix.id, 'verified').status, 0);
  commit(p.dir, 'repair');
  assert.equal(ac(p.dir, 'milestone', 'verify').status, 0);
  const copy = mkdtempSync(join(tmpdir(), 'ac-mfc-copy-'));
  cpSync(p.dir, copy, { recursive: true });
  const c = ac(copy, 'milestone', 'complete', '--force');
  assert.equal(c.status, 0, c.stderr);
  // (d) one more commit
  put(p.dir, 'more.md', 'more\n');
  commit(p.dir, 'more');
  const d = ac(p.dir, 'milestone', 'complete', '--force');
  assert.notEqual(d.status, 0);
  assert.match(d.stderr, /not the current tip/);
});

test('C11: milestone repair <id> is bounded; with no id it reports fixed and still-open fixes, and nothing when there are none', async () => {
  const none = await project();
  assert.equal(ac(none.dir, 'milestone', 'repair').stdout, '');
  const p = await failing();
  assert.equal(ac(p.dir, 'milestone', 'verify').status, 1);
  const fixes = fixesOf(p.dir);
  const crit2 = fixes.find((f) => f.fullcheck_from.criterion === 'C1');
  const sticky = fixes.find((f) => f.fullcheck_from.criterion === null);
  writeFileSync(p.flag, '');
  const fixed = JSON.parse(ac(p.dir, 'milestone', 'repair', crit2.id, '--json').stdout);
  assert.equal(fixed.passed, true);
  assert.equal(JSON.parse(ac(p.dir, 'milestone', 'repair', sticky.id, '--json').stdout).passed, false);
  assert.equal(JSON.parse(ac(p.dir, 'milestone', 'repair', sticky.id, '--json').stdout).attempt, 2);
  assert.equal(JSON.parse(ac(p.dir, 'milestone', 'repair', sticky.id, '--json').stdout).exhausted, true);
  const report = ac(p.dir, 'milestone', 'repair').stdout.split('\n').filter(Boolean);
  assert.deepEqual(report, [`✓ fixed ${crit2.id}`, `• still open ${sticky.id} (2/2 attempts)`]);
});

test('C13: flow release prints the pending line, and none after a passing check', async () => {
  const p = await project({ fast: true });
  const cfg = readJSON(paths(p.dir).config);
  cfg.gitflow = { enabled: true, main: 'main', develop: 'develop', prefixes: { feature: 'feature', release: 'release', hotfix: 'hotfix' }, pr: 'none' };
  atomicWriteJSON(paths(p.dir).config, cfg);
  sh(p.dir, 'branch', '-M', 'main');
  commit(p.dir, 'flow config');
  const bare = mkdtempSync(join(tmpdir(), 'ac-mfc-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  git(['config', 'core.hooksPath', join(bare, 'hooks')], { cwd: bare });
  git(['remote', 'add', 'origin', bare], { cwd: p.dir });
  git(['push', '-u', 'origin', 'main'], { cwd: p.dir });
  assert.equal(initRegistry({ root: p.dir }).ok, true);
  assert.equal(ac(p.dir, 'flow', 'init').status, 0);
  sh(p.dir, 'switch', 'develop');
  git(['remote', 'set-url', 'origin', 'https://github.com/test-owner/test-repo.git'], { cwd: p.dir });
  git(['config', `url.${bare}.insteadOf`, 'https://github.com/test-owner/test-repo.git'], { cwd: p.dir });
  const line = 'Full check pending (fast-verified, ADR-094): phase 1 One';
  const before = ac(p.dir, 'flow', 'release');
  assert.equal(before.status, 0, before.stderr);
  assert.equal(before.stdout.split('\n').filter((l) => l.includes(line)).length, 1, before.stdout);
  assert.equal(ac(p.dir, 'milestone', 'verify').status, 0);
  assert.doesNotMatch(ac(p.dir, 'flow', 'release').stdout, /Full check pending/);
});

test('ac help lists both milestone verbs', () => {
  const help = ac(process.cwd(), 'help').stdout;
  assert.match(help, /ac milestone verify \[--json\]/);
  assert.match(help, /ac milestone repair \[<fix>\] \[--json\]/);
});
