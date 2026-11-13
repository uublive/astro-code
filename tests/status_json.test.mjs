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

const KEYS = ['activity', 'activityUntil', 'branch', 'milestone', 'next', 'phase', 'phases', 'project', 'root', 'siblings', 'version'];

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

// --- phase 58: owner, effective tie, mine, onBranch, registry (offline) ---------------------
import { readFileSync } from 'node:fs';
import { initRegistry, claim, tieClaim, readRegistry } from '../lib/registry.mjs';

function mkTeam() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-sj-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  const home = mkdtempSync(join(tmpdir(), 'ac-sj-home-'));
  const mk = (email) => {
    const dir = mkProject(bare);
    git(['config', 'user.email', email], { cwd: dir });
    git(['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir }); // a born HEAD, so claims record a real branch
    return dir;
  };
  const a = mk('me@example.test');
  const b = mk('alex@example.test');
  assert.equal(initRegistry({ root: a }).ok, true);
  return { bare, home, a, b };
}
const runH = (home, args, cwd) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') } });
const statusH = (home, dir) => {
  const r = runH(home, ['status', '--json'], dir);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
// claim a phase from `dir` and add it to that clone's own roadmap
async function claimPhase(dir, name) {
  const c = claim({ root: dir, type: 'phase', milestone: 1, name });
  assert.equal(c.source, 'remote', c.error || '');
  await addPhase(dir, { number: c.number, name });
  return c.number;
}

test('rows carry the full owner email, mine, and registry-only rows; the tie is inherited, overridable, and never the historic branch', async () => {
  const { home, a, b } = mkTeam();
  const pa = await claimPhase(a, 'Alpha work');
  const pb = await claimPhase(b, 'Bravo work');
  const pa2 = await claimPhase(a, 'Alpha two');
  // a claim made while on develop records `branch: develop`; that history is not a tie
  git(['switch', '-q', '-c', 'develop'], { cwd: b });
  const pd = await claimPhase(b, 'Made on develop');
  assert.ok(readRegistry(b).registry.claims.some((c) => c.number === pd && c.branch === 'develop'));
  readRegistry(a); readRegistry(b); // refresh both local refs (a fetch is allowed here, not in status)
  git(['switch', '-q', '-c', 'feature/alpha'], { cwd: a });
  const pre = statusH(home, a).phases.find((p) => p.number === pd);
  assert.ok(!('feature_branch' in pre) && pre.onBranch === false, 'historic claim branch develop is untied');
  assert.equal(tieClaim({ root: a, type: 'phase', number: pa, tie: 'feature/alpha' }).ok, true);
  assert.equal(tieClaim({ root: a, type: 'milestone', number: 1, tie: 'feature/alpha' }).ok, true);
  tieClaim({ root: a, type: 'phase', number: pa2, tie: null }); // explicit untie beats the milestone tie
  readRegistry(a);

  const j = statusH(home, a);
  assert.equal(j.registry, true);
  assert.equal(j.branch, 'feature/alpha');
  assert.ok(j.registry_ref.endsWith('astro-registry') || j.registry_ref.endsWith('packed-refs'), j.registry_ref);
  const row = (n) => j.phases.find((p) => p.number === n);
  assert.deepEqual([row(pa).owner, row(pa).mine, row(pa).feature_branch, row(pa).onBranch], ['me@example.test', true, 'feature/alpha', true]);
  assert.ok(!('tied_by' in row(pa)), 'its own tie, not inherited');
  assert.deepEqual([row(pb).owner, row(pb).mine, row(pb).owner_tag, row(pb).remote], ['alex@example.test', false, 'a', true]);
  assert.equal(row(pb).tied_by, 'milestone', 'B\'s untied phase inherits the milestone tie');
  assert.equal(row(pb).feature_branch, 'feature/alpha');
  assert.equal(row(pb).milestone, 1);
  assert.equal(row(pb).status, 'pending');
  assert.ok(!('feature_branch' in row(pa2)) && row(pa2).onBranch === false, 'a phase null overrides the milestone tie');
  assert.ok(!('owner_tag' in row(pa)), 'a tag only on rows that are not mine');

  git(['switch', '-q', '-c', 'develop'], { cwd: a });
  const d = statusH(home, a);
  assert.equal(d.branch, 'develop');
  assert.ok(d.phases.every((p) => p.onBranch === false));
  assert.ok(!('feature_branch' in statusH(home, b).phases.find((p) => p.number === pa2)));
});

test('B sees A\'s rows as not mine', async () => {
  const { home, a, b } = mkTeam();
  const pa = await claimPhase(a, 'Alpha work');
  readRegistry(b);
  const jb = statusH(home, b);
  assert.equal(jb.phases.find((p) => p.number === pa).mine, false);
  const ja = statusH(home, a);
  assert.equal(ja.phases.find((p) => p.number === pa).mine, true);
});

test('with no registry ref there are no ownership keys and no registry key', async () => {
  const dir = mkProject();
  await addPhase(dir, { number: 1, name: 'First' });
  const j = asJson(dir);
  assert.ok(!('registry' in j) && !('registry_ref' in j));
  for (const k of ['owner', 'mine', 'onBranch', 'feature_branch']) assert.ok(!(k in j.phases[0]), k);
});

test('status --json stays offline: an unreachable remote still succeeds and the local ref does not move', async () => {
  const { home, a } = mkTeam();
  await claimPhase(a, 'Alpha work');
  readRegistry(a);
  const before = readFileSync(statusH(home, a).registry_ref, 'utf8');
  git(['remote', 'set-url', 'origin', join(a, 'nowhere.git')], { cwd: a });
  const j = statusH(home, a);
  assert.equal(j.registry, true);
  assert.equal(readFileSync(j.registry_ref, 'utf8'), before);
});
