// Phase 59 t14 — the docs say how a heavy job is bounded: the budget, the machine lock, the env variables, the
// private Go cache and temp folder, the subfolder --diff path and its fallback, and that mutation never stops early.
// Concept-level matches (names and rules), not pinned prose: a copyedit must not go red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

test('the ac suite run docs (astro-verify and the MANUAL) name the budget variables, the shaping and the private TMPDIR', () => {
  for (const f of ['commands/astro-verify.md', 'MANUAL.md']) {
    const src = read(f);
    for (const needle of ['ASTRO_WORKERS', 'GOMAXPROCS', 'GOFLAGS', '--test-concurrency', 'go test -p', 'TMPDIR', 'machine lock']) {
      assert.ok(src.includes(needle), `${f}: ${needle}`);
    }
    assert.match(src, /-p=<n>|GOFLAGS -p/, `${f}: GOFLAGS -p`);
  }
});

test('astro-config documents heavy.workers and heavy.go_cache_max_mb with their defaults', () => {
  const src = read('commands/astro-config.md');
  assert.match(src, /heavy\.workers/);
  assert.match(src, /heavy\.go_cache_max_mb/);
  assert.match(src, /5120/);
  assert.match(src, /quarter of the (CPUs|cores)/);
  assert.match(src, /ASTRO_HEAVY_DIR/);
});

test('astro-mutate documents the budget per tool, the cap rule, the lock wait, the private cache and temp folder, the subfolder --diff path and no early stop', () => {
  const src = read('commands/astro-mutate.md');
  for (const re of [
    /--workers/, /GOMAXPROCS/, /GOFLAGS -p/, /--max-children/, /mutation\.max_children/, /--concurrency/, /never `--test-cpu`/,
    /lower project value\s+is respected,\s+a higher one is capped/i,
    /one heavy job per machine/i, /does not\s+count against the cap/i,
    /private Go (build )?cache/i, /heavy\.go_cache_max_mb/, /oldest[^.]*first/i, /temp folder/i, /Ctrl-C/, /dead run/i,
    /subfolder/i, /--diff/, /scratch git repo/i, /fell back to whole-file mode/,
    /no early stop/i,
  ]) assert.match(src, re);
});

test('the MANUAL carries the same rules where a reader looks them up', () => {
  const src = read('MANUAL.md');
  const at = src.indexOf('## Mutation testing (test-strength criteria)');
  const sec = src.slice(at, src.indexOf('\n## ', at + 5));
  for (const re of [/heavy\.workers/, /heavy\.go_cache_max_mb/, /ASTRO_HEAVY_DIR/, /scratch git repo/i, /no early stop/i, /one heavy job per machine/i, /capped/]) assert.match(sec, re);
});
