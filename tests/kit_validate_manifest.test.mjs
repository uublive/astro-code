// validate_manifest.py and pip `verify` (#11). The hosted registry rejects a manifest
// v4 pip tool without `verify` (HTTP 422), because without it the instance assumes a
// CLI named after the package and provisioning breaks for every kit. The validator
// used to pass such manifests through every local gate; these pin that it now fails
// them offline — and a verify that imports a hyphenated (invalid) module name too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATOR = join(ROOT, 'templates/kit/tools/validate_manifest.py');
const DEMO = JSON.parse(readFileSync(join(ROOT, 'examples/kit-convert-demo/commit-digest/kit.json'), 'utf8'));
const hasPython = spawnSync('python3', ['--version']).status === 0;

function validate(tools, { manifestVersion } = {}) {
  const m = structuredClone(DEMO);
  m.requires.tools = tools;
  if (manifestVersion) m.manifest_version = manifestVersion;
  const file = join(mkdtempSync(join(tmpdir(), 'ac-vm-')), 'kit.json');
  writeFileSync(file, JSON.stringify(m, null, 2));
  return spawnSync('python3', [VALIDATOR, file], { encoding: 'utf8' });
}

const pip = (extra = {}) => ({ source: 'pip', name: 'python-docx', version: '1.1.2', ...extra });

test('the shipped demo kit passes (it declares a verify)', { skip: !hasPython }, () => {
  const res = validate(DEMO.requires.tools);
  assert.equal(res.status, 0, res.stderr);
});

test('a v4 pip tool without verify is an error that explains the import name (#11)', { skip: !hasPython }, () => {
  const res = validate([pip()]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /requires\.tools\[0\].*python-docx.*no "verify"/);
  assert.match(res.stderr, /import docx/, 'must show the module-name form, not the package name');
});

test('a verify importing a hyphenated name is rejected — it is not valid Python (#11)', { skip: !hasPython }, () => {
  const res = validate([pip({ verify: 'python3 -c "import python-docx"' })]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /requires\.tools\[0\]\.verify.*'python-docx'/);
});

test('a correct module-name verify passes', { skip: !hasPython }, () => {
  const res = validate([pip({ verify: 'python3 -c "import docx"' })]);
  assert.equal(res.status, 0, res.stderr);
});
