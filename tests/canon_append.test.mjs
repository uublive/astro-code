// Phase 22 (t6) — `appendConvention`, the promote-as-convention primitive.
//
// `ac principles promote <id> --as convention` needs to add a single bullet to the
// project's local CONVENTIONS.md WITHOUT publishing it (P14, ADR-053 refuse-first):
// this suite proves the append is byte-identical-prefix-preserving, idempotent per
// bullet, heading-reused, and never touches the registry sync baseline — all with no
// remote configured, since `appendConvention` itself never runs git.
//
// `appendConvention` does not exist on the branch yet at test-authoring time (ADR-018),
// so every test dynamically imports `lib/canon.mjs` inside its own async body. Only
// `lib/planning.mjs` (`initPlanning`) and `lib/paths.mjs` (`paths`), already on the
// branch, are imported statically.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';

function mkProject(name) {
  const dir = mkdtempSync(join(tmpdir(), `ac-canon-append-${name}-`));
  initPlanning(dir, { name: `proj-${name}` });
  return dir;
}

test('appendConvention keeps the old CONVENTIONS.md as a byte-identical prefix of the new one', async () => {
  const { appendConvention } = await import('../lib/canon.mjs');
  const dir = mkProject('prefix');
  const before = readFileSync(paths(dir).conventions, 'utf8');

  const res = await appendConvention(dir, '- Never mock the database in a unit test.');

  const after = readFileSync(paths(dir).conventions, 'utf8');
  assert.equal(res.appended, true);
  assert.ok(after.startsWith(before), 'the prior content must be an unmodified prefix of the new file');
  assert.ok(after.includes('- Never mock the database in a unit test.'));
});

test('the "Promoted from personal principles" heading is added once and reused by a second bullet', async () => {
  const { appendConvention } = await import('../lib/canon.mjs');
  const dir = mkProject('heading-reuse');

  await appendConvention(dir, '- Never mock the database in a unit test.');
  const afterFirst = readFileSync(paths(dir).conventions, 'utf8');
  const headingCount = (afterFirst.match(/## Promoted from personal principles/g) || []).length;
  assert.equal(headingCount, 1);

  await appendConvention(dir, '- Always redact secrets before logging an excerpt.');
  const afterSecond = readFileSync(paths(dir).conventions, 'utf8');
  const headingCountAfterSecond = (afterSecond.match(/## Promoted from personal principles/g) || []).length;
  assert.equal(headingCountAfterSecond, 1, 'the heading must not be duplicated for a second bullet');
  assert.ok(afterSecond.includes('- Never mock the database in a unit test.'));
  assert.ok(afterSecond.includes('- Always redact secrets before logging an excerpt.'));
});

test('appending the same bullet twice is a no-op the second time', async () => {
  const { appendConvention } = await import('../lib/canon.mjs');
  const dir = mkProject('idempotent');
  const bullet = '- Never mock the database in a unit test.';

  const first = await appendConvention(dir, bullet);
  assert.equal(first.appended, true);
  const afterFirst = readFileSync(paths(dir).conventions, 'utf8');

  const second = await appendConvention(dir, bullet);
  const afterSecond = readFileSync(paths(dir).conventions, 'utf8');

  assert.equal(second.appended, false);
  assert.equal(afterSecond, afterFirst, 'a repeated bullet must leave the file unchanged');
});

test('appendConvention never touches .conventions-synced', async () => {
  const { appendConvention } = await import('../lib/canon.mjs');
  const dir = mkProject('no-sync-touch');
  assert.equal(existsSync(paths(dir).conventionsSynced), false, 'a fresh project has no sync baseline yet');

  await appendConvention(dir, '- Never mock the database in a unit test.');

  assert.equal(existsSync(paths(dir).conventionsSynced), false, 'appendConvention must not create a sync baseline');
});
