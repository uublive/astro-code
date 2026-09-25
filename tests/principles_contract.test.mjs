// Guard for templates/PRINCIPLES-CONTRACT.md (phase 27 t8): the fixed header order and
// the promised JSON keys must match what the code actually does, the example entry must
// round-trip byte-for-byte, and every documented `--no-sync` command must actually work
// read-only against a store with no write access (C9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readFileSync, mkdtempSync, writeFileSync, chmodSync, readdirSync, statSync, existsSync,
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

function fixtureFile() {
  const nodes = [
    { slug: 'accepted-one', type: 'Principle', statement: 'An accepted contract example', status: 'approved',
      signals: [{ text: 'a signal', source: 's', at: '2026-09-01T00:00:00.000Z' }] },
    { slug: 'proposed-one', type: 'Pattern', statement: 'A proposed contract example', status: 'pending' },
    { slug: 'rejected-one', type: 'AntiPattern', statement: 'A rejected contract example', status: 'rejected', reason: 'no' },
    { slug: 'superseded-one', type: 'Principle', statement: 'An old contract example', status: 'superseded', superseded_by: 'superseded-two' },
    { slug: 'superseded-two', type: 'Principle', statement: 'A new contract example', status: 'approved' },
  ];
  const dir = mkdtempSync(join(tmpdir(), 'ac-contract-fixture-'));
  const file = join(dir, 'export.json');
  writeFileSync(file, JSON.stringify({
    format: 'astro-forge-export', version: 1, exported_at: '2026-09-20T00:00:00.000Z', nodes,
  }));
  return file;
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
  const file = fixtureFile();
  const importR = run(['principles', 'import', '--from-forge', file], home, store);
  assert.equal(importR.status, 0, importR.stderr);

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
  const file = fixtureFile();
  run(['principles', 'import', '--from-forge', file], home, store);
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
