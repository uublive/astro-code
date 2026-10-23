// Fix 2026-10-23-canon-pull-silently-deletes-hand: a hand-written paragraph in DECISIONS.md that is
// not inside an ADR block was dropped by `canon pull`, which still reported plain success.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';
import { addDecision, canonPull, canonPush } from '../lib/canon.mjs';

function mkBareRemote() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  return bare;
}
function mkWorkdir(bare, name) {
  const dir = mkdtempSync(join(tmpdir(), `ac-work-${name}-`));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', `${name}@example.com`], { cwd: dir });
  git(['config', 'user.name', name], { cwd: dir });
  git(['remote', 'add', 'origin', bare], { cwd: dir });
  initPlanning(dir, { name: `proj-${name}` });
  return dir;
}

const NOTE = 'Team note: we review every ADR at the Monday sync before it is applied.';

for (const [where, place] of [
  ['before the first ADR (preamble)', (text) => text.replace(/^## ADR-/m, `${NOTE}\n\n## ADR-`)],
  ['under a non-ADR heading at the end', (text) => `${text.trimEnd()}\n\n## Notes\n\n${NOTE}\n`],
]) {
  test(`a hand-written paragraph ${where} is never dropped silently by canon pull`, async () => {
    const bare = mkBareRemote();
    const alice = mkWorkdir(bare, 'alice');
    const bob = mkWorkdir(bare, 'bob');
    await addDecision(alice, { title: 'Use worktrees', why: 'isolated trees', date: '2026-09-10' });
    assert.equal(canonPush(alice).ok, true);
    assert.equal(canonPull(bob).ok, true);
    writeFileSync(paths(bob).decisions, place(readFileSync(paths(bob).decisions, 'utf8')));

    const pull = canonPull(bob);
    const after = readFileSync(paths(bob).decisions, 'utf8');
    const kept = after.includes(NOTE);
    const named = (pull.discarded ?? []).some((d) => d.includes(NOTE));
    assert.ok(kept || named, 'the paragraph is either kept or reported as discarded — never lost silently');
    if (!kept) {
      assert.ok(pull.discardedFile && readFileSync(pull.discardedFile, 'utf8').includes(NOTE), 'a discarded paragraph is saved where the user can get it back');
    }
  });
}

test('CLI: a pull that removes a preamble paragraph warns, quotes it and names the saved file', async () => {
  const { spawnSync } = await import('node:child_process');
  const AC = new URL('../bin/ac.mjs', import.meta.url).pathname;
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');
  await addDecision(alice, { title: 'Use worktrees', why: 'isolated trees', date: '2026-09-10' });
  assert.equal(canonPush(alice).ok, true);
  assert.equal(canonPull(bob).ok, true);
  writeFileSync(paths(bob).decisions, readFileSync(paths(bob).decisions, 'utf8').replace(/^## ADR-/m, `${NOTE}\n\n## ADR-`));
  const r = spawnSync(process.execPath, [AC, 'canon', 'pull'], { cwd: bob, encoding: 'utf8' });
  assert.match(r.stderr, /removed 1 paragraph\(s\) before the first ADR in DECISIONS\.md .*"Team note: we review every ADR/);
  const saved = /saved to (\S+)/.exec(r.stderr)?.[1];
  assert.ok(saved && readFileSync(join(bob, saved), 'utf8').includes(NOTE));
  assert.equal(git(['check-ignore', '-q', saved], { cwd: bob }).status, 0, 'the saved file is local, never committed');
});
