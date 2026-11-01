// Phase 55 t6 — `ac doctor` warns, read-only, when lean-ctx is set to inject its "solution"
// guidance into subagents (it would blur the executor / verifier split), and says nothing
// otherwise. The row is ADVISORY: it prints a warning but never changes doctor's exit code.
// lean-ctx injects by default, so a config with no [solution] table warns too. Fake homes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runDoctor, renderDoctor } from '../lib/doctor.mjs';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');

function home(toml) {
  const h = mkdtempSync(join(tmpdir(), 'ac-doc-lc-'));
  const file = join(h, '.lean-ctx', 'config.toml');
  if (toml !== undefined) {
    mkdirSync(join(h, '.lean-ctx'));
    if (toml !== null) writeFileSync(file, toml);
  }
  return { h, file };
}
const lcRows = (rows) => rows.filter((r) => r.id === 'lean-ctx');
const lcLines = (rows) => renderDoctor(rows).filter((l) => /lean-ctx/.test(l));
const doctor = (h) => runDoctor({ home: h, astroHome: join(h, '.astro', 'code') });

test('inject_in_subagents = true warns once, names the cause and the fix', () => {
  const { h, file } = home('[solution]\nenabled = true\ninject_in_subagents = true\n');
  const before = [readFileSync(file, 'utf8'), statSync(file).mtimeMs];
  const rows = doctor(h);
  assert.equal(lcRows(rows).length, 1);
  assert.equal(lcRows(rows)[0].advisory, true);
  const lines = lcLines(rows);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^⚠ /);
  assert.match(lines[0], /solution guidance.*subagents/);
  assert.match(lines[0], /inject_in_subagents = false/);
  assert.deepEqual([readFileSync(file, 'utf8'), statSync(file).mtimeMs], before, 'config untouched');
});

test('a config with no [solution] table also warns, because the default is on', () => {
  const { h } = home('[other]\ninject_in_subagents = false\n');
  assert.equal(lcLines(doctor(h)).length, 1);
});

test('an empty ~/.lean-ctx (no config file) also warns', () => {
  const { h } = home(null);
  assert.equal(lcLines(doctor(h)).length, 1);
});

test('inject_in_subagents = false, or [solution] disabled, gives no lean-ctx line', () => {
  for (const toml of [
    '[solution]\ninject_in_subagents = false\n',
    '[solution]\nenabled = false\ninject_in_subagents = true\n',
    '[solution]   # tuned\ninject_in_subagents=false # off\n',
  ]) {
    const { h, file } = home(toml);
    const before = [readFileSync(file, 'utf8'), statSync(file).mtimeMs];
    assert.equal(lcRows(doctor(h)).length, 0, toml);
    assert.deepEqual([readFileSync(file, 'utf8'), statSync(file).mtimeMs], before);
  }
});

test('no ~/.lean-ctx at all: no lean-ctx row and no throw', () => {
  const { h } = home(undefined);
  const rows = doctor(h);
  assert.equal(lcRows(rows).length, 0);
  assert.equal(rows.some((r) => /could not run/.test(r.detail)), false);
});

test('an advisory-only report still ends with the consistent line unless failuresOnly', () => {
  const rows = [
    { id: 'version', host: null, dir: null, ok: true, detail: 'fine', fix: null },
    { id: 'lean-ctx', host: null, dir: null, ok: false, advisory: true, detail: 'x', fix: 'y' },
  ];
  const lines = renderDoctor(rows);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^⚠ x → y$/);
  assert.match(lines[1], /^✓ install consistent/);
  assert.deepEqual(renderDoctor(rows, { failuresOnly: true }), [lines[0]]);
});

test('CLI: the warning never changes the exit code', () => {
  const run = (toml) => {
    const { h } = home(toml);
    const r = spawnSync(process.execPath, [BIN, 'doctor'], { env: { HOME: h, PATH: process.env.PATH }, encoding: 'utf8' });
    return { code: r.status, lc: r.stdout.split('\n').filter((l) => /lean-ctx/.test(l)) };
  };
  const a = run('[solution]\ninject_in_subagents = true\n');
  const b = run('[solution]\ninject_in_subagents = false\n');
  const c = run(undefined);
  assert.equal(a.lc.length, 1);
  assert.equal(b.lc.length, 0);
  assert.equal(c.lc.length, 0);
  assert.equal(a.code, b.code);
  assert.equal(a.code, c.code);
});
