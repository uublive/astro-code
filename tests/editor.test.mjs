// Unit tests for `lib/editor.mjs`'s `$EDITOR` round-trip (P8, phase 22 t5).
//
// This is the only TTY-dependent piece of the principle-review surface — every other
// module is pure or filesystem-only, testable without a subprocess. Tests inject
// `EDITOR` (never the real interactive editor) with small non-interactive scripts —
// `sed -i` for a real edit, `true`/`false` for the no-op and failure cases — the same
// trick git's own test suite uses for `GIT_EDITOR`.
//
// Per ADR-018 `lib/editor.mjs` is pulled in with `await import(...)` INSIDE each async
// test body (never a static top-of-file import), since it does not exist on the branch
// yet — a static import would crash the whole file at module load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Snapshot of `ac-edit-*` dirs directly under the OS tmpdir, so a test can assert the
// editor's own temp dir is gone afterwards without editText ever revealing its path.
function acEditDirs() {
  return new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('ac-edit-')));
}

test('a real edit (sed rewording the statement) reports changed:true and the reworded text', async () => {
  const { editText } = await import('../lib/editor.mjs');
  const before = acEditDirs();
  const { text, changed } = editText('Use pnpm', {
    env: { EDITOR: "sed -i 's/Use pnpm/Always use pnpm/'" },
  });
  assert.equal(changed, true);
  assert.equal(text, 'Always use pnpm');
  const after = acEditDirs();
  assert.deepEqual(after, before, 'the temp dir must be removed after the round trip');
});

test('EDITOR=true leaves the text untouched and reports changed:false', async () => {
  const { editText } = await import('../lib/editor.mjs');
  const { text, changed } = editText('Use pnpm', { env: { EDITOR: 'true' } });
  assert.equal(changed, false);
  assert.equal(text, 'Use pnpm');
});

test('an editor exiting non-zero throws and changes nothing', async () => {
  const { editText } = await import('../lib/editor.mjs');
  assert.throws(
    () => editText('Use pnpm', { env: { EDITOR: 'false' } }),
    /editor exited 1 — nothing changed/,
  );
});

test('#-comment lines are stripped from the result', async () => {
  const { editText } = await import('../lib/editor.mjs');
  // Prepend a `#` line ahead of the statement — a real edit that leaves the
  // instructional comments in place must never leak into the returned text.
  const { text } = editText('Use pnpm', {
    env: { EDITOR: "sed -i '1i# a note from the editor'" },
  });
  assert.equal(text, 'Use pnpm');
  assert.ok(!text.includes('#'));
});

test('the temp dir used for the round trip does not survive the call', async () => {
  const { editText } = await import('../lib/editor.mjs');
  const before = acEditDirs();
  editText('Use pnpm', { env: { EDITOR: 'true' } });
  const after = acEditDirs();
  assert.deepEqual(after, before);
});

test('an EDITOR containing arguments works, exactly like git\'s "$1" form', async () => {
  const { editText } = await import('../lib/editor.mjs');
  const { text, changed } = editText('Use pnpm', {
    env: { EDITOR: "sed -i -e 's/pnpm/yarn/'" },
  });
  assert.equal(changed, true);
  assert.equal(text, 'Use yarn');
});

test('VISUAL takes precedence over EDITOR, matching the priority documented for P8', async () => {
  const { editText } = await import('../lib/editor.mjs');
  const { text, changed } = editText('Use pnpm', {
    env: { VISUAL: "sed -i 's/pnpm/yarn/'", EDITOR: 'false' },
  });
  assert.equal(changed, true);
  assert.equal(text, 'Use yarn');
});
