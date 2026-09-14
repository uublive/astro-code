// The managed AGENTS.md block: how astro-code explains itself to any agent on
// any host.
//
// This matters most OFF Claude Code. Claude gets continuous ambient context — a
// SessionStart banner, PreCompact re-injection, the status line. Codex gets
// none of that, because its hooks need a per-hook trusted_hash astro-code will
// not forge. There, a static file read at session start is the only mechanism.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { merge, writeAgentsMd, BEGIN, END } from '../lib/agentsmd.mjs';

const BODY = 'managed content';

test('an empty or missing file gets a heading and the block', () => {
  const out = merge('', BODY);
  assert.match(out, /^# Agent Instructions/);
  assert.ok(out.includes(BEGIN) && out.includes(END));
  assert.ok(out.includes(BODY));
});

test('an existing file keeps everything the user wrote', () => {
  const mine = '# My Rules\n\nAlways use tabs.\n';
  const out = merge(mine, BODY);
  assert.ok(out.startsWith('# My Rules'), 'their heading stays first');
  assert.ok(out.includes('Always use tabs.'), 'their content is preserved verbatim');
  assert.ok(out.includes(BODY), 'and ours is appended');
});

test('re-running replaces ONLY the managed region', () => {
  // The whole point of the markers: astro-code owns what is between them and
  // nothing else, so an upgrade can never eat a user's instructions.
  const first = merge('# Mine\n\nkeep me\n', 'version one');
  const second = merge(first, 'version two');
  assert.ok(second.includes('keep me'), 'user content survives an upgrade');
  assert.ok(second.includes('version two'));
  assert.ok(!second.includes('version one'), 'the old block is gone, not duplicated');
  assert.equal(second.split(BEGIN).length - 1, 1, 'exactly one managed block');
});

test('content before AND after the block is preserved', () => {
  const src = `before\n\n${BEGIN}\nold\n${END}\n\nafter\n`;
  const out = merge(src, 'new');
  assert.ok(out.includes('before') && out.includes('after'));
  assert.ok(out.includes('new') && !out.includes('old'));
});

test('writeAgentsMd creates AGENTS.md and mirrors into an EXISTING CLAUDE.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'ac-agentsmd-'));
  // no CLAUDE.md yet — it must not be invented
  let written = writeAgentsMd(root, { body: BODY });
  assert.deepEqual(written, ['AGENTS.md']);
  assert.ok(existsSync(join(root, 'AGENTS.md')));
  assert.ok(!existsSync(join(root, 'CLAUDE.md')),
    'a project without CLAUDE.md has not opted in — inventing one is not our call');

  // once the user has one, keep it in sync: Claude Code reads it for this job
  writeFileSync(join(root, 'CLAUDE.md'), '# Claude rules\n');
  written = writeAgentsMd(root, { body: BODY });
  assert.ok(written.includes('CLAUDE.md'));
  const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
  assert.ok(claude.includes('# Claude rules'), 'their content survives');
  assert.ok(claude.includes(BODY));
});

test('a second identical run writes nothing', () => {
  const root = mkdtempSync(join(tmpdir(), 'ac-agentsmd-idem-'));
  assert.deepEqual(writeAgentsMd(root, { body: BODY }), ['AGENTS.md']);
  assert.deepEqual(writeAgentsMd(root, { body: BODY }), [], 'idempotent — no needless churn');
});

test('the shipped block explains the loop and both invocation styles', () => {
  const root = mkdtempSync(join(tmpdir(), 'ac-agentsmd-real-'));
  writeAgentsMd(root);                       // the real template, not a stub
  const text = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.match(text, /ac status/, 'points at live state rather than baking it in');
  assert.ok(!/Milestone \d|Phase \d\d/.test(text),
    'no baked-in milestone/phase numbers — they would be stale within a day');
  assert.match(text, /\/astro-status/, 'Claude Code invocation');
  assert.match(text, /\$astro-status/, 'Codex invocation');
  assert.match(text, /no.{0,3} custom slash commands/i, 'the Codex gotcha is stated outright');
  assert.match(text, /verified/, 'the verified-vs-complete distinction');
});
