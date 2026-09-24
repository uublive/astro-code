// CLI tests for `ac principles …` (P10, ADR-057, ADR-058) — subprocess-driven against a
// real, isolated `$HOME`, exactly like tests/backlog_cli.test.mjs's harness: a real
// scratch project (`git init` + `ac init`) and a real fresh home for the store. `ac
// principles` does not exist on `bin/ac.mjs` yet (t11 wires it in the same wave, paired
// by the shared `depends_on: t5, t8, t10`), so every invocation below currently dies with
// "unknown command" — a non-zero exit from `main()`'s `default:` case, never a crash — so
// this file loads fine and simply fails RED until t11 lands (ADR-018). Every import here
// is already-shipped (`lib/git.mjs`), so no dynamic import is needed for THIS file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');

function mkHome() {
  return mkdtempSync(join(tmpdir(), 'ac-principles-cli-home-'));
}

// Every "machine" gets its own HOME and git identity via env (no global git config to
// rely on), and NO `ASTRO_PRINCIPLES_DIR` unless a test opts in — so by default the
// `$HOME/.astro/principles` path is what gets exercised (t12's own isolation contract).
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

function run(args, cwd, home, extraEnv = {}) {
  return spawnSync(process.execPath, [AC, ...args], {
    cwd, encoding: 'utf8', env: envFor(home, extraEnv),
  });
}

function storeDir(home) {
  return join(home, '.astro', 'principles');
}

function mkProject(home) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-principles-cli-proj-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  const init = run(['init'], dir, home);
  assert.strictEqual(init.status, 0, init.stderr);
  return dir;
}

function storeFiles(home) {
  const dir = storeDir(home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
}

function hashStore(home) {
  const dir = storeDir(home);
  const map = {};
  for (const f of storeFiles(home)) {
    map[f] = createHash('sha256').update(readFileSync(join(dir, f))).digest('hex');
  }
  return map;
}

function entryFile(home, id) {
  return join(storeDir(home), `${id}.md`);
}

function extractId(text) {
  const m = text.match(/\b(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\b/);
  return m && m[1];
}

function showJSON(id, home, dir) {
  const r = run(['principles', 'show', id, '--json'], dir, home);
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function addAccepted(home, dir, statement, extra = []) {
  const add = run(['principles', 'add', statement, '--kind', 'pattern', ...extra], dir, home);
  assert.strictEqual(add.status, 0, add.stderr);
  const id = extractId(add.stdout);
  assert.ok(id, `add must print an id, got: ${add.stdout}`);
  return id;
}

// ── C1 — manually added, stored accepted, in the user's home, never the project ──

test('C1: a manually added principle is stored accepted, in the home store, never the project', () => {
  const home = mkHome();
  const dir = mkProject(home);
  const gitStatusBefore = git(['status', '--porcelain'], { cwd: dir }).stdout;

  const add = run([
    'principles', 'add', 'Never mock the database in integration tests',
    '--kind', 'antipattern', '--strength', 'rule',
    '--why', 'Mocks hid a broken migration',
    '--stack', 'Postgres', '--work', 'test',
  ], dir, home);
  assert.strictEqual(add.status, 0, add.stderr);

  const id = extractId(add.stdout);
  assert.ok(id, `must print an id, got: ${add.stdout}`);
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(id.startsWith(today), `id date must be today: ${id}`);

  const files = storeFiles(home);
  assert.strictEqual(files.length, 1, 'exactly one new entry file');
  const content = readFileSync(join(storeDir(home), files[0]), 'utf8');
  assert.match(content, /Never mock the database in integration tests/);
  assert.match(content, /Mocks hid a broken migration/);

  const gitStatusAfter = git(['status', '--porcelain'], { cwd: dir }).stdout;
  assert.strictEqual(gitStatusAfter, gitStatusBefore, 'the project tree must be untouched');
  assert.strictEqual(existsSync(join(dir, '.astrocode', 'principles')), false);

  const list = run(['principles', 'list', '--accepted'], dir, home);
  assert.strictEqual(list.status, 0, list.stderr);
  assert.match(list.stdout, new RegExp(id));
});

// ── C2 — every field round-trips, enums enforced, unknown flags refused ──

test('C2: fields round-trip through show, enums are enforced, unknown flags are refused with no change', () => {
  const home = mkHome();
  const dir = mkProject(home);

  const id = addAccepted(home, dir, 'Never mock the database in integration tests', [
    '--kind', 'antipattern', '--strength', 'rule', '--why', 'Mocks hid a broken migration',
    '--stack', 'Postgres', '--work', 'test',
  ]);
  const entry = showJSON(id, home, dir);
  assert.strictEqual(entry.kind, 'antipattern');
  assert.strictEqual(entry.strength, 'rule');
  assert.deepEqual(entry.scopes.stack, ['postgres'], 'stack must be lowercased');
  assert.deepEqual(entry.scopes.work, ['test']);
  assert.strictEqual(entry.status, 'accepted');
  assert.strictEqual(entry.statement, 'Never mock the database in integration tests');
  assert.match(entry.why, /Mocks hid a broken migration/);

  const id2 = addAccepted(home, dir, 'Group related migrations into one file', [
    '--kind', 'preference', '--strength', 'default',
    '--files', 'migrations/**', '--files', '**/*.test.*',
  ]);
  const entry2 = showJSON(id2, home, dir);
  assert.strictEqual(entry2.kind, 'preference');
  assert.strictEqual(entry2.strength, 'default');
  assert.deepEqual(entry2.scopes.files.slice().sort(), ['**/*.test.*', 'migrations/**'].sort());

  const before = hashStore(home);
  const refusals = [
    ['principles', 'add', 'x', '--kind', 'habit'],
    ['principles', 'add', 'x', '--kind', 'principle', '--strength', 'maybe'],
    ['principles', 'add', 'x', '--kind', 'principle', '--work', 'cooking'],
    ['principles', 'add', 'x', '--knd', 'principle'],
    ['principles', 'reject', id, '--typo-flag', 'oops'],
    ['principles', 'promote', id, '--typo-flag', 'oops'],
  ];
  for (const args of refusals) {
    const r = run(args, dir, home);
    assert.notStrictEqual(r.status, 0, `must refuse: ${args.join(' ')}`);
  }
  assert.deepStrictEqual(hashStore(home), before, 'refusals must leave the store byte-identical');
});

// ── C3 — proposals queue separately, list filters by status ──

test('C3: proposals queue separately from accepted entries, and list filters by status', () => {
  const home = mkHome();
  const dir = mkProject(home);

  const acceptedId = addAccepted(home, dir, 'Never mock the database in integration tests', [
    '--kind', 'antipattern',
  ]);

  const propose = run(['principles', 'add', 'Prefer small PRs', '--kind', 'preference', '--propose', '--why', 'Seen more than once.'], dir, home);
  assert.strictEqual(propose.status, 0, propose.stderr);
  const proposedId = extractId(propose.stdout);
  assert.ok(proposedId);

  const proposedList = run(['principles', 'list', '--proposed'], dir, home);
  assert.strictEqual(proposedList.status, 0, proposedList.stderr);
  assert.match(proposedList.stdout, new RegExp(proposedId));
  assert.doesNotMatch(proposedList.stdout, new RegExp(acceptedId));

  const acceptedList = run(['principles', 'list', '--accepted'], dir, home);
  assert.match(acceptedList.stdout, new RegExp(acceptedId));
  assert.doesNotMatch(acceptedList.stdout, new RegExp(proposedId));

  const allList = run(['principles', 'list', '--all'], dir, home);
  assert.match(allList.stdout, new RegExp(acceptedId));
  assert.match(allList.stdout, new RegExp(proposedId));

  for (const line of allList.stdout.split('\n').filter((l) => l.includes(acceptedId) || l.includes(proposedId))) {
    assert.ok(line.trim().length, 'each list entry is one non-empty line');
  }
});

// ── C4 — lifecycle enforced: reasons required, illegal transitions refused, nothing deleted ──

test('C4: the lifecycle is enforced — reasons required, illegal transitions refused, nothing deleted', () => {
  const home = mkHome();
  const dir = mkProject(home);

  // proposed -> accepted
  const p1 = run(['principles', 'add', 'Adopt trunk-based development', '--kind', 'pattern', '--propose', '--why', 'Seen more than once.'], dir, home);
  const id1 = extractId(p1.stdout);
  const accept1 = run(['principles', 'accept', id1], dir, home);
  assert.strictEqual(accept1.status, 0, accept1.stderr);
  assert.strictEqual(showJSON(id1, home, dir).status, 'accepted');

  // proposed -> rejected (reason required)
  const p2 = run(['principles', 'add', 'Ship on Fridays', '--kind', 'preference', '--propose', '--why', 'Seen more than once.'], dir, home);
  const id2 = extractId(p2.stdout);
  const before2 = readFileSync(entryFile(home, id2), 'utf8');
  const rejNoReason = run(['principles', 'reject', id2], dir, home);
  assert.notStrictEqual(rejNoReason.status, 0);
  assert.strictEqual(readFileSync(entryFile(home, id2), 'utf8'), before2, 'reject without reason changes nothing');
  const rej = run(['principles', 'reject', id2, '--reason', 'too broad'], dir, home);
  assert.strictEqual(rej.status, 0, rej.stderr);
  const rejected = showJSON(id2, home, dir);
  assert.strictEqual(rejected.status, 'rejected');
  assert.match(rejected.reason, /too broad/);
  assert.ok(existsSync(entryFile(home, id2)), 'a rejected entry file still exists');

  // accepted -> retired (reason required)
  const before1 = readFileSync(entryFile(home, id1), 'utf8');
  const retireNoReason = run(['principles', 'retire', id1], dir, home);
  assert.notStrictEqual(retireNoReason.status, 0);
  assert.strictEqual(readFileSync(entryFile(home, id1), 'utf8'), before1);
  const retire = run(['principles', 'retire', id1, '--reason', 'obsolete'], dir, home);
  assert.strictEqual(retire.status, 0, retire.stderr);
  const retired = showJSON(id1, home, dir);
  assert.strictEqual(retired.status, 'retired');
  assert.match(retired.reason, /obsolete/);

  // accepted -> superseded
  const id3 = addAccepted(home, dir, 'Prefer feature flags over long-lived branches', ['--kind', 'pattern']);
  const id4 = addAccepted(home, dir, 'Prefer feature flags to gate risky changes', ['--kind', 'pattern']);
  const supersede = run(['principles', 'supersede', id3, '--by', id4], dir, home);
  assert.strictEqual(supersede.status, 0, supersede.stderr);
  const superseded = showJSON(id3, home, dir);
  assert.strictEqual(superseded.status, 'superseded');
  assert.strictEqual(superseded.supersededBy, id4);

  const before5 = readFileSync(entryFile(home, id4), 'utf8');
  const badSupersede = run(['principles', 'supersede', id4, '--by', '2026-01-01-does-not-exist'], dir, home);
  assert.notStrictEqual(badSupersede.status, 0);
  assert.strictEqual(readFileSync(entryFile(home, id4), 'utf8'), before5);

  // illegal moves
  const p5 = run(['principles', 'add', 'Use conventional commits', '--kind', 'preference', '--propose', '--why', 'Seen more than once.'], dir, home);
  const id5 = extractId(p5.stdout);
  const before5b = readFileSync(entryFile(home, id5), 'utf8');
  assert.notStrictEqual(run(['principles', 'retire', id5, '--reason', 'x'], dir, home).status, 0, 'cannot retire a proposed entry');
  assert.notStrictEqual(run(['principles', 'supersede', id5, '--by', id4], dir, home).status, 0, 'cannot supersede a proposed entry');
  assert.strictEqual(readFileSync(entryFile(home, id5), 'utf8'), before5b);

  assert.notStrictEqual(run(['principles', 'reject', id1, '--reason', 'x'], dir, home).status, 0, 'cannot reject an already-accepted entry');
  assert.notStrictEqual(run(['principles', 'accept', id2], dir, home).status, 0, 'cannot accept a rejected entry');
});

// ── C5 — reworded on accept (--edit), amended in place with history ──

test('C5: a proposal can be reworded on accept, and an accepted entry is amended in place with history', () => {
  const home = mkHome();
  const dir = mkProject(home);

  const p = run(['principles', 'add', 'Use pnpm', '--kind', 'preference', '--propose', '--why', 'Seen more than once.'], dir, home);
  assert.strictEqual(p.status, 0, p.stderr);
  const id = extractId(p.stdout);

  const accept = run(['principles', 'accept', id, '--edit'], dir, home, {
    EDITOR: "sed -i 's/Use pnpm/Always use pnpm/'",
  });
  assert.strictEqual(accept.status, 0, accept.stderr);
  const accepted = showJSON(id, home, dir);
  assert.strictEqual(accepted.status, 'accepted');
  assert.match(accepted.statement, /Always use pnpm/);

  // an unedited --edit must be refused (git's commit-template rule)
  const p2 = run(['principles', 'add', 'Use npm', '--kind', 'preference', '--propose', '--why', 'Seen more than once.'], dir, home);
  const id2 = extractId(p2.stdout);
  const acceptNoop = run(['principles', 'accept', id2, '--edit'], dir, home, { EDITOR: 'true' });
  assert.notStrictEqual(acceptNoop.status, 0, 'unedited text on --edit must be refused');

  const amend = run(['principles', 'amend', id, '--reason', 'clarified scope',
    '--statement', 'Always use pnpm in this org', '--why', 'consistency across repos'], dir, home);
  assert.strictEqual(amend.status, 0, amend.stderr);
  const amended = showJSON(id, home, dir);
  assert.strictEqual(amended.id, id, 'amend must not mint a new id');
  assert.strictEqual(amended.statement, 'Always use pnpm in this org');
  assert.match(amended.why, /consistency across repos/);
  assert.ok(Array.isArray(amended.history) && amended.history.length, 'amend must append a history record');
  const last = amended.history[amended.history.length - 1];
  const lastText = JSON.stringify(last);
  assert.match(lastText, /clarified scope/, 'the reason must be recorded on the history entry');
  assert.ok(lastText.includes('Always use pnpm'), 'the prior statement must be recorded');
  assert.ok(!lastText.includes('Always use pnpm in this org'), 'the recorded prior statement must be the OLD text, not the new one');

  const amendNoReason = run(['principles', 'amend', id, '--statement', 'Something else'], dir, home);
  assert.notStrictEqual(amendNoReason.status, 0, 'amend with no reason must be refused');
  assert.strictEqual(showJSON(id, home, dir).statement, 'Always use pnpm in this org', 'no change on refusal');
});

// ── C6 — ids are stable dated slugs, resolved by unique prefix, never reissued ──

test('C6: ids are stable dated slugs, resolved by unique prefix, never reissued or overwritten', () => {
  const home = mkHome();
  const dir = mkProject(home);

  const a = run(['principles', 'add', 'Write tests before code', '--kind', 'principle'], dir, home);
  const b = run(['principles', 'add', 'Write tests before code', '--kind', 'principle'], dir, home);
  assert.strictEqual(a.status, 0, a.stderr);
  assert.strictEqual(b.status, 0, b.stderr);
  const idA = extractId(a.stdout);
  const idB = extractId(b.stdout);
  assert.notStrictEqual(idA, idB, 'two distinct ids for the identical statement');
  assert.strictEqual(storeFiles(home).length, 2, 'two distinct files, neither overwritten');

  // an exact id always resolves to itself.
  const showFull = run(['principles', 'show', idA], dir, home);
  assert.strictEqual(showFull.status, 0, showFull.stderr);

  // a prefix that matches more than one must be refused as ambiguous: the shared slug,
  // i.e. either id minus its random '-xxxx' suffix (phase-22 verify, C6/C10).
  const ambiguousPrefix = idA.slice(0, -5);
  assert.ok(idB.startsWith(ambiguousPrefix), 'same statement → same slug, different random suffix');
  const ambiguous = run(['principles', 'show', ambiguousPrefix], dir, home);
  assert.notStrictEqual(ambiguous.status, 0, 'an ambiguous prefix must be refused, naming the candidates');

  const unknown = run(['principles', 'show', '2000-01-01-not-a-real-entry'], dir, home);
  assert.notStrictEqual(unknown.status, 0, 'an unknown id must be refused, not treated as empty');

  // amend keeps the id
  const amend = run(['principles', 'amend', idA, '--reason', 'r', '--statement', 'Write tests before writing code'], dir, home);
  assert.strictEqual(amend.status, 0, amend.stderr);
  assert.strictEqual(showJSON(idA, home, dir).id, idA);
});

// ── C7 — one entry per file: a change touches only that entry's file ──

test('C7: changing one entry touches only that entry\'s file', () => {
  const home = mkHome();
  const dir = mkProject(home);

  const ids = [];
  for (let i = 0; i < 4; i++) {
    ids.push(addAccepted(home, dir, `Principle number ${i} about something distinct`, ['--kind', 'principle']));
  }
  const before = hashStore(home);
  assert.strictEqual(Object.keys(before).length, 4);

  const amend = run(['principles', 'amend', ids[1], '--reason', 'tweak', '--statement', 'Principle number 1, reworded'], dir, home);
  assert.strictEqual(amend.status, 0, amend.stderr);

  const after = hashStore(home);
  assert.deepStrictEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'no file added or removed');
  const changed = Object.keys(after).filter((f) => after[f] !== before[f]);
  assert.strictEqual(changed.length, 1, 'exactly one file must differ');
  assert.strictEqual(changed[0], `${ids[1]}.md`);
  const content = readFileSync(join(storeDir(home), changed[0]), 'utf8');
  assert.match(content, /Principle number 1, reworded/);
});

// ── C8 — a damaged entry is refused loudly, never absent, never clobbered ──

test('C8: a damaged entry is refused loudly, never read as absent and never clobbered', () => {
  const home = mkHome();
  const dir = mkProject(home);

  const goodId = addAccepted(home, dir, 'A healthy entry that must stay untouched', ['--kind', 'principle']);
  const damagedId = addAccepted(home, dir, 'An entry about to be corrupted', ['--kind', 'principle']);

  const file = entryFile(home, damagedId);
  const original = readFileSync(file, 'utf8');
  // corrupt the header: delete the status line
  const withoutStatus = original.split('\n').filter((l) => !l.startsWith('status: ')).join('\n');
  writeFileSync(file, withoutStatus);

  const show = run(['principles', 'show', damagedId], dir, home);
  assert.notStrictEqual(show.status, 0, 'show on a damaged entry must exit non-zero');
  assert.match(show.stderr + show.stdout, new RegExp(damagedId));

  const list = run(['principles', 'list', '--all'], dir, home);
  const listedOrWarned = list.status !== 0 || /⚠/.test(list.stdout + list.stderr);
  assert.ok(listedOrWarned, 'list must either fail or warn about the damaged entry, never silently drop it');
  if (list.status === 0) {
    assert.match(list.stdout + list.stderr, new RegExp(damagedId), 'the warning must name the damaged file');
  }

  const beforeGood = readFileSync(entryFile(home, goodId), 'utf8');
  const addOther = run(['principles', 'add', 'Yet another healthy entry', '--kind', 'principle'], dir, home);
  assert.strictEqual(addOther.status, 0, addOther.stderr);
  const amendGood = run(['principles', 'amend', goodId, '--reason', 'r', '--statement', 'A healthy entry, amended'], dir, home);
  assert.strictEqual(amendGood.status, 0, amendGood.stderr);
  assert.notStrictEqual(readFileSync(entryFile(home, goodId), 'utf8'), beforeGood, 'the good entry DID legitimately change');

  const damagedStillBroken = readFileSync(file, 'utf8');
  assert.strictEqual(damagedStillBroken, withoutStatus, 'the damaged file must be byte-identical — untouched by unrelated operations');

  assert.notStrictEqual(run(['principles', 'amend', damagedId, '--reason', 'r', '--statement', 'x'], dir, home).status, 0);
  assert.notStrictEqual(run(['principles', 'accept', damagedId], dir, home).status, 0);
  assert.strictEqual(readFileSync(file, 'utf8'), withoutStatus, 'no command may "repair" a damaged entry');

  // corrupt the kind instead, on a second file, to cover the other damage shape
  const damagedId2 = addAccepted(home, dir, 'Another entry, corrupted differently', ['--kind', 'principle']);
  const file2 = entryFile(home, damagedId2);
  const original2 = readFileSync(file2, 'utf8');
  const badKind = original2.replace(/^kind: .*$/m, 'kind: garbage');
  writeFileSync(file2, badKind);
  const show2 = run(['principles', 'show', damagedId2], dir, home);
  assert.notStrictEqual(show2.status, 0, 'an invalid kind must also be refused as damage');
});

// ── C9 — source excerpts are redacted of secrets before they are stored ──

test('C9: source excerpts are redacted of secrets before they are ever written to disk', () => {
  const home = mkHome();
  const dir = mkProject(home);

  const ghpToken = 'ghp_' + 'a'.repeat(36);
  const awsKey = 'AKIA' + 'B'.repeat(16);
  const bearerToken = 'c'.repeat(40);
  const credUrl = 'https://alice:s3cr3tpass@git.example.com/r.git';
  const excerpt = [
    `token: ${ghpToken}`,
    `aws key: ${awsKey}`,
    `Authorization: Bearer ${bearerToken}`,
    `clone ${credUrl} now`,
  ].join(' | ');

  const add = run([
    'principles', 'add', 'Rotate leaked credentials immediately', '--kind', 'principle',
    '--from-session', 'sess-123', '--from-project', 'astro-code', '--from-ref', 'ADR-057',
    '--excerpt', excerpt,
  ], dir, home);
  assert.strictEqual(add.status, 0, add.stderr);
  const id = extractId(add.stdout);

  const storeText = storeFiles(home).map((f) => readFileSync(join(storeDir(home), f), 'utf8')).join('\n');
  for (const secret of [ghpToken, awsKey, bearerToken, 'alice:s3cr3tpass']) {
    assert.ok(!storeText.includes(secret), `secret must never be written to disk: ${secret}`);
  }

  const entry = showJSON(id, home, dir);
  assert.ok(entry.source, 'a source pointer must round-trip');
  assert.match(JSON.stringify(entry.source), /sess-123/);
  assert.match(JSON.stringify(entry.source), /astro-code/);
  assert.match(JSON.stringify(entry.source), /ADR-057/);
  assert.match(entry.source.excerpt || '', /\[REDACTED\]/);
  assert.match(entry.source.excerpt || '', /token:/);
  assert.match(entry.source.excerpt || '', /clone/);
  assert.match(entry.source.excerpt || '', /now/);
});

// ── C15 — proposing never touches an accepted entry ──

test('C15: `add --propose` never touches an already-accepted entry, even with the identical statement', () => {
  const home = mkHome();
  const dir = mkProject(home);

  const acceptedId = addAccepted(home, dir, 'Review every migration before merge', ['--kind', 'principle']);
  const before = readFileSync(entryFile(home, acceptedId), 'utf8');

  const propose = run(['principles', 'add', 'Review every migration before merge', '--kind', 'principle', '--propose', '--why', 'Seen more than once.'], dir, home);
  assert.strictEqual(propose.status, 0, propose.stderr);
  const proposedId = extractId(propose.stdout);
  assert.notStrictEqual(proposedId, acceptedId, 'a propose must never target an existing accepted entry\'s file');

  assert.strictEqual(readFileSync(entryFile(home, acceptedId), 'utf8'), before, 'the accepted entry must stay byte-identical');
  assert.strictEqual(showJSON(acceptedId, home, dir).status, 'accepted');
  assert.strictEqual(showJSON(proposedId, home, dir).status, 'proposed');
});

// ── C16 — the CLI never conjures a store on read-only/unrelated commands ──

test('C16: `ac status`, `ac help` and `ac principles list` on a fresh HOME create no store directory', () => {
  const home = mkHome();
  const dir = mkProject(home);
  assert.strictEqual(existsSync(storeDir(home)), false, 'init itself must not create the store');

  const status = run(['status'], dir, home);
  assert.strictEqual(status.status, 0, status.stderr);
  const help = run(['help'], dir, home);
  assert.strictEqual(help.status, 0, help.stderr);
  const list = run(['principles', 'list'], dir, home);
  assert.strictEqual(list.status, 0, list.stderr);

  assert.strictEqual(existsSync(storeDir(home)), false, 'a bare store dir must never be created by reads');
});

// ── isolation — ASTRO_PRINCIPLES_DIR overrides the default, and nothing leaks under $HOME ──

test('isolation: ASTRO_PRINCIPLES_DIR overrides the default store location entirely', () => {
  const home = mkHome();
  const dir = mkProject(home);
  const altStore = mkdtempSync(join(tmpdir(), 'ac-principles-alt-'));

  const add = run(['principles', 'add', 'Prefer explicit over implicit', '--kind', 'preference'], dir, home, {
    ASTRO_PRINCIPLES_DIR: altStore,
  });
  assert.strictEqual(add.status, 0, add.stderr);

  assert.strictEqual(existsSync(join(home, '.astro')), false, 'nothing under $HOME/.astro when the store dir is overridden');
  const altFiles = readdirSync(altStore).filter((f) => f.endsWith('.md'));
  assert.strictEqual(altFiles.length, 1, 'the entry must land in the overridden store dir instead');
});
