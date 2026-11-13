// Personal identity aliases (phase 58): ~/.astro/config.json -> identity.aliases, git email kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../lib/git.mjs';

const mod = () => import('../lib/identity.mjs');
const home = () => mkdtempSync(join(tmpdir(), 'ac-id-home-'));
const cfgFile = (h) => join(h, '.astro', 'config.json');
function seed(h, obj) {
  mkdirSync(join(h, '.astro'), { recursive: true });
  writeFileSync(cfgFile(h), typeof obj === 'string' ? obj : JSON.stringify(obj));
}

test('normalizeOwner trims and lower-cases; a non-string is empty', async () => {
  const { normalizeOwner } = await mod();
  assert.equal(normalizeOwner('  Me@Example.TEST '), 'me@example.test');
  assert.equal(normalizeOwner(undefined), '');
  assert.equal(normalizeOwner(7), '');
});

test('add, read and remove round-trip; idempotent', async () => {
  const { addUserAlias, removeUserAlias, readUserAliases } = await mod();
  const h = home();
  assert.deepEqual(readUserAliases({ home: h }), []);
  const a = addUserAlias({ home: h, email: 'Old@Example.test' });
  assert.deepEqual([a.ok, a.changed, a.aliases], [true, true, ['old@example.test']]);
  assert.equal(addUserAlias({ home: h, email: 'old@example.test' }).changed, false);
  assert.deepEqual(readUserAliases({ home: h }), ['old@example.test']);
  const r = removeUserAlias({ home: h, email: 'OLD@example.test' });
  assert.deepEqual([r.ok, r.changed, r.aliases], [true, true, []]);
  assert.equal(removeUserAlias({ home: h, email: 'old@example.test' }).changed, false);
});

test('every other key survives a write, the token included', async () => {
  const { addUserAlias } = await mod();
  const h = home();
  const other = { astrokit: { token: 'secret-token' }, agent_tools: { a: 1 }, models: { executor: 'opus' }, statusline: { x: true }, identity: { extra: 1 } };
  seed(h, other);
  assert.equal(addUserAlias({ home: h, email: 'a@b.c' }).ok, true);
  const after = JSON.parse(readFileSync(cfgFile(h), 'utf8'));
  assert.deepEqual({ ...after, identity: undefined }, { ...other, identity: undefined });
  assert.deepEqual(after.identity, { extra: 1, aliases: ['a@b.c'] });
});

test('a file that is not a JSON object is refused and left untouched', async () => {
  const { addUserAlias, removeUserAlias } = await mod();
  for (const bad of ['[1,2]', 'not json', '"str"']) {
    const h = home();
    seed(h, bad);
    const r = addUserAlias({ home: h, email: 'a@b.c' });
    assert.equal(r.ok, false);
    assert.equal(removeUserAlias({ home: h, email: 'a@b.c' }).ok, false);
    assert.equal(readFileSync(cfgFile(h), 'utf8'), bad);
  }
});

test('an empty alias is rejected; bad shapes read as no aliases', async () => {
  const { addUserAlias, readUserAliases } = await mod();
  const h = home();
  assert.equal(addUserAlias({ home: h, email: '   ' }).ok, false);
  for (const shape of [{ identity: 'x' }, { identity: { aliases: 'a@b.c' } }, { identity: { aliases: [1, '', null] } }, '{bad']) {
    seed(h, shape);
    assert.deepEqual(readUserAliases({ home: h }), []);
  }
  seed(h, { identity: { aliases: ['A@b.c', 'a@b.c ', 7, 'z@z.z'] } });
  assert.deepEqual(readUserAliases({ home: h }), ['a@b.c', 'z@z.z']);
});

test('myIdentities adds aliases to the repo-local git email, never replaces it; case-insensitive', async () => {
  const { myIdentities, addUserAlias } = await mod();
  const h = home();
  const repo = mkdtempSync(join(tmpdir(), 'ac-id-repo-'));
  git(['init', '--quiet'], { cwd: repo });
  git(['config', 'user.email', 'Me@Example.test'], { cwd: repo });
  addUserAlias({ home: h, email: 'me-old@example.test' });
  const set = myIdentities({ root: repo, home: h });
  assert.deepEqual([...set].sort(), ['me-old@example.test', 'me@example.test']);
  assert.ok(set.has('me@example.test'));
});

test('without an email the git name stands in (mirrors gitIdentity)', async () => {
  const { myIdentities } = await mod();
  const repo = mkdtempSync(join(tmpdir(), 'ac-id-repo-'));
  git(['init', '--quiet'], { cwd: repo });
  git(['config', 'user.email', ''], { cwd: repo });
  git(['config', 'user.name', 'Just A Name'], { cwd: repo });
  assert.ok(myIdentities({ root: repo, home: home() }).has('just a name'));
});
