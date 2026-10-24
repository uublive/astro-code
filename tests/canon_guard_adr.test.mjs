// canon-guard's ADR rule (phase 53 t6, ADR-087): an unclaimed ADR number is refused at write time.
// The hook is a subprocess fed PreToolUse JSON, the way tests/canon_guard.test.mjs drives it.
// The parity test reaches lib/adr.mjs through a dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = join(FRAMEWORK, 'hooks', 'astro-canon-guard.mjs');

function project({ adr = true, mirror = true } = {}) {
  const S = realpathSync(mkdtempSync(join(tmpdir(), 'ac-guard-adr-')));
  const P = join(S, 'p');
  mkdirSync(join(P, '.astrocode', '.local'), { recursive: true });
  const log = ['# Decisions', ''];
  if (adr) {
    mkdirSync(join(P, 'docs', 'adr'), { recursive: true });
    for (let i = 1; i <= 10; i++) {
      const n = String(i).padStart(4, '0');
      writeFileSync(join(P, 'docs/adr', `${n}-old-${i}.md`), `# ADR-${n} — old ${i}\n`);
    }
    writeFileSync(join(P, 'docs/adr/README.md'), '# index\n');
    if (mirror) {
      const claims = Array.from({ length: 10 }, (_, i) => ({ number: i + 1 }));
      writeFileSync(join(P, '.astrocode/.local/adr-claims.json'), JSON.stringify({ version: 1, claims, backfill: null, adr_dir: 'docs/adr', width: 4, source: 'detected' }));
    }
    log.push('## ADR-0003 — old 3', '_2026-01-01_', '');
  } else {
    log.push('## ADR-001 — plain', '_2026-01-01_', '');
  }
  writeFileSync(join(P, '.astrocode/DECISIONS.md'), log.join('\n'));
  return { S, P };
}

const ENV = (S) => ({ PATH: '/usr/bin:/bin', HOME: S });
const feed = (S, event) => spawnSync(process.execPath, [HOOK], { input: JSON.stringify(event), env: ENV(S), encoding: 'utf8', timeout: 20000 });
const reason = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason; } catch { return null; } };
const denied = (r) => r.status === 0 && Boolean(reason(r));
const allowed = (r) => r.status === 0 && !r.stdout.trim() && !r.stderr.trim();
const ev = (tool, tool_input, cwd) => ({ hook_event_name: 'PreToolUse', cwd, tool_name: tool, tool_input });

test('a Write creating docs/adr/0150-x.md is denied and the reason names ac decision add', () => {
  const { S, P } = project();
  try {
    const r = feed(S, ev('Write', { file_path: join(P, 'docs/adr/0150-x.md'), content: '# x' }, P));
    assert.ok(denied(r), r.stdout);
    assert.match(reason(r), /ac decision add/);
    assert.match(reason(r), /0150/);
    assert.match(reason(r), /ADR-087/);
    // a relative path from the project works the same
    assert.ok(denied(feed(S, ev('Write', { file_path: 'docs/adr/0150-x.md', content: '# x' }, P))));
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('an Edit adding `## ADR-0150 — …` to DECISIONS.md is denied', () => {
  const { S, P } = project();
  try {
    const file = join(P, '.astrocode/DECISIONS.md');
    const r = feed(S, ev('Edit', { file_path: file, old_string: '## ADR-0003 — old 3', new_string: '## ADR-0003 — old 3\n\n## ADR-0150 — sneaky' }, P));
    assert.ok(denied(r), r.stdout);
    assert.match(reason(r), /\.astrocode\/DECISIONS\.md/);
    // MultiEdit and Write too
    assert.ok(denied(feed(S, ev('MultiEdit', { file_path: file, edits: [{ old_string: 'a', new_string: '## ADR-0150 — x' }] }, P))));
    assert.ok(denied(feed(S, ev('Write', { file_path: file, content: '# Decisions\n\n## ADR-0003 — old 3\n\n## ADR-0150 — x\n' }, P))));
    // a claimed number, a title typo on an existing heading and a D- heading are fine
    assert.ok(allowed(feed(S, ev('Edit', { file_path: file, old_string: 'a', new_string: '## ADR-0007 — claimed' }, P))));
    assert.ok(allowed(feed(S, ev('Edit', { file_path: file, old_string: '## ADR-0003 — old 3', new_string: '## ADR-0003 — old three' }, P))));
    assert.ok(allowed(feed(S, ev('Edit', { file_path: file, old_string: 'a', new_string: '## D-0150 — d series' }, P))));
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('`cat > docs/adr/0150-x.md` is denied', () => {
  const { S, P } = project();
  try {
    assert.ok(denied(feed(S, ev('Bash', { command: 'cat > docs/adr/0150-x.md <<EOF\nhi\nEOF' }, P))));
    assert.ok(allowed(feed(S, ev('Bash', { command: 'echo hi > docs/adr/README.md' }, P))));
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('a hand mv to an unclaimed number is denied', () => {
  const { S, P } = project();
  try {
    assert.ok(denied(feed(S, ev('Bash', { command: 'mv docs/adr/0010-old-10.md docs/adr/0150-old-10.md' }, P))));
    assert.ok(allowed(feed(S, ev('Bash', { command: 'mv docs/adr/0010-old-10.md docs/adr/0010-renamed.md' }, P))));
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('editing the body or title of an existing claimed ADR is allowed', () => {
  const { S, P } = project();
  try {
    const f = join(P, 'docs/adr/0004-old-4.md');
    assert.ok(allowed(feed(S, ev('Edit', { file_path: f, old_string: 'old 4', new_string: 'old four' }, P))));
    assert.ok(allowed(feed(S, ev('Write', { file_path: f, content: '# ADR-0004 — new body\n' }, P))));
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('a Write of a just-claimed number is allowed', () => {
  const { S, P } = project();
  try {
    const claims = [...Array.from({ length: 10 }, (_, i) => ({ number: i + 1 })), { number: 11 }];
    writeFileSync(join(P, '.astrocode/.local/adr-claims.json'), JSON.stringify({ version: 1, claims, backfill: null, adr_dir: 'docs/adr' }));
    assert.ok(allowed(feed(S, ev('Write', { file_path: join(P, 'docs/adr/0011-new.md'), content: '# x' }, P))));
    assert.ok(denied(feed(S, ev('Write', { file_path: join(P, 'docs/adr/0012-new.md'), content: '# x' }, P))));
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('README.md in the ADR folder is allowed', () => {
  const { S, P } = project();
  try {
    assert.ok(allowed(feed(S, ev('Write', { file_path: join(P, 'docs/adr/README.md'), content: '# x' }, P))));
    assert.ok(allowed(feed(S, ev('Write', { file_path: join(P, 'docs/adr/template.md'), content: '# x' }, P))));
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('a non-ADR project\'s DECISIONS.md heading edit is allowed', () => {
  const { S, P } = project({ adr: false });
  try {
    const file = join(P, '.astrocode/DECISIONS.md');
    assert.ok(allowed(feed(S, ev('Edit', { file_path: file, old_string: 'a', new_string: '## ADR-0150 — free' }, P))));
    assert.ok(allowed(feed(S, ev('Write', { file_path: join(P, 'docs/adr/0150-x.md'), content: '# x' }, P))));
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('an off setting makes the project non-ADR for the guard', () => {
  const { S, P } = project();
  try {
    writeFileSync(join(P, '.astrocode/config.json'), JSON.stringify({ decisions: { adr_dir: 'off' } }));
    assert.ok(allowed(feed(S, ev('Write', { file_path: join(P, 'docs/adr/0150-x.md'), content: '# x' }, P))));
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('a corrupt mirror fails open', () => {
  const { S, P } = project();
  try {
    writeFileSync(join(P, '.astrocode/.local/adr-claims.json'), '{corrupt');
    const r = feed(S, ev('Write', { file_path: join(P, 'docs/adr/0150-x.md'), content: '# x' }, P));
    assert.ok(allowed(r), r.stdout + r.stderr);
    assert.ok(allowed(feed(S, ev('Write', { file_path: join(P, 'docs/adr/0150-x.md') }, P))));
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('detection without a mirror: a lone numbered folder counts, and unclaimed numbers are refused', () => {
  const { S, P } = project({ mirror: false });
  try {
    assert.ok(denied(feed(S, ev('Write', { file_path: join(P, 'docs/adr/0150-x.md'), content: '# x' }, P))));
    // the log's own heading claims 0003
    assert.ok(allowed(feed(S, ev('Write', { file_path: join(P, 'docs/adr/0003-other.md'), content: '# x' }, P))));
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test('the deny is exactly two lines', () => {
  const { S, P } = project();
  try {
    const r = feed(S, ev('Write', { file_path: join(P, 'docs/adr/0150-x.md'), content: '# x' }, P));
    const lines = reason(r).split('\n');
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^canon-guard: docs\/adr\/0150-x\.md uses ADR number 0150, which is not claimed \(ADR-087\)\. Use: ac decision add/);
    assert.match(lines[1], /ac canon pull.*ac mods disable canon-guard/);
  } finally { rmSync(S, { recursive: true, force: true }); }
});

test("the hook's candidates and off-values equal lib/adr.mjs's", async () => {
  const lib = await import('../lib/adr.mjs');
  const hook = await import('../hooks/astro-canon-guard.mjs');
  assert.deepEqual(hook.ADR_DIR_CANDIDATES, lib.ADR_DIR_CANDIDATES);
  assert.deepEqual(hook.ADR_OFF_VALUES, lib.ADR_OFF_VALUES);
});
