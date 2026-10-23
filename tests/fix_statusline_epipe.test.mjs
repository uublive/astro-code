// Fix 2026-10-23-the-statusline-hook-crashes-with-an: a reader that closes before the hook writes
// (`| head`, `| true`) made the final stdout write throw an uncaught EPIPE: a stack trace, exit 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'astro-statusline.mjs');

test('the statusline hook exits quietly when its reader has already closed the pipe', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ac-epipe-'));
  const payload = join(dir, 'payload.json');
  writeFileSync(payload, JSON.stringify({ model: { display_name: 'Opus' }, workspace: { current_dir: dir } }));
  for (let i = 0; i < 3; i++) {
    const r = spawnSync('bash', ['-c', `"${process.execPath}" "${HOOK}" < "${payload}" | true; echo "rc=\${PIPESTATUS[0]}" >&2`], { encoding: 'utf8', env: { ...process.env, HOME: dir } });
    assert.doesNotMatch(r.stderr, /EPIPE|at .*\(node:/, 'no stack trace');
    assert.match(r.stderr, /rc=0/, 'the hook itself exits 0');
  }
});
