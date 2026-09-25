// Guard for templates/PRINCIPLES-CONTRACT.md (phase 27 t8): the fixed header order and
// the promised JSON keys must match what the code actually does, the example entry must
// round-trip byte-for-byte, and every documented `--no-sync` command must actually work
// read-only against a store with no write access (C9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, mkdtempSync, chmodSync, readdirSync, statSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { HEADER_KEYS, parsePrinciple, renderPrinciple } from '../lib/principlemd.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(ROOT, 'bin', 'ac.mjs');
const DOC_PATH = join(ROOT, 'templates', 'PRINCIPLES-CONTRACT.md');
const doc = readFileSync(DOC_PATH, 'utf8');

function fencedBlock(marker) {
  const openTag = `<!-- ${marker} -->`;
  const closeTag = `<!-- /${marker} -->`;
  const start = doc.indexOf(openTag);
  assert.ok(start !== -1, `doc must contain ${openTag}`);
  const end = doc.indexOf(closeTag, start);
  assert.ok(end !== -1, `doc must contain ${closeTag}`);
  const between = doc.slice(start + openTag.length, end);
  const m = between.match(/```(?:\w*)\n([\s\S]*?)```/);
  assert.ok(m, `${marker} must wrap a fenced code block`);
  return m[1];
}

function mkStore() {
  return mkdtempSync(join(tmpdir(), 'ac-principles-contract-'));
}
function mkHome() {
  return mkdtempSync(join(tmpdir(), 'ac-principles-contract-home-'));
}
function envFor(home, store) {
  return { ...process.env, HOME: home, ASTRO_PRINCIPLES_DIR: store };
}
function run(args, home, store) {
  return spawnSync(process.execPath, [AC, ...args], {
    cwd: home, input: '', encoding: 'utf8', env: envFor(home, store), windowsHide: true,
  });
}

// Seeds a store through astro-code's own writers (there is no import path, ADR-065) with
// one entry in each of accepted / proposed / rejected / superseded, plus a sighting and
// a source, so the JSON-key check runs over every status shape a reader can meet.
function seedStore(home, store) {
  const ok = (args) => {
    const r = run(args, home, store);
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    return r;
  };
  const idOf = (statement) => {
    const all = JSON.parse(ok(['principles', 'list', '--all', '--json']).stdout);
    const hit = all.find((e) => e.statement === statement);
    assert.ok(hit, `seeded entry "${statement}" not found`);
    return hit.id;
  };
  ok(['principles', 'add', 'An accepted contract example', '--kind', 'principle',
    '--from-session', 'session a', '--excerpt', 'a signal']);
  ok(['principles', 'sight', idOf('An accepted contract example'), '--from-session', 'session b', '--excerpt', 'again']);
  ok(['principles', 'add', 'A proposed contract example', '--kind', 'pattern', '--why', 'a reason', '--propose']);
  ok(['principles', 'add', 'A rejected contract example', '--kind', 'antipattern', '--why', 'a reason', '--propose']);
  ok(['principles', 'reject', idOf('A rejected contract example'), '--reason', 'no']);
  ok(['principles', 'add', 'An old contract example', '--kind', 'principle']);
  ok(['principles', 'add', 'A new contract example', '--kind', 'principle']);
  ok(['principles', 'supersede', idOf('An old contract example'), '--by', idOf('A new contract example')]);
  ok(['principles', 'add', 'A retired contract example', '--kind', 'principle']);
  ok(['principles', 'retire', idOf('A retired contract example'), '--reason', 'no longer true']);
  ok(['principles', 'add', 'A merge survivor example', '--kind', 'pattern', '--why', 'w', '--propose']);
  ok(['principles', 'add', 'A merged duplicate example', '--kind', 'pattern', '--why', 'w', '--propose']);
  ok(['principles', 'merge', idOf('A merged duplicate example'), '--into', idOf('A merge survivor example')]);
  ok(['principles', 'add', 'A scoped contract example', '--kind', 'principle',
    '--stack', 'Node', '--stack', 'deno', '--work', 'code', '--work', 'docs', '--files', 'lib/**', '--files', 'tests/**']);
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
  const h = createHash('sha1');
  h.update(listing(dir));
  return h.digest('hex');
}

function chmodRecursive(dir, mode) {
  function walk(d) {
    chmodSync(d, mode);
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else chmodSync(full, mode & 0o555);
    }
  }
  walk(dir);
}

// --- version + change policy ----------------------------------------------------------

test('the doc states Version: <n> and has a change policy', () => {
  assert.match(doc, /Version:\s*\d+/);
  assert.match(doc, /change policy/i);
});

// --- header-keys block ------------------------------------------------------------------

test('contract:header-keys equals HEADER_KEYS from lib/principlemd.mjs, in order', () => {
  const lines = fencedBlock('contract:header-keys').split('\n').map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(lines, HEADER_KEYS);
});

// --- example-entry block -----------------------------------------------------------------

test('contract:example-entry parses and round-trips byte-for-byte through parsePrinciple/renderPrinciple', () => {
  const example = fencedBlock('contract:example-entry');
  const parsed = parsePrinciple(example);
  assert.equal(renderPrinciple(parsed), example);
});

// --- json-keys block against a real store -------------------------------------------------

test('every documented json key is present with the documented type on list --all --json --no-sync and show --json --no-sync', async () => {
  const home = mkHome(); const store = mkStore();
  seedStore(home, store);

  const keyLines = fencedBlock('contract:json-keys').split('\n').map((l) => l.trim()).filter(Boolean);
  const keyTypes = keyLines.map((l) => {
    const [k, t] = l.split(':').map((s) => s.trim());
    return { key: k, type: t };
  });

  const listR = run(['principles', 'list', '--all', '--json', '--no-sync'], home, store);
  assert.equal(listR.status, 0, listR.stderr);
  const entries = JSON.parse(listR.stdout);
  assert.ok(entries.length >= 5);
  for (const e of entries) {
    for (const { key, type } of keyTypes) {
      assert.ok(Object.prototype.hasOwnProperty.call(e, key), `entry ${e.id} missing key "${key}"`);
      if (type === 'array') assert.ok(Array.isArray(e[key]), `${key} must be an array on ${e.id}`);
      else assert.equal(typeof e[key], type, `${key} must be ${type} on ${e.id}`);
    }
  }

  const showR = run(['principles', 'show', entries[0].id, '--json', '--no-sync'], home, store);
  assert.equal(showR.status, 0, showR.stderr);
  const shown = JSON.parse(showR.stdout);
  for (const { key, type } of keyTypes) {
    assert.ok(Object.prototype.hasOwnProperty.call(shown, key), `show output missing key "${key}"`);
    if (type === 'array') assert.ok(Array.isArray(shown[key]));
    else assert.equal(typeof shown[key], type);
  }
});

// --- read-only rule (C9) ------------------------------------------------------------------

test('every documented --no-sync command runs read-only against a chmod a-w store', async () => {
  const home = mkHome(); const store = mkStore();
  seedStore(home, store);
  const listR = run(['principles', 'list', '--all', '--json'], home, store);
  const [{ id }] = JSON.parse(listR.stdout);

  const commands = [...doc.matchAll(/`(ac principles [^`]*--no-sync[^`]*)`/g)].map((m) => m[1].replace('<id>', id));
  assert.ok(commands.length >= 2, 'the doc must name at least list and show with --no-sync');

  const before = digestDir(store);
  const isRoot = process.getuid?.() === 0;
  if (!isRoot) chmodRecursive(store, 0o555);

  for (const cmd of commands) {
    const args = cmd.split(/\s+/).slice(1); // drop leading "ac"
    const r = run(args, home, store);
    assert.equal(r.status, 0, `${cmd} must exit 0 read-only: ${r.stderr}`);
  }

  if (!isRoot) {
    chmodRecursive(store, 0o755);
    assert.equal(digestDir(store), before, 'the store must be byte-identical after every --no-sync read');
  }
});

// C8 (phase 27 verify): the OPTIONAL keys are part of the contract too — renaming `reason`
// or `supersededBy` left the suite green. Each is present exactly when the on-disk header
// carries its key, under exactly the documented name, in both list and show; and scope
// values are written as the contract says.
test('optional json keys appear exactly when the header carries them, under their documented names', async () => {
  const home = mkHome(); const store = mkStore();
  seedStore(home, store);
  const OPTIONAL = [['reason', 'reason', 'string'], ['superseded-by', 'supersededBy', 'string'],
    ['merged-into', 'mergedInto', 'string'], ['source', 'source', 'object']];
  const headerOf = (id) => readFileSync(join(store, `${id}.md`), 'utf8').split('\n---')[0];
  const listR = run(['principles', 'list', '--all', '--json', '--no-sync'], home, store);
  assert.equal(listR.status, 0, listR.stderr);
  const entries = JSON.parse(listR.stdout);
  const statuses = new Set(entries.map((e) => e.status));
  for (const st of ['accepted', 'proposed', 'rejected', 'retired', 'superseded', 'merged']) {
    assert.ok(statuses.has(st), `the seeded store covers status ${st}`);
  }
  for (const e of entries) {
    const shown = JSON.parse(run(['principles', 'show', e.id, '--json', '--no-sync'], home, store).stdout);
    const header = headerOf(e.id);
    for (const [hkey, jkey, type] of OPTIONAL) {
      const onDisk = new RegExp(`^${hkey}:`, 'm').test(header);
      for (const [where, obj] of [['list', e], ['show', shown]]) {
        assert.equal(Object.prototype.hasOwnProperty.call(obj, jkey), onDisk, `${where} ${e.id} (${e.status}): "${jkey}" present iff header has "${hkey}:"`);
        if (onDisk) assert.equal(typeof obj[jkey], type, `${where} ${e.id}: ${jkey} is ${type}`);
      }
    }
  }
  const scoped = entries.find((e) => e.statement === 'A scoped contract example');
  assert.deepEqual(scoped.scopes, { stack: ['node', 'deno'], files: ['lib/**', 'tests/**'], work: ['code', 'docs'] });
  const h = headerOf(scoped.id);
  assert.match(h, /^stack: node, deno$/m);
  assert.match(h, /^work: code, docs$/m);
  assert.match(h, /^files: lib\/\*\*$/m);
  assert.match(h, /^files: tests\/\*\*$/m);
});
