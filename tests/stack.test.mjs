// Phase 25 t1 — spec for stack detection (lib/stack.mjs), P5 of the phase plan.
// Pure unit tests over real `mkdtempSync` project directories: manifest presence at
// the root only, never a package manager, never `node_modules` (ADR-001).
//
// Reached via `await import(...)` inside every test body per ADR-018 — the module
// (`lib/stack.mjs`) does not exist on this branch yet (t2 is its own task in the
// same wave); a static import here would crash the whole file at module load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function tempProject() {
  return mkdtempSync(join(tmpdir(), 'astro-stack-'));
}

test('package.json deps + devDeps lowercase into tags, sources name the file', async () => {
  const { detectStack } = await import('../lib/stack.mjs');
  const root = tempProject();
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    dependencies: { Express: '^4' },
    devDependencies: { Vitest: '1' },
  }));
  const { tags, sources } = detectStack(root);
  assert.ok(tags.includes('node'));
  assert.ok(tags.includes('express'));
  assert.ok(tags.includes('vitest'));
  const pkg = sources.find((s) => s.file === 'package.json');
  assert.ok(pkg);
  assert.ok(pkg.tags.includes('express'));
});

test('malformed package.json still yields node only, never throws', async () => {
  const { detectStack } = await import('../lib/stack.mjs');
  const root = tempProject();
  writeFileSync(join(root, 'package.json'), '{ not json');
  const { tags } = detectStack(root);
  assert.deepEqual(tags, ['node']);
});

test('go.mod only detects go', async () => {
  const { detectStack } = await import('../lib/stack.mjs');
  const root = tempProject();
  writeFileSync(join(root, 'go.mod'), 'module example.com/x\n');
  const { tags } = detectStack(root);
  assert.deepEqual(tags, ['go']);
});

test('Cargo.toml detects rust', async () => {
  const { detectStack } = await import('../lib/stack.mjs');
  const root = tempProject();
  writeFileSync(join(root, 'Cargo.toml'), '[package]\nname = "x"\n');
  const { tags } = detectStack(root);
  assert.deepEqual(tags, ['rust']);
});

test('pyproject.toml detects python', async () => {
  const { detectStack } = await import('../lib/stack.mjs');
  const root = tempProject();
  writeFileSync(join(root, 'pyproject.toml'), '[project]\nname = "x"\n');
  const { tags } = detectStack(root);
  assert.deepEqual(tags, ['python']);
});

test('empty dir yields no tags', async () => {
  const { detectStack } = await import('../lib/stack.mjs');
  const root = tempProject();
  const { tags, sources } = detectStack(root);
  assert.deepEqual(tags, []);
  assert.deepEqual(sources, []);
});

test('config override replaces detection with lowercased tags', async () => {
  const { projectStack } = await import('../lib/stack.mjs');
  const root = tempProject();
  writeFileSync(join(root, 'go.mod'), 'module example.com/x\n');
  mkdirSync(join(root, '.astrocode'));
  writeFileSync(join(root, '.astrocode', 'config.json'), JSON.stringify({ stack: ['Rust'] }));
  const { tags, override } = projectStack(root);
  assert.deepEqual(tags, ['rust']);
  assert.equal(override, true);
});

test('comma-string override splits and lowercases', async () => {
  const { projectStack } = await import('../lib/stack.mjs');
  const root = tempProject();
  mkdirSync(join(root, '.astrocode'));
  writeFileSync(join(root, '.astrocode', 'config.json'), JSON.stringify({ stack: 'go, node' }));
  const { tags, override } = projectStack(root);
  assert.deepEqual(tags, ['go', 'node']);
  assert.equal(override, true);
});

test('empty-array override falls back to detection', async () => {
  const { projectStack } = await import('../lib/stack.mjs');
  const root = tempProject();
  writeFileSync(join(root, 'go.mod'), 'module example.com/x\n');
  mkdirSync(join(root, '.astrocode'));
  writeFileSync(join(root, '.astrocode', 'config.json'), JSON.stringify({ stack: [] }));
  const { tags, override } = projectStack(root);
  assert.deepEqual(tags, ['go']);
  assert.equal(override, false);
});

test('STACK_MANIFESTS is exported and non-empty', async () => {
  const { STACK_MANIFESTS } = await import('../lib/stack.mjs');
  assert.ok(Array.isArray(STACK_MANIFESTS));
  assert.ok(STACK_MANIFESTS.length > 5);
});
