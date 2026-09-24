// CLI tests for the phase-23 provenance/surprise/harvest surface (t9): `ac phase reject
// --agent`, `ac phase surprise`, `ac phase context --author` and `ac milestone harvest`,
// driven exactly like tests/principles_cli.test.mjs and tests/backlog_cli.test.mjs — a real
// subprocess (spawnSync) against a real scratch project (`git init` + `ac init` + `ac phase
// add`), never against the engine directly, with `HOME` a fresh `mkdtempSync` dir and
// `ASTRO_PRINCIPLES_DIR` deleted from the env (C10).
//
// None of this is wired into `bin/ac.mjs` yet: `phase reject` only knows `--reason` (t8
// adds `--agent`), `phase context --author` is silently ignored (prints missing/stub/ready
// instead), `phase surprise` and `milestone harvest` are not subcommands at all. Every one
// of those is a clean non-zero exit or a wrong-but-successful print, never a crash — this
// file loads and runs fine, it just fails RED until t8 lands (ADR-018). The libraries these
// verbs will call (`lib/git.mjs`, `lib/paths.mjs`, `lib/util.mjs`) are already shipped, so no
// dynamic import is needed for this file itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { paths } from '../lib/paths.mjs';
import { readJSON } from '../lib/util.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');

function mkHome() {
  return mkdtempSync(join(tmpdir(), 'ac-capture-cli-home-'));
}

function envFor(home, extra = {}) {
  const env = { ...process.env, HOME: home };
  delete env.ASTRO_PRINCIPLES_DIR;
  env.GIT_AUTHOR_NAME = 'dev';
  env.GIT_AUTHOR_EMAIL = 'dev@example.com';
  env.GIT_COMMITTER_NAME = 'dev';
  env.GIT_COMMITTER_EMAIL = 'dev@example.com';
  Object.assign(env, extra);
  return env;
}

function run(args, cwd, home) {
  return spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8', env: envFor(home) });
}

function mkBareRemote() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-capture-cli-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  return bare;
}

function mkProject(home) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-capture-cli-proj-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  git(['remote', 'add', 'origin', mkBareRemote()], { cwd: dir });
  const init = run(['init'], dir, home);
  assert.strictEqual(init.status, 0, init.stderr);
  const reg = run(['registry', 'init'], dir, home);
  assert.strictEqual(reg.status, 0, reg.stderr);
  return dir;
}

function addPhase(dir, home, name) {
  const add = run(['phase', 'add', name], dir, home);
  assert.strictEqual(add.status, 0, add.stderr);
  const m = add.stdout.match(/^✓ phase (\d+) /);
  assert.ok(m, `phase add must print its number, got: ${add.stdout}`);
  const number = Number(m[1]);
  const roadmap = readJSON(paths(dir).roadmap);
  const slug = roadmap.phases.find((ph) => ph.number === number).slug;
  return { number, slug };
}

function phaseEntry(dir, slug, milestone) {
  const roadmap = milestone == null
    ? readJSON(paths(dir).roadmap)
    : readJSON(join(paths(dir).dir, 'milestones', String(milestone), 'roadmap.json'));
  return roadmap.phases.find((ph) => ph.slug === slug);
}

function principlesStoreExists(home) {
  return existsSync(join(home, '.astro', 'principles'));
}

test('ac phase reject --agent records an agent-kind rejection with the AGENT marker', () => {
  const home = mkHome();
  const dir = mkProject(home);
  const { number } = addPhase(dir, home, 'capture flow');

  const reject = run(['phase', 'reject', String(number), '--reason', 'bad environment', '--agent', 'bot'], dir, home);
  assert.strictEqual(reject.status, 0, reject.stderr);
  assert.match(reject.stdout, /AGENT — machine-signed, not human UAT/);
  assert.ok(!principlesStoreExists(home), 'a rejection must never create the principle store');
});

test('a plain ac phase reject (no --agent) records a human-kind rejection', () => {
  const home = mkHome();
  const dir = mkProject(home);
  const { number, slug } = addPhase(dir, home, 'capture flow two');

  const reject = run(['phase', 'reject', String(number), '--reason', 'manual QA caught it'], dir, home);
  assert.strictEqual(reject.status, 0, reject.stderr);
  assert.doesNotMatch(reject.stdout, /AGENT/);

  const ph = phaseEntry(dir, slug);
  assert.equal(ph.status, 'rejected');
  assert.equal(ph.rejections.length, 1);
  assert.equal(ph.rejections[0].kind, 'human');
  assert.equal(ph.rejections[0].reason, 'manual QA caught it');
  assert.equal('by' in ph.rejections[0], false, 'a human reject carries no `by`');
});

test('an unknown flag (ADR-029 typo guard) is refused and the roadmap is byte-for-byte unchanged', () => {
  const home = mkHome();
  const dir = mkProject(home);
  const { number } = addPhase(dir, home, 'capture flow three');

  const before = readFileSync(paths(dir).roadmap, 'utf8');
  const reject = run(['phase', 'reject', String(number), '--reason', 'x', '--agnet', 'bot'], dir, home);
  assert.notEqual(reject.status, 0, 'a typo\'d flag must be refused, not silently applied');
  const after = readFileSync(paths(dir).roadmap, 'utf8');
  assert.equal(after, before, 'nothing must be written when a flag is refused');
});

test('ac phase surprise with no signal exits clean, prints nothing, and writes no file', () => {
  const home = mkHome();
  const dir = mkProject(home);
  const { number, slug } = addPhase(dir, home, 'surprise phase clean');

  const surprise = run(
    ['phase', 'surprise', String(number), '--healed', '0', '--remediation-cycles', '0', '--stopped-reason', 'passed'],
    dir, home,
  );
  assert.strictEqual(surprise.status, 0, surprise.stderr);
  assert.equal(surprise.stdout, '');
  const file = join(paths(dir).phases, slug, 'SURPRISES.jsonl');
  assert.ok(!existsSync(file), 'a clean run must not create SURPRISES.jsonl');
});

test('ac phase surprise with a signal exits clean, prints nothing, and appends one JSONL line', () => {
  const home = mkHome();
  const dir = mkProject(home);
  const { number, slug } = addPhase(dir, home, 'surprise phase healed');

  const surprise = run(
    ['phase', 'surprise', String(number), '--healed', '2', '--note', 'x'],
    dir, home,
  );
  assert.strictEqual(surprise.status, 0, surprise.stderr);
  assert.equal(surprise.stdout, '');
  const file = join(paths(dir).phases, slug, 'SURPRISES.jsonl');
  assert.ok(existsSync(file), 'a surprising run must append to SURPRISES.jsonl');
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.deepEqual(entry.signals, ['healed']);
  assert.equal(entry.note, 'x');
});

test('ac phase context --author prints human, agent <name> and none for the three markers', () => {
  const home = mkHome();
  const dir = mkProject(home);
  const { number, slug } = addPhase(dir, home, 'context phase');
  const contextFile = join(paths(dir).phases, slug, 'CONTEXT.md');

  const missing = run(['phase', 'context', String(number), '--author'], dir, home);
  assert.strictEqual(missing.status, 0, missing.stderr);
  assert.equal(missing.stdout.trim(), 'none');

  writeFileSync(contextFile, '<!-- astro-discuss: captured -->\n\n# Discussion\n\nreal content\n');
  const human = run(['phase', 'context', String(number), '--author'], dir, home);
  assert.strictEqual(human.status, 0, human.stderr);
  assert.equal(human.stdout.trim(), 'human');

  writeFileSync(contextFile, '<!-- astro-discuss: captured by agent: fleet-1 -->\n\n# Discussion\n\nreal content\n');
  const agent = run(['phase', 'context', String(number), '--author'], dir, home);
  assert.strictEqual(agent.status, 0, agent.stderr);
  assert.equal(agent.stdout.trim(), 'agent fleet-1');

  writeFileSync(contextFile, '# Discussion\n\nnot really discussed yet\n');
  const stub = run(['phase', 'context', String(number), '--author'], dir, home);
  assert.strictEqual(stub.status, 0, stub.stderr);
  assert.equal(stub.stdout.trim(), 'none');
});

test('milestone harvest sees the human rejection live, then still sees it archived; the agent one stays skipped', () => {
  const home = mkHome();
  const dir = mkProject(home);
  const { number, slug } = addPhase(dir, home, 'harvested phase');

  const agentReject = run(['phase', 'reject', String(number), '--reason', 'went in blind', '--agent', 'bot'], dir, home);
  assert.strictEqual(agentReject.status, 0, agentReject.stderr);
  const humanReject = run(['phase', 'reject', String(number), '--reason', 'manual QA caught it'], dir, home);
  assert.strictEqual(humanReject.status, 0, humanReject.stderr);

  const verify = run(['phase', 'verify', String(number)], dir, home);
  assert.strictEqual(verify.status, 0, verify.stderr);
  const accept = run(['phase', 'accept', String(number)], dir, home);
  assert.strictEqual(accept.status, 0, accept.stderr);

  const liveHarvest = run(['milestone', 'harvest', '--json'], dir, home);
  assert.strictEqual(liveHarvest.status, 0, liveHarvest.stderr);
  const live = JSON.parse(liveHarvest.stdout);
  assert.equal(live.source, 'live');
  assert.ok(
    live.rejections.some((r) => r.phase === slug && r.reason === 'manual QA caught it'),
    `expected the human rejection in ${JSON.stringify(live.rejections)}`,
  );
  assert.ok(
    !live.rejections.some((r) => r.reason === 'went in blind'),
    'the agent-signed rejection must never appear in the swept rejections',
  );
  assert.ok(live.skipped.agentRejections >= 1, 'the agent rejection must be counted in skipped');

  const milestoneNumber = live.milestone;
  const complete = run(['milestone', 'complete'], dir, home);
  assert.strictEqual(complete.status, 0, complete.stderr);

  const archivedHarvest = run(['milestone', 'harvest', String(milestoneNumber), '--json'], dir, home);
  assert.strictEqual(archivedHarvest.status, 0, archivedHarvest.stderr);
  const archived = JSON.parse(archivedHarvest.stdout);
  assert.equal(archived.source, 'archive');
  assert.ok(
    archived.rejections.some((r) => r.phase === slug && r.reason === 'manual QA caught it'),
    `expected the human rejection to survive the archive in ${JSON.stringify(archived.rejections)}`,
  );
  assert.ok(!archived.rejections.some((r) => r.reason === 'went in blind'));
  assert.ok(archived.skipped.agentRejections >= 1);

  assert.ok(!principlesStoreExists(home), 'none of this ever writes into the principle store');
});
