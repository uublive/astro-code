// Fix 2026-11-09-executor-prompts-amend-a-missing-stamp (GitHub #180): every place that told an executor
// to repair a missing `(phase NN tK)` stamp with `git commit --amend` did so unconditionally. Where a
// post-commit hook pushes, the commit is already on the remote, and the amend rewrites a pushed commit
// (the branch diverges). Each such instruction now amends only a commit no remote has; a pushed one is
// left as it is and reported unstamped, which the heal step and the completeness audit already handle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const wf = readFileSync(join(ROOT, 'workflows', 'execute-phase.mjs'), 'utf8');
const executor = readFileSync(join(ROOT, 'agents', 'astro-executor.md'), 'utf8');

test('#180: the workflow defines one pushed-commit rule and every amend instruction carries it', () => {
  assert.match(wf, /const NO_AMEND_PUSHED =/, 'one shared rule');
  assert.match(wf, /git branch -r --contains HEAD/, 'the rule says how to tell a pushed commit');
  const amendSites = [...wf.matchAll(/amend/gi)].length;
  assert.ok(amendSites > 0);
  // the self-check, the batch stamp check and the audit note each interpolate the rule
  for (const anchor of [/const stampSelfCheck[\s\S]{0,600}?\$\{NO_AMEND_PUSHED\}/, /AMEND that commit to add the stamp[\s\S]{0,300}?\$\{NO_AMEND_PUSHED\}/, /amend the stamp[\s\S]{0,200}?\$\{NO_AMEND_PUSHED/]) {
    assert.match(wf, anchor);
  }
});

test('#180: the executor agent never amends a pushed commit', () => {
  assert.match(executor, /git branch -r --contains HEAD/);
  assert.match(executor, /never (?:amend|rewrite)[\s\S]{0,120}?push/i);
});
