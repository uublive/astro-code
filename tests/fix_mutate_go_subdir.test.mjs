// Fix 2026-11-09-ac-mutate-errors-when-the-go-module-is: a Go module below the repo root (host/go.mod,
// no go.mod at the root). Gremlins and the `go test` baseline must run from host/, with module-relative
// paths in, and the report's module-relative paths must come back repo-relative. The stub stands in for
// both tools and logs its cwd and argv, so this runs without Go installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase } from '../lib/roadmap.mjs';
import { installStub, restrictedEnv, commit, sh, FX } from './fixtures/mutate/project.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const put = (dir, f, b) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), b); };
const lines = (tag) => Array.from({ length: 30 }, (_, i) => `// ${tag} ${i + 1}`).join('\n') + '\n';

test('ac mutate runs Gremlins and go test from a subfolder Go module and maps paths both ways', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ac-mutate-gosub-'));
  try {
    sh(dir, 'init', '-q'); sh(dir, 'config', 'user.email', 't@t'); sh(dir, 'config', 'user.name', 't');
    initPlanning(dir, { name: 'gosub' });
    await addPhase(dir, { number: 1, name: 'First' });
    const cfg = join(dir, '.astrocode/config.json');
    writeFileSync(cfg, JSON.stringify({ ...JSON.parse(readFileSync(cfg, 'utf8')), mutation: { tool: 'gremlins' } }));
    put(dir, 'host/go.mod', 'module example.com/p\n\ngo 1.22\n');
    put(dir, 'host/c.go', '// c\n');
    commit(dir, 'init');
    put(dir, 'host/a.go', lines('a'));
    put(dir, 'host/a_test.go', 'package p\n\nfunc TestA(t *testing.T) {}\n');
    commit(dir, 'feat: a (phase 1 t1)');

    const bin = installStub(dir, 'gremlins');
    installStub(dir, 'go');
    const log = join(dir, 'stub.log');
    const env = restrictedEnv([bin], { MUTATE_STUB_LOG: log, MUTATE_STUB_REPORT: join(FX, 'gremlins.json') });
    const r = spawnSync(process.execPath, [AC, 'mutate', '1', '--json'], { cwd: dir, env, encoding: 'utf8', input: '', timeout: 60000 });
    assert.equal(r.status, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    assert.notEqual(res.outcome, 'error', res.error);
    assert.deepEqual(res.scope, ['host/a.go']);
    assert.equal(res.scope_detail.narrowed, 'files');

    const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const unleash = calls.find((c) => c.tool === 'gremlins' && c.argv[0] === 'unleash');
    assert.ok(unleash, 'gremlins unleash ran');
    assert.equal(unleash.cwd.replace(/^\/private/, ''), join(dir, 'host').replace(/^\/private/, ''), 'Gremlins runs from the module');
    assert.ok(!unleash.argv.includes('--diff'), 'no --diff for a subfolder module');
    assert.deepEqual(unleash.argv.filter((a, i) => unleash.argv[i - 1] === '--exclude-files'), ['^c\\.go$'], 'exclusions are module-relative');
    const goTest = calls.find((c) => c.tool === 'go' && c.argv[0] === 'test');
    assert.ok(goTest, 'the go test baseline ran');
    assert.equal(goTest.cwd.replace(/^\/private/, ''), join(dir, 'host').replace(/^\/private/, ''), 'go test runs from the module');
    assert.deepEqual(goTest.argv.slice(-1), ['.'], 'the package dir is module-relative');

    // The fixture report names `a.go` (module-relative): it must land on host/a.go.
    assert.ok(res.survivors.length > 0, 'survivors were matched to the phase\'s file');
    assert.ok(res.survivors.every((s) => s.file === 'host/a.go'), JSON.stringify(res.survivors.map((s) => s.file)));
    assert.ok(existsSync(join(dir, res.full_list)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
