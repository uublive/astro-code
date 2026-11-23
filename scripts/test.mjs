#!/usr/bin/env node
// `npm test`: `node --test` with TMPDIR pointed at one fresh folder that is removed afterwards
// (#131). The tests make their fixtures with `mkdtempSync(join(tmpdir(), …))` at some 235 call
// sites and mostly never delete them; one run left ~1,370 folders (42k entries) behind, enough to
// exhaust the inodes of a tmpfs /tmp. Scoping TMPDIR here cleans every one of them, on success,
// on failure and on Ctrl-C, without touching each test. Extra arguments go to `node --test`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = mkdtempSync(join(tmpdir(), 'ac-test-run-'));
// Ctrl-C reaches the test runner too; this process waits for it to stop, then cleans up.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {});
let status = 1;
try {
  const r = spawnSync(process.execPath, ['--test', ...process.argv.slice(2)], {
    stdio: 'inherit',
    // Phase 59: the machine lock and run folders live under ASTRO_HEAVY_DIR; pinned inside the scratch
    // dir so `npm test` never touches (or waits on) the owner's real heavy-job lock.
    env: { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir, ASTRO_HEAVY_DIR: join(dir, 'heavy') },
  });
  status = r.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(status);
