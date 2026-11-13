// ADR-094 (phase 57 t1): the four `verify.*` readers. A bad value falls back with one warning, never fatal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function proj(verify) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-vmode-'));
  mkdirSync(join(dir, '.astrocode'), { recursive: true });
  writeFileSync(join(dir, '.astrocode', 'config.json'), JSON.stringify(verify === undefined ? {} : { verify }));
  return dir;
}
const read = async (fn, verify) => {
  const m = await import('../lib/config.mjs');
  const warnings = [];
  return { v: m[fn](proj(verify), warnings), warnings };
};

test('verify.full_suite defaults to milestone, accepts phase, and warns on anything else', async () => {
  assert.deepEqual(await read('verifyFullSuite', undefined), { v: 'milestone', warnings: [] });
  assert.deepEqual(await read('verifyFullSuite', { full_suite: 'phase' }), { v: 'phase', warnings: [] });
  for (const bad of ['Phase', 'fast', 1]) {
    const r = await read('verifyFullSuite', { full_suite: bad });
    assert.equal(r.v, 'milestone');
    assert.equal(r.warnings.length, 1);
  }
});

test('verify.repair_attempts defaults to 2 and needs an integer >= 1', async () => {
  assert.equal((await read('repairAttempts', {})).v, 2);
  assert.equal((await read('repairAttempts', { repair_attempts: 3 })).v, 3);
  for (const bad of [0, -1, 'x', 1.5]) {
    const r = await read('repairAttempts', { repair_attempts: bad });
    assert.equal(r.v, 2);
    assert.equal(r.warnings.length, 1);
  }
});

test('verify.targeted_command needs {files}', async () => {
  assert.equal((await read('targetedCommandTemplate', {})).v, 'node --test {files}');
  assert.equal((await read('targetedCommandTemplate', { targeted_command: 'node scripts/test.mjs {files}' })).v, 'node scripts/test.mjs {files}');
  const r = await read('targetedCommandTemplate', { targeted_command: 'npm test' });
  assert.equal(r.v, 'node --test {files}');
  assert.equal(r.warnings.length, 1);
});

test('verify.suite_command has no default and is trimmed', async () => {
  assert.equal((await read('suiteCommandSetting', {})).v, null);
  assert.equal((await read('suiteCommandSetting', { suite_command: '  npm test ' })).v, 'npm test');
});
