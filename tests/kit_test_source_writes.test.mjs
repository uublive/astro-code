// Phase 141 (t19) — kit_test.py mirrors the data-change guard and the declared-write checks
// (SRC-16..19). Spawns `python3 tools/kit_test.py` asynchronously... via spawnSync on temp kits
// (no in-process server is involved here, so a blocking spawn is fine).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT_SRC = join(ROOT, 'examples/kit-convert-demo/commit-digest');
const TOOLS_DIR = join(ROOT, 'templates/kit/tools');
const hasPython = spawnSync('python3', ['--version']).status === 0;
const CORPUS = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/source-spec-cases.json'), 'utf8'));

const GOOD_WRITE = '-- @name close_order\n-- @description Marks an order closed\n-- @param OrderId int required\n-- @approval automatic\nUPDATE dbo.Orders SET Status = \'Closed\' WHERE OrderId = @OrderId;\n';
const W = 'src/sources/erp/writes/close_order.sql';
const FREE = 'src/sources/erp/free-writes.json';

function applyMergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const result = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = applyMergePatch(result[key], value);
  }
  return result;
}

/** A scratch kit from the corpus base plus a patch of manifest keys and files. */
function scratchKit({ manifest = {}, files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-kittest-writes-'));
  cpSync(KIT_SRC, dir, { recursive: true });
  cpSync(join(TOOLS_DIR, 'kit_test.py'), join(dir, 'tools/kit_test.py'));
  cpSync(join(TOOLS_DIR, 'validate_manifest.py'), join(dir, 'tools/validate_manifest.py'));
  cpSync(join(TOOLS_DIR, '_schema_engine.py'), join(dir, 'tools/_schema_engine.py'));
  mkdirSync(join(dir, 'tools/schemas'), { recursive: true });
  for (const f of ['kit-manifest.v4.schema.json', 'kit-manifest.v3.schema.json', 'sqlserver-types.v1.json', 'source-schema.v1.schema.json']) {
    cpSync(join(TOOLS_DIR, 'schemas', f), join(dir, 'tools/schemas', f));
  }
  const m = applyMergePatch(structuredClone(CORPUS.base.manifest), manifest);
  m.manifest_version = 4;
  writeFileSync(join(dir, 'kit.json'), JSON.stringify(m, null, 2));
  for (const [rel, content] of Object.entries({ ...CORPUS.base.files, ...files })) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

function runKitTest(dir) {
  const res = spawnSync('python3', ['tools/kit_test.py', '--json', '--skip-parity'], { cwd: dir, encoding: 'utf8' });
  let report = null;
  try { report = JSON.parse(res.stdout); } catch { /* ignore */ }
  const rows = (report?.results ?? []).filter((r) => r.group === 'sources');
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}`, rows, failIds: rows.filter((r) => r.status === 'FAIL').map((r) => r.id) };
}

const V12 = { contract_version: '^1.2.0' };

test('a valid writes kit passes kit_test', { skip: !hasPython }, () => {
  const dir = scratchKit({ manifest: V12, files: { [W]: GOOD_WRITE, [FREE]: '{"approval":"needs_approval","description":"fix notes"}' } });
  const r = runKitTest(dir);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.failIds, []);
  rmSync(dir, { recursive: true, force: true });
});

test('a DDL named write fails with SRC-17 naming the write', { skip: !hasPython }, () => {
  const dir = scratchKit({ manifest: V12, files: { [W]: GOOD_WRITE.replace(/UPDATE.*;\n/, 'DROP TABLE dbo.Orders WHERE @OrderId\n') } });
  const r = runKitTest(dir);
  assert.notEqual(r.status, 0);
  const row = r.rows.find((x) => x.id === 'SRC-17');
  assert.ok(row, r.out);
  assert.match(row.message, /writes\/close_order\.sql/);
  rmSync(dir, { recursive: true, force: true });
});

const FAILS = [
  ['an unknown @approval fails SRC-16', { [W]: GOOD_WRITE.replace('automatic', 'sometimes') }, 'SRC-16', V12],
  ['an undeclared param fails SRC-09', { [W]: GOOD_WRITE.replace('-- @param OrderId int required\n', '') }, 'SRC-09', V12],
  ['a write named like a named query fails SRC-16', { 'src/sources/erp/writes/open_orders.sql': GOOD_WRITE.replace(/close_order/g, 'open_orders') }, 'SRC-16', V12],
  ['a duplicate @name in a write fails SRC-16', { [W]: GOOD_WRITE.replace('-- @approval automatic\n', '-- @name close_order\n') }, 'SRC-16', V12],
  ['a bad free-writes.json fails SRC-18', { [FREE]: '{"approval":"maybe"}' }, 'SRC-18', V12],
  ['a duplicate key in free-writes.json fails SRC-18', { [FREE]: '{"approval":"automatic","approval":"automatic"}' }, 'SRC-18', V12],
  ['a writes kit at ^1.1.0 fails SRC-19', { [W]: GOOD_WRITE }, 'SRC-19', {}],
];
for (const [name, files, id, manifest] of FAILS) {
  test(name, { skip: !hasPython }, () => {
    const dir = scratchKit({ manifest, files });
    const r = runKitTest(dir);
    assert.notEqual(r.status, 0, r.out);
    assert.ok(r.failIds.includes(id), `${id} not in ${JSON.stringify(r.failIds)}\n${r.out}`);
    rmSync(dir, { recursive: true, force: true });
  });
}

test('a no-writes sources kit has unchanged output: no SRC-16..19 rows', { skip: !hasPython }, () => {
  const dir = scratchKit();
  const r = runKitTest(dir);
  assert.equal(r.status, 0, r.out);
  assert.ok(!r.rows.some((x) => ['SRC-16', 'SRC-17', 'SRC-18', 'SRC-19'].includes(x.id)));
  rmSync(dir, { recursive: true, force: true });
});

test('every data_change corpus row gives the same verdict from check_data_change', { skip: !hasPython }, () => {
  assert.ok(CORPUS.data_change.length >= 80);
  const rows = CORPUS.data_change;
  const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("kit_test", ${JSON.stringify(join(TOOLS_DIR, 'kit_test.py'))})
m = importlib.util.module_from_spec(spec)
sys.modules["kit_test"] = m
spec.loader.exec_module(m)
rows = json.loads(sys.stdin.read())
out = []
for r in rows:
    ok, res = m.check_data_change(r["sql"])
    out.append({"ok": ok, "verbs": [s["verb"] for s in res] if ok else None, "hasWhere": [s["hasWhere"] for s in res] if ok else None, "reason": None if ok else res})
print(json.dumps(out))
`;
  const res = spawnSync('python3', ['-I', '-c', script], { input: JSON.stringify(rows), encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(res.status, 0, res.stderr);
  const verdicts = JSON.parse(res.stdout);
  rows.forEach((row, i) => {
    assert.equal(verdicts[i].ok, row.ok, `row ${i} ${JSON.stringify(row.sql)} -> ${JSON.stringify(verdicts[i])}`);
    if (row.ok && row.verbs) assert.deepEqual(verdicts[i].verbs, row.verbs, `row ${i}`);
    if (row.ok && row.hasWhere) assert.deepEqual(verdicts[i].hasWhere, row.hasWhere, `row ${i}`);
    if (!row.ok && row.reasonIncludes) assert.ok(verdicts[i].reason.toLowerCase().includes(row.reasonIncludes.toLowerCase()), `row ${i}: ${verdicts[i].reason}`);
  });
});
