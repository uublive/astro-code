// The personal-principle commands are one prefixed family (like /astro-kit-*), so typing
// `/astro-principles` shows them together and no name reads as something else
// (`/astro-review` read as code review). No aliases: the old names shipped the same day.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cmd = (n) => join(ROOT, 'commands', `${n}.md`);

test('the principle commands are the astro-principles family, and the old names are gone', () => {
  for (const n of ['astro-principles', 'astro-principles-review', 'astro-principles-mine']) {
    assert.ok(existsSync(cmd(n)), `${n} exists`);
  }
  for (const n of ['astro-review', 'astro-mine']) assert.ok(!existsSync(cmd(n)), `${n} is gone`);
  const help = readFileSync(cmd('astro-help'), 'utf8');
  for (const n of ['/astro-principles ', '/astro-principles-review', '/astro-principles-mine']) {
    assert.ok(help.includes(n), `/astro-help lists ${n.trim()}`);
  }
});

test('/astro-principles only reads: list, show and ask — never a write verb', () => {
  const src = readFileSync(cmd('astro-principles'), 'utf8');
  const steps = src.slice(src.indexOf('## Steps'), src.indexOf('## Never'));
  for (const v of ['list', 'show', 'ask']) assert.match(steps, new RegExp(`ac principles ${v}\\b`));
  assert.doesNotMatch(steps, /ac principles (accept|reject|amend|merge|reopen|add|sight|retire|supersede|promote)\b/);
});
