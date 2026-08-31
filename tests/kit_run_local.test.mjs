// Behavioral test for templates/kit/tools/kit_run_local.py — the Tier 2 local
// kit runner. Tier 2 stands up a one-kit registry on localhost and proves astro
// can resolve and load a kit that was never published.
//
// Two halves:
//   - the usage/guard paths need nothing but python3, so they always run;
//   - the real load path needs an astro checkout, so it is skipped when there
//     isn't one (CI, a fresh clone) rather than failing.
//
// The astro checkout is located via $ASTRO_ROOT, else the conventional sibling
// path. A checkout that predates ASTRO_KIT_BASE_DIR is treated as absent —
// kit_run_local.py refuses it by design, and that refusal is asserted below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT_SRC = join(ROOT, 'examples/kit-convert-demo/commit-digest');
const TOOL = join(ROOT, 'templates/kit/tools/kit_run_local.py');

/** The astro checkout, or null when it is absent or too old for local runs. */
function astroRoot() {
  const candidates = [
    process.env.ASTRO_ROOT,
    join(homedir(), 'Development/astro'),
    join(ROOT, '..', 'astro'),
  ].filter(Boolean);
  for (const c of candidates) {
    // kit-base-dir.ts is the module that makes local kit runs possible at all.
    if (existsSync(join(c, 'apps/astro/src/kits/kit-base-dir.ts'))) return c;
  }
  return null;
}

const ASTRO = astroRoot();

function scratchKit({ breakLoad = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-kitlocal-'));
  cpSync(KIT_SRC, dir, { recursive: true });
  cpSync(TOOL, join(dir, 'tools/kit_run_local.py'));
  cpSync(join(ROOT, 'templates/kit/tools/kit_test.py'), join(dir, 'tools/kit_test.py'));
  if (breakLoad) rmSync(join(dir, 'src/CLAUDE.md')); // astro cannot load a kit without it
  return dir;
}

function run(cwd, args) {
  const res = spawnSync('python3', [join(cwd, 'tools/kit_run_local.py'), ...args], {
    cwd, encoding: 'utf8',
  });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

// ── guards (no astro checkout needed) ────────────────────────────────────

test('exits 2 when run outside a kit root', () => {
  const kit = scratchKit();
  const res = spawnSync('python3', [join(kit, 'tools/kit_run_local.py'), '--astro-root', ASTRO || '/tmp'], {
    cwd: tmpdir(), encoding: 'utf8',
  });
  assert.equal(res.status, 2);
  assert.match(`${res.stdout}${res.stderr}`, /registry-entry\.json/);
});

test('exits 2 when no astro checkout is given', () => {
  const kit = scratchKit();
  const res = spawnSync('python3', [join(kit, 'tools/kit_run_local.py')], {
    cwd: kit, encoding: 'utf8', env: { ...process.env, ASTRO_ROOT: '' },
  });
  assert.equal(res.status, 2);
  assert.match(`${res.stdout}${res.stderr}`, /astro checkout/);
});

test('exits 2 when the astro path is not a checkout', () => {
  const kit = scratchKit();
  const res = run(kit, ['--astro-root', tmpdir()]);
  assert.equal(res.status, 2);
  assert.match(res.out, /does not look like the astro checkout/);
});

test('--execute refuses to spend tokens without a task', { skip: !ASTRO && 'no astro checkout' }, () => {
  const kit = scratchKit();
  const res = run(kit, ['--astro-root', ASTRO, '--execute']);
  assert.equal(res.status, 2);
  assert.match(res.out, /--execute needs --task/);
});

// ── the real thing (needs an astro checkout) ─────────────────────────────

test('resolves and loads an UNPUBLISHED kit from a local registry',
  { skip: !ASTRO && 'no astro checkout' }, () => {
    const kit = scratchKit();
    const res = run(kit, ['--astro-root', ASTRO]);
    assert.equal(res.status, 0, `expected a clean load\n${res.out}`);
    // The kit must come from the LOCAL registry and skip the download entirely.
    assert.match(res.out, /1 kit\(s\): commit-digest/);
    assert.match(res.out, /download skipped/);
    assert.match(res.out, /recipes\s+1 discovered/);
    assert.match(res.out, /without it being published/);
  });

test('fails when astro cannot actually load the kit',
  { skip: !ASTRO && 'no astro checkout' }, () => {
    const kit = scratchKit({ breakLoad: true });
    const res = run(kit, ['--astro-root', ASTRO]);
    assert.equal(res.status, 1, `a kit with no CLAUDE.md must fail\n${res.out}`);
    assert.match(res.out, /CLAUDE\.md\s+FAILED/);
    assert.match(res.out, /FAILED at load/);
  });

test('sets up without running the agent unless asked',
  { skip: !ASTRO && 'no astro checkout' }, () => {
    const kit = scratchKit();
    const res = run(kit, ['--astro-root', ASTRO]);
    assert.equal(res.status, 0);
    // Default must never spend tokens, and must not hand out a dead registry URL.
    assert.match(res.out, /no agent was run/);
    assert.match(res.out, /already been torn down/);
  });
