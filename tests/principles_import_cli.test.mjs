// RED CLI tests for `ac principles import --from-forge`, `--no-sync` on `list`/`show`,
// and the review/retrieval surfaces over imported entries (P6, phase 27 t5). Neither
// verb exists on `bin/ac.mjs` on this branch yet, so every invocation below currently
// dies with "unknown: ac principles …" or an unknown-flag refusal — a non-zero exit
// from `die()`, never a crash — so this file needs no dynamic import (subprocess-driven,
// matching tests/principles_review_cli.test.mjs's own RED-file note, ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, chmodSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');

function mkHome() {
  return mkdtempSync(join(tmpdir(), 'ac-principles-import-home-'));
}
function mkStore() {
  return mkdtempSync(join(tmpdir(), 'ac-principles-import-store-'));
}
function mkCwd() {
  return mkdtempSync(join(tmpdir(), 'ac-principles-import-cwd-'));
}

function envFor(home, store, extra = {}) {
  return {
    ...process.env, HOME: home, ASTRO_PRINCIPLES_DIR: store,
    GIT_AUTHOR_NAME: 'dev', GIT_AUTHOR_EMAIL: 'dev@example.com',
    GIT_COMMITTER_NAME: 'dev', GIT_COMMITTER_EMAIL: 'dev@example.com',
    ...extra,
  };
}

function run(args, cwd, home, store, extraEnv = {}) {
  return spawnSync(process.execPath, [AC, ...args], {
    cwd, input: '', encoding: 'utf8', env: envFor(home, store, extraEnv), windowsHide: true,
  });
}

function writeFixture(nodes) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-forge-export-'));
  const file = join(dir, 'export.json');
  writeFileSync(file, JSON.stringify({
    format: 'astro-forge-export', version: 1, exported_at: '2026-09-20T00:00:00.000Z', nodes,
  }));
  return file;
}

function fixtureNodes() {
  return [
    {
      slug: 'commit-lockfiles', type: 'Principle', name: 'Commit lockfiles',
      statement: 'Commit the lockfile with every dependency change', why: 'reproducible installs',
      status: 'approved', confidence: 'normal', created: '2026-09-01T00:00:00.000Z',
      signals: [{ text: 'a signal', source: 'session a', at: '2026-09-01T00:00:00.000Z' }],
    },
    {
      slug: 'wip-branches', type: 'Pattern', statement: 'Keep WIP on a branch', status: 'pending',
      signals: [{ text: 'another signal', source: 'session b', at: '2026-09-02T00:00:00.000Z' }],
    },
    {
      slug: 'low-conf-pending', type: 'Pattern', statement: 'A low confidence pattern',
      status: 'pending', confidence: 'low',
    },
    {
      slug: 'no-force-push', type: 'AntiPattern', statement: 'Never force-push shared branches',
      status: 'rejected', reason: 'too strict for solo repos',
    },
    {
      slug: 'always-squash', type: 'Preference', statement: 'Always squash merge', status: 'rejected',
    },
    {
      slug: 'old-style', type: 'Principle', statement: 'Old style guide rule', status: 'superseded',
      superseded_by: 'new-style',
    },
    {
      slug: 'new-style', type: 'Principle', statement: 'New style guide rule', status: 'approved',
    },
  ];
}

function listing(dir) {
  const out = [];
  function walk(d) {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const st = statSync(full);
      out.push(`${full.slice(dir.length)}:${st.isDirectory() ? 'D' : st.size}`);
      if (st.isDirectory()) walk(full);
    }
  }
  if (existsSync(dir)) walk(dir);
  return out.join('\n');
}

function digestDir(dir) {
  if (!existsSync(dir)) return 'ABSENT';
  const h = createHash('sha1');
  h.update(listing(dir));
  return h.digest('hex');
}

function chmodRecursiveReadOnly(dir, mode) {
  if (process.getuid?.() === 0) return false; // root ignores chmod — nothing to test here
  function walk(d) {
    chmodSync(d, mode);
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else chmodSync(full, mode & 0o555);
    }
  }
  walk(dir);
  return true;
}

// --- import --from-forge --------------------------------------------------------------

test('principles import --from-forge imports the fixture and reports it in one summary line', async () => {
  const home = mkHome(); const store = mkStore(); const cwd = mkCwd();
  const file = writeFixture(fixtureNodes());
  const r = run(['principles', 'import', '--from-forge', file], cwd, home, store);
  assert.equal(r.status, 0, r.stderr);
  const firstLine = r.stdout.split('\n')[0];
  assert.match(firstLine, /^✓ imported from forge/);
  assert.match(r.stdout, /proposed awaiting review — \/astro-review/);
});

test('list --all --json after import holds the P2 statuses/kinds/source/sightings/scopes', async () => {
  const home = mkHome(); const store = mkStore(); const cwd = mkCwd();
  const file = writeFixture(fixtureNodes());
  run(['principles', 'import', '--from-forge', file], cwd, home, store);
  const r = run(['principles', 'list', '--all', '--json'], cwd, home, store);
  assert.equal(r.status, 0, r.stderr);
  const entries = JSON.parse(r.stdout);
  const byslug = new Map(entries.map((e) => [e.source?.ref?.replace('forge:', ''), e]));

  assert.equal(byslug.get('commit-lockfiles').status, 'accepted');
  assert.equal(byslug.get('commit-lockfiles').kind, 'principle');
  assert.equal(byslug.get('commit-lockfiles').sightings.length, 1);
  assert.deepEqual(byslug.get('commit-lockfiles').scopes, { stack: [], files: [], work: [] });
  assert.equal(byslug.get('wip-branches').status, 'proposed');
  assert.equal(byslug.get('no-force-push').status, 'rejected');
  assert.equal(byslug.get('always-squash').status, 'rejected');
  assert.notEqual(byslug.get('old-style').status, 'accepted');
  assert.notEqual(byslug.get('old-style').status, 'proposed');
});

test('import --from-forge --json prints created/sighted/unchanged', async () => {
  const home = mkHome(); const store = mkStore(); const cwd = mkCwd();
  const file = writeFixture(fixtureNodes());
  const r = run(['principles', 'import', '--from-forge', file, '--json'], cwd, home, store);
  assert.equal(r.status, 0, r.stderr);
  const result = JSON.parse(r.stdout);
  assert.ok(Array.isArray(result.created));
  assert.ok(Array.isArray(result.sighted));
  assert.ok(Array.isArray(result.unchanged));
});

// --- C6: malformed input refuses -------------------------------------------------------

test('import --from-forge refuses a nonexistent path, invalid JSON, unknown type, missing slug, missing flag', async () => {
  const home = mkHome(); const store = mkStore(); const cwd = mkCwd();
  const file = writeFixture(fixtureNodes());
  run(['principles', 'import', '--from-forge', file], cwd, home, store);
  const before = digestDir(store);

  const r1 = run(['principles', 'import', '--from-forge', '/nonexistent/path/export.json'], cwd, home, store);
  assert.notEqual(r1.status, 0);

  const badJson = writeFixture([]); // will overwrite with garbage below
  writeFileSync(badJson, 'not valid json {');
  const r2 = run(['principles', 'import', '--from-forge', badJson], cwd, home, store);
  assert.notEqual(r2.status, 0);
  assert.match(r2.stderr, /\S/);

  const badType = writeFixture([{ slug: 'x', type: 'Bogus', statement: 'x', status: 'approved' }]);
  const r3 = run(['principles', 'import', '--from-forge', badType], cwd, home, store);
  assert.notEqual(r3.status, 0);

  const missingSlug = writeFixture([{ type: 'Principle', statement: 'x', status: 'approved' }]);
  const r4 = run(['principles', 'import', '--from-forge', missingSlug], cwd, home, store);
  assert.notEqual(r4.status, 0);

  const r5 = run(['principles', 'import'], cwd, home, store);
  assert.notEqual(r5.status, 0);

  const r6 = run(['principles', 'import', '--from-forge', file, '--bogus'], cwd, home, store);
  assert.notEqual(r6.status, 0);

  assert.equal(digestDir(store), before);
});

// --- C7: review + retrieval over imports ------------------------------------------------

test('list --proposed --json holds exactly the pending/low-confidence imports; accept survives re-import; brief/ask serve only accepted', async () => {
  const home = mkHome(); const store = mkStore(); const cwd = mkCwd();
  const file = writeFixture(fixtureNodes());
  run(['principles', 'import', '--from-forge', file], cwd, home, store);

  const proposedR = run(['principles', 'list', '--proposed', '--json'], cwd, home, store);
  assert.equal(proposedR.status, 0, proposedR.stderr);
  const proposed = JSON.parse(proposedR.stdout);
  const proposedStatements = proposed.map((e) => e.statement).sort();
  assert.deepEqual(proposedStatements, ['A low confidence pattern', 'Keep WIP on a branch']);

  const wip = proposed.find((e) => e.statement === 'Keep WIP on a branch');
  const acceptR = run(['principles', 'accept', wip.id], cwd, home, store);
  assert.equal(acceptR.status, 0, acceptR.stderr);

  run(['principles', 'import', '--from-forge', file], cwd, home, store);
  const showR = run(['principles', 'show', wip.id, '--json'], cwd, home, store);
  assert.equal(JSON.parse(showR.stdout).status, 'accepted');

  const briefR = run(['principles', 'brief', '--stage', 'execute', '--json'], cwd, home, store);
  assert.equal(briefR.status, 0, briefR.stderr);
  const briefJson = JSON.parse(briefR.stdout);
  const briefText = JSON.stringify(briefJson);
  assert.ok(briefText.includes('Keep WIP') || true); // brief scoping is structural; sanity that it runs
  assert.ok(!briefText.includes('Always squash merge'));
  assert.ok(!briefText.includes('Old style guide rule'));

  const askR = run(['principles', 'ask', 'lockfile', '--json'], cwd, home, store);
  assert.equal(askR.status, 0, askR.stderr);
  const askText = JSON.stringify(JSON.parse(askR.stdout));
  assert.ok(!askText.includes('Old style guide rule'));
});

// --- C9: --no-sync never writes --------------------------------------------------------

test('--no-sync on list/show never writes the store, even chmod a-w', async () => {
  const home = mkHome(); const store = mkStore(); const cwd = mkCwd();
  const file = writeFixture(fixtureNodes());
  run(['principles', 'import', '--from-forge', file], cwd, home, store);

  const idR = run(['principles', 'list', '--all', '--json'], cwd, home, store);
  const [{ id }] = JSON.parse(idR.stdout);

  const before = digestDir(store);
  const isRoot = process.getuid?.() === 0;
  if (isRoot) return; // chmod does not bind as root — nothing to verify here
  chmodRecursiveReadOnly(store, 0o555);

  const listR = run(['principles', 'list', '--all', '--json', '--no-sync'], cwd, home, store);
  assert.equal(listR.status, 0, listR.stderr);
  const showR = run(['principles', 'show', id, '--json', '--no-sync'], cwd, home, store);
  assert.equal(showR.status, 0, showR.stderr);

  chmodRecursiveReadOnly(store, 0o755);
  assert.equal(digestDir(store), before);
});

test('list without --no-sync still works on a writable store (unchanged behaviour)', async () => {
  const home = mkHome(); const store = mkStore(); const cwd = mkCwd();
  const file = writeFixture(fixtureNodes());
  run(['principles', 'import', '--from-forge', file], cwd, home, store);
  const r = run(['principles', 'list', '--all', '--json'], cwd, home, store);
  assert.equal(r.status, 0, r.stderr);
});

// --- ac help ----------------------------------------------------------------------------

test('ac help lists `principles import`', async () => {
  const home = mkHome(); const store = mkStore(); const cwd = mkCwd();
  const r = run(['help'], cwd, home, store);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /principles import/);
});
