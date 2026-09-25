// The `$EDITOR` round trip behind `accept --edit` / `amend --edit` (P8, phase 22).
//
// Isolated on purpose: this is the ONLY TTY-dependent piece of the principle-review
// surface (everything else in `lib/` is pure or filesystem-only). Keeping the
// subprocess + temp-file plumbing in one small module means every other engine
// module stays trivially testable, and tests here inject `EDITOR` with a
// non-interactive script (`sed -i`, `true`, `false`) instead of ever touching a real
// terminal — the same trick git's own test suite uses for `GIT_EDITOR`.
//
// `"$1"` is quoted, not the value substituted directly: an `EDITOR` that itself
// carries arguments (`sed -i 's/…/…/'`) must work exactly like git's `core.editor`
// does — the shell splits the editor string on its own words, then appends the temp
// path as one final, correctly-quoted argument, so a path containing a space is never
// torn apart by the shell that launches the editor.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COMMENT_BLOCK =
  "\n# Lines starting with '#' are stripped.\n" +
  '# Save and exit to continue; leaving the text unchanged cancels.\n' +
  '# Exiting the editor with a non-zero status also cancels — nothing is written.\n';

/**
 * Round-trip `initial` through the user's editor and return what came back.
 *
 * @param {string} initial   the text to seed the temp file with (the caller already
 *   assembled it — e.g. `${statement}\n\n${why}\n` for `accept --edit`; this module
 *   has no opinion on that shape, it only diffs before/after).
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 * @returns {{ text: string, changed: boolean }}
 */
export function editText(initial, { env = process.env } = {}) {
  const editor = env.VISUAL || env.EDITOR || 'vi';
  const dir = mkdtempSync(join(tmpdir(), 'ac-edit-'));
  const file = join(dir, 'EDITMSG');
  try {
    writeFileSync(file, `${initial}${COMMENT_BLOCK}`);
    // Windows has no `/bin/sh` — fall back to the shell running the string directly,
    // matching how `child_process` documents launching a shell command there.
    const res =
      process.platform === 'win32'
        ? spawnSync(`${editor} "${file}"`, { shell: true, stdio: 'inherit' })
        : spawnSync('/bin/sh', ['-c', `${editor} "$1"`, 'ac-edit', file], { stdio: 'inherit' });
    const status = res.status ?? 1;
    if (status !== 0) throw new Error(`editor exited ${status} — nothing changed`);
    const raw = readFileSync(file, 'utf8');
    const text = raw
      .split('\n')
      .filter((line) => !line.startsWith('#'))
      .join('\n')
      .trim();
    return { text, changed: text !== initial.trim() };
  } finally {
    // Always cleaned up, including on the throw above — a failed/cancelled edit must
    // never leave a stray `ac-edit-*` directory behind under the OS tmpdir.
    rmSync(dir, { recursive: true, force: true });
  }
}
