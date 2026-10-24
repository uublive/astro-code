// The CLI surface of phase 53 (t12, ADR-087): decision add reporting, decision backfill, decision renumber,
// ADR rows in canon check, D- ids. Spawns bin/ac.mjs against real repos with a real bare remote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const ac = (cwd, ...args) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8' });

function project({ adr = true, dup = true, remote = true } = {}) {
  const w = mkdtempSync(join(tmpdir(), 'ac-cli-'));
  git(['init', '--quiet', '-b', 'main'], { cwd: w });
  git(['config', 'user.email', 'a@example.com'], { cwd: w });
  git(['config', 'user.name', 'a'], { cwd: w });
  git(['config', 'commit.gpgsign', 'false'], { cwd: w });
  if (remote) {
    const bare = mkdtempSync(join(tmpdir(), 'ac-origin-')) + '/origin.git';
    git(['init', '--quiet', '--bare', bare]);
    git(['remote', 'add', 'origin', bare], { cwd: w });
  }
  initPlanning(w, { name: 'cli' });
  if (adr) {
    mkdirSync(join(w, 'docs/adr'), { recursive: true });
    for (let i = 1; i <= 10; i++) {
      const n = String(i).padStart(4, '0');
      writeFileSync(join(w, 'docs/adr', `${n}-old-${i}.md`), `# ADR-${n} — old ${i}\n`);
    }
    if (dup) writeFileSync(join(w, 'docs/adr/0007-other-seven.md'), '# ADR-0007 — other seven\n');
    const log = ['# Decisions', ''];
    for (let i = 1; i <= 3; i++) log.push(`## ADR-00${i} — log ${i}`, '_2026-01-01_', '');
    writeFileSync(paths(w).decisions, log.join('\n'));
    writeFileSync(join(w, 'NOTES.md'), 'log cites ADR-002 and the folder ADR-0002.\n');
  }
  git(['add', '-A'], { cwd: w });
  git(['commit', '--quiet', '-m', 'base'], { cwd: w });
  return w;
}

test('decision add in an ADR project prints the id line, then `✓ wrote <rel> (ADR folder <dir>, detected|configured)`', () => {
  const w = project();
  const r = ac(w, 'decision', 'add', 'Use Postgres', '--why', 'fast');
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.match(lines[0], /^✓ ADR-0011 — Use Postgres \(\d{4}-\d{2}-\d{2}\) \[shared: astro-registry\]$/);
  assert.equal(lines[1], '✓ wrote docs/adr/0011-use-postgres.md (ADR folder docs/adr, detected)');
  assert.ok(existsSync(join(w, 'docs/adr/0011-use-postgres.md')));
  ac(w, 'config', 'set', 'decisions.adr_dir', 'records');
  const c = ac(w, 'decision', 'add', 'Elsewhere', '--why', 'w');
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /✓ wrote records\/0012-elsewhere\.md \(ADR folder records, configured\)/);
  ac(w, 'config', 'set', 'decisions.adr_dir', 'off');
  const off = ac(w, 'decision', 'add', 'No file', '--why', 'w');
  assert.equal(off.stdout.trim().split('\n').length, 1);
});

test('a non-ADR add prints exactly today\'s lines', () => {
  const w = project({ adr: false });
  const r = ac(w, 'decision', 'add', 'Plain', '--why', 'w');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^✓ ADR-001 — Plain \(\d{4}-\d{2}-\d{2}\) \[shared: astro-registry\]\n$/);
  assert.ok(!existsSync(join(w, 'docs')));
});

test('an unreachable registry exits non-zero naming the registry', () => {
  const w = project();
  git(['remote', 'set-url', 'origin', join(tmpdir(), 'ac-cli-gone.git')], { cwd: w });
  const before = readFileSync(paths(w).decisions, 'utf8');
  const r = ac(w, 'decision', 'add', 'Nope', '--why', 'w');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /✖ cannot reach `origin` to claim an ADR number on astro-registry/);
  assert.equal(readFileSync(paths(w).decisions, 'utf8'), before);
  assert.ok(!existsSync(join(w, 'docs/adr/0011-nope.md')));
});

test('decision backfill prints the dry-run plan and `--apply` applies it', () => {
  const w = project();
  const dry = ac(w, 'decision', 'backfill');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /^• would claim 10 existing number\(s\), relabel 3 log entr\(ies\) \(ADR-001→D-001, ADR-002→D-002, ADR-003→D-003\), rewrite 1 reference line\(s\) in 1 file\(s\) — run again with --apply$/m);
  assert.match(dry.stdout, /^  rewrite NOTES\.md \(1 line\(s\)\)$/m);
  assert.match(dry.stdout, /^✖ docs\/adr\/0007-other-seven\.md: .* → ac decision renumber docs\/adr\/0007-other-seven\.md next$/m);
  assert.match(readFileSync(paths(w).decisions, 'utf8'), /## ADR-001 — log 1/);
  const apply = ac(w, 'decision', 'backfill', '--apply');
  assert.equal(apply.status, 0, apply.stderr);
  assert.match(apply.stdout, /^✓ claimed 10 existing number\(s\)/m);
  assert.match(readFileSync(paths(w).decisions, 'utf8'), /## D-001 — log 1/);
  assert.equal(readFileSync(join(w, 'NOTES.md'), 'utf8'), 'log cites D-002 and the folder ADR-0002.\n');
  const again = ac(w, 'decision', 'backfill', '--apply');
  assert.match(again.stdout, /^• already backfilled \d{4}-\d{2}-\d{2} — nothing changed$/m);
  const none = ac(project({ adr: false }), 'decision', 'backfill');
  assert.equal(none.stdout.trim(), '• no ADR folder in this project — nothing to backfill');
});

test('decision renumber prints the changed files and the unattributed lines', () => {
  const w = project({ dup: false });
  git(['checkout', '--quiet', '-b', 'feature/x'], { cwd: w });
  writeFileSync(join(w, 'docs/adr/0042-mine.md'), '# ADR-0042 — mine\n');
  writeFileSync(join(w, 'mine.md'), 'cites ADR-0042\n');
  git(['add', '-A'], { cwd: w });
  git(['commit', '--quiet', '-m', 'mine'], { cwd: w });
  const dry = ac(w, 'decision', 'renumber', 'docs/adr/0042-mine.md', 'next', '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /^• would change mine\.md$/m);
  assert.match(dry.stdout, /\(dry run — nothing written\)$/m);
  assert.ok(existsSync(join(w, 'docs/adr/0042-mine.md')));
  const r = ac(w, 'decision', 'renumber', 'docs/adr/0042-mine.md', 'next');
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.ok(lines.includes('✓ changed docs/adr/0042-mine.md → docs/adr/0043-mine.md'));
  assert.ok(lines.includes('✓ changed mine.md'));
  assert.match(lines[lines.length - 1], /^• ADR-0042 → ADR-0043: 2 file\(s\) changed, 0 left for you, 0 other-side citation\(s\) left alone$/);
  assert.equal(readFileSync(join(w, 'mine.md'), 'utf8'), 'cites ADR-0043\n');
  const bad = ac(w, 'decision', 'renumber', 'docs/adr/0043-mine.md', '43');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /already used or claimed/);
});

test('canon check prints one `✖ <subject>: <detail> → <fix>` row per ADR finding and exits non-zero, and stays silent on ADR in a clean project', () => {
  const w = project();
  ac(w, 'decision', 'backfill', '--apply');
  const r = ac(w, 'canon', 'check');
  assert.notEqual(r.status, 0);
  const rows = r.stderr.split('\n').filter((l) => /^✖ docs\//.test(l));
  assert.equal(rows.length, 1);
  assert.match(rows[0], /^✖ docs\/adr\/0007-other-seven\.md: .* → ac decision renumber docs\/adr\/0007-other-seven\.md next$/);
  assert.match(r.stderr, /1 ADR problem\(s\)/);
  const clean = project({ dup: false });
  ac(clean, 'decision', 'backfill', '--apply');
  const ok = ac(clean, 'canon', 'check');
  assert.equal(ok.status, 0, ok.stderr);
  assert.doesNotMatch(ok.stdout + ok.stderr, /ADR/);
  assert.match(ok.stdout, /^✓ local canon matches astro-registry$/m);
  // no registry, no ADR folder: today's line
  const lone = ac(project({ adr: false, remote: false }), 'canon', 'check');
  assert.equal(lone.status, 0);
  assert.match(lone.stdout, /no shared registry in use/);
});

test('unknown flags on backfill and renumber die', () => {
  const w = project();
  for (const args of [['decision', 'backfill', '--aply'], ['decision', 'renumber', 'docs/adr/0001-old-1.md', 'next', '--dry']]) {
    const r = ac(w, ...args);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /✖/);
  }
  const usage = ac(w, 'decision', 'renumber', 'docs/adr/0001-old-1.md');
  assert.match(usage.stderr, /usage: ac decision renumber/);
});

test('decision supersede accepts a D- id', () => {
  const w = project({ adr: false, remote: false });
  writeFileSync(paths(w).decisions, '# Decisions\n\n## D-001 — Old\n_2026-01-01_\n\n## D-002 — New\n_2026-01-01_\n');
  const r = ac(w, 'decision', 'supersede', 'D-001', '--by', 'D-002', '--reason', 'newer');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ D-001 superseded by D-002/);
  assert.match(readFileSync(paths(w).decisions, 'utf8'), /superseded by D-002/);
});
