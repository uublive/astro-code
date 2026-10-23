// Phase 43 t2 — `ac status --json` and the `Next:` line. The primary recommendation is the
// ONE existing rule (hooks/_astro-ctx.mjs nextAction); these tests pin that the CLI relays it
// verbatim and that lib/nextstep.mjs adds only siblings + admissibility. New module reached by
// `await import` (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';
import { addPhase, findPhase, setPhaseStatus } from '../lib/roadmap.mjs';
import { readContext, nextAction, ACTIVITY_TTL_SECONDS } from '../hooks/_astro-ctx.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const run = (args, cwd) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8' });

function mkProject(origin) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-sj-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  if (origin) git(['remote', 'add', 'origin', origin], { cwd: dir });
  initPlanning(dir, { name: 'sjproj' });
  return dir;
}
const phaseFile = (dir, slug, name, body) => {
  const d = join(paths(dir).phases, slug);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, name), body);
};
const asJson = (dir) => {
  const res = run(['status', '--json'], dir);
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
};

const KEYS = ['activity', 'activityUntil', 'milestone', 'next', 'phase', 'phases', 'project', 'root', 'siblings', 'version'];

test('ac status --json prints exactly the contract keys and next is nextAction verbatim', async () => {
  const dir = mkProject();
  await addPhase(dir, { number: 1, name: 'First' });
  const j = asJson(dir);
  assert.deepEqual(Object.keys(j).sort(), KEYS);
  assert.equal(j.next, nextAction(readContext(dir, Math.floor(Date.now() / 1000))));
  assert.equal(j.next, '/astro-discuss 1');
  assert.equal(j.phase.number, 1);
});

test('activityUntil is when ac stops reporting the verb, so the band can age it out without polling', async () => {
  const dir = mkProject();
  await addPhase(dir, { number: 1, name: 'First' });
  assert.equal(asJson(dir).activityUntil, null);
  assert.equal(run(['activity', '⚙ executing'], dir).status, 0);
  const at = Math.floor(Date.now() / 1000);
  const j = asJson(dir);
  assert.equal(j.activity, '⚙ executing');
  assert.ok(Math.abs(j.activityUntil - (at + ACTIVITY_TTL_SECONDS)) <= 2, String(j.activityUntil));
  assert.equal(run(['activity', 'clear'], dir).status, 0);
  assert.equal(asJson(dir).activityUntil, null);
});

test('next follows real state: undiscussed, discussed, planned, executing, verified, complete', async () => {
  const dir = mkProject();
  await addPhase(dir, { number: 1, name: 'First' });
  const slug = findPhase(dir, '1').slug;
  const expect = () => assert.equal(asJson(dir).next, nextAction(readContext(dir, Math.floor(Date.now() / 1000))));
  expect();
  phaseFile(dir, slug, 'CONTEXT.md', '<!-- astro-discuss: captured -->\n# ctx\n');
  expect(); assert.equal(asJson(dir).next, '/astro-plan 1');
  phaseFile(dir, slug, 'PLAN.md', '# plan\n');
  expect(); assert.equal(asJson(dir).next, '/astro-execute 1');
  await setPhaseStatus(dir, slug, 'executing');
  expect(); assert.equal(asJson(dir).next, '/astro-execute 1');
  await setPhaseStatus(dir, slug, 'verified');
  expect(); assert.equal(asJson(dir).next, '/astro-accept 1');
  await setPhaseStatus(dir, slug, 'complete');
  expect(); assert.equal(asJson(dir).next, '/astro-status');
  assert.equal(asJson(dir).phase, null);
});

test('siblings: at most 2, never next, no duplicates, admissible, by existing phase number', async () => {
  const { admits } = await import('../lib/nextstep.mjs');
  const dir = mkProject();
  await addPhase(dir, { number: 1, name: 'One' });
  await addPhase(dir, { number: 2, name: 'Two' });
  await addPhase(dir, { number: 3, name: 'Three' });
  await setPhaseStatus(dir, findPhase(dir, '1').slug, 'verified');
  phaseFile(dir, findPhase(dir, '2').slug, 'PLAN.md', '# plan\n');
  const j = asJson(dir);
  assert.ok(j.siblings.length <= 2);
  assert.ok(!j.siblings.includes(j.next));
  assert.equal(new Set(j.siblings).size, j.siblings.length);
  for (const s of j.siblings) {
    const m = /^\/astro-(discuss|plan|execute|verify|accept) (\d+)$/.exec(s);
    assert.ok(m, s);
    const ph = j.phases.find((p) => p.number === Number(m[2]));
    assert.ok(ph, `${s} names an existing phase`);
    assert.ok(admits(ph, m[1]), `${s} admissible`);
  }
});

test('siblingCommands: the pipeline feed after execute/accept', async () => {
  const { siblingCommands } = await import('../lib/nextstep.mjs');
  const ph = (number, status, planned = false, discussed = false) => ({ number, status, planned, discussed });
  assert.deepEqual(siblingCommands([ph(1, 'pending', true), ph(2, 'pending')], '/astro-execute 1'), ['/astro-discuss 2']);
  assert.deepEqual(siblingCommands([ph(1, 'verified'), ph(2, 'pending', false, true)], '/astro-accept 1'), ['/astro-plan 2']);
  // a planned phase after N is not "unplanned": nothing to feed
  assert.deepEqual(siblingCommands([ph(1, 'pending', true), ph(2, 'pending', true)], '/astro-execute 1'), []);
  // only phases numbered AFTER N feed
  assert.deepEqual(siblingCommands([ph(1, 'pending'), ph(2, 'pending', true)], '/astro-execute 2'), []);
});

test('siblingCommands: a waiting verified phase gets accept; none for /astro-status; empty; rejected', async () => {
  const { siblingCommands } = await import('../lib/nextstep.mjs');
  const ph = (number, status, planned = false, discussed = false) => ({ number, status, planned, discussed });
  assert.deepEqual(siblingCommands([ph(1, 'verified'), ph(2, 'executing')], '/astro-execute 2'), ['/astro-accept 1']);
  assert.deepEqual(siblingCommands([ph(1, 'verified')], '/astro-status'), []);
  assert.deepEqual(siblingCommands([], '/astro-discuss 1'), []);
  assert.deepEqual(siblingCommands([], '/astro-execute 1'), []);
  // N itself is never its own sibling
  assert.deepEqual(siblingCommands([ph(1, 'verified')], '/astro-accept 1'), []);
  // a rejected phase routes to plan: no feed, no gate
  assert.deepEqual(siblingCommands([ph(1, 'rejected'), ph(2, 'pending')], '/astro-plan 1'), []);
  // several mid-flight phases: still at most 2, de-duplicated
  const many = siblingCommands([ph(1, 'executing'), ph(2, 'verified'), ph(3, 'verified'), ph(4, 'pending')], '/astro-execute 1');
  assert.deepEqual(many, ['/astro-discuss 4', '/astro-accept 2']);
});

test('admits: which verbs a phase state allows', async () => {
  const { admits } = await import('../lib/nextstep.mjs');
  for (const s of ['pending', 'rejected']) { assert.ok(admits({ status: s }, 'discuss')); assert.ok(admits({ status: s }, 'plan')); }
  for (const s of ['executing', 'verified', 'complete']) { assert.ok(!admits({ status: s }, 'discuss')); assert.ok(!admits({ status: s }, 'plan')); }
  assert.ok(admits({ status: 'pending', planned: true }, 'execute'));
  assert.ok(!admits({ status: 'pending', planned: false }, 'execute'));
  assert.ok(admits({ status: 'executing' }, 'execute'));
  assert.ok(!admits({ status: 'verified' }, 'execute'));
  assert.ok(admits({ status: 'executing' }, 'verify'));
  assert.ok(!admits({ status: 'pending' }, 'verify'));
  assert.ok(admits({ status: 'verified' }, 'accept'));
  for (const s of ['pending', 'executing', 'rejected', 'complete']) assert.ok(!admits({ status: s }, 'accept'));
  assert.ok(!admits({ status: 'pending' }, 'status'));
});

test('--json outside a project exits non-zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ac-sj-none-'));
  assert.notEqual(run(['status', '--json'], dir).status, 0);
});

test('text status prints one Next line, with siblings as (also ...)', async () => {
  const dir = mkProject();
  await addPhase(dir, { number: 1, name: 'One' });
  await addPhase(dir, { number: 2, name: 'Two' });
  phaseFile(dir, findPhase(dir, '1').slug, 'PLAN.md', '# plan\n');
  const out = run(['status'], dir).stdout;
  const lines = out.split('\n').filter((l) => /^Next:/.test(l));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\/astro-execute 1/);
  assert.match(lines[0], /\(also \/astro-discuss 2\)/);
  assert.ok(out.indexOf('Next:') < out.indexOf('Phases:'));
});

test('--json does not read the registry: unreachable origin, no registry text', async () => {
  const dir = mkProject('/nonexistent/origin.git');
  await addPhase(dir, { number: 1, name: 'One' });
  const res = run(['status', '--json'], dir);
  assert.equal(res.status, 0, res.stderr);
  assert.doesNotMatch(res.stdout + res.stderr, /registry|unreachable/i);
  JSON.parse(res.stdout);
});

test('a command run beside an executing phase restores its verb on clear, so the run keeps its live status', async () => {
  const dir = mkProject();
  await addPhase(dir, { number: 1, name: 'First' });
  assert.equal(run(['activity', '⚙ executing'], dir).status, 0);
  assert.equal(run(['activity', '✎ discussing 2'], dir).status, 0);
  assert.equal(asJson(dir).activity, '✎ discussing 2');
  assert.equal(run(['activity', 'clear'], dir).status, 0);
  assert.equal(asJson(dir).activity, '⚙ executing', 'the executing verb is back');
  assert.equal(run(['activity', 'clear'], dir).status, 0);
  assert.equal(asJson(dir).activity, null);
  // the same verb twice is a refresh, not a stack
  run(['activity', '⚙ executing'], dir);
  run(['activity', '⚙ executing'], dir);
  run(['activity', 'clear'], dir);
  assert.equal(asJson(dir).activity, null);
});

test('while phase N executes, next is not /astro-execute N: the next phase\'s step is offered instead', async () => {
  const dir = mkProject();
  await addPhase(dir, { number: 1, name: 'First' });
  await addPhase(dir, { number: 2, name: 'Second' });
  const s1 = findPhase(dir, '1').slug;
  const s2 = findPhase(dir, '2').slug;
  phaseFile(dir, s1, 'CONTEXT.md', '<!-- astro-discuss: captured -->\n# ctx\n');
  phaseFile(dir, s1, 'PLAN.md', '# plan\n');
  phaseFile(dir, s2, 'CONTEXT.md', '<!-- astro-discuss: captured -->\n# ctx\n');
  run(['state', 'set', 'active_phase', s1], dir);
  assert.equal(asJson(dir).next, '/astro-execute 1');
  run(['activity', '⚙ executing'], dir);
  const j = asJson(dir);
  assert.equal(j.next, '/astro-plan 2');
  assert.ok(!j.siblings.includes('/astro-execute 1'));
  assert.match(run(['status'], dir).stdout, /Next:\s+\/astro-plan 2/);
  run(['activity', 'clear'], dir);
  assert.equal(asJson(dir).next, '/astro-execute 1');
});
