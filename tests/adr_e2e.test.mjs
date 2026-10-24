// End-to-end Astrobot scenario through the CLI and the guard hook (phase 53 t14, ADR-087). Test-after:
// drives only `node bin/ac.mjs` and the hook script against one scratch fixture, in the CRITERIA order.
// The steps share the fixture and so run in order; fixture BUILDING uses the library, behaviour never does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, cpSync, realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(ROOT, 'bin', 'ac.mjs');
const HOOK = join(ROOT, 'hooks', 'astro-canon-guard.mjs');
const ENV = { ...process.env, ASTRO_PRINCIPLES_DIR: mkdtempSync(join(tmpdir(), 'ac-e2e-pr-')) };
const ac = (cwd, ...args) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8', env: ENV });
const acAsync = (cwd, ...args) => new Promise((resolve) => {
  const c = spawn(process.execPath, [AC, ...args], { cwd, env: ENV });
  let out = '';
  c.stdout.on('data', (d) => (out += d));
  c.stderr.on('data', (d) => (out += d));
  c.on('close', (code) => resolve({ code, out }));
});
const guard = (cwd, tool_name, tool_input) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({ hook_event_name: 'PreToolUse', cwd, tool_name, tool_input }),
  env: { PATH: '/usr/bin:/bin', HOME: cwd }, encoding: 'utf8',
});
const denied = (r) => /"permissionDecision":"deny"/.test(r.stdout);
const read = (w, rel) => readFileSync(join(w, rel), 'utf8');
const put = (w, rel, text) => { mkdirSync(dirname(join(w, rel)), { recursive: true }); writeFileSync(join(w, rel), text); };
const commitAll = (w, msg) => { git(['add', '-A'], { cwd: w }); const r = git(['commit', '--quiet', '-m', msg], { cwd: w }); assert.equal(r.status, 0, r.stdout + r.stderr); };
const cfg = (w, name) => {
  git(['config', 'user.email', `${name}@example.com`], { cwd: w });
  git(['config', 'user.name', name], { cwd: w });
  git(['config', 'commit.gpgsign', 'false'], { cwd: w });
};
const tip = (w) => git(['ls-remote', 'origin', 'refs/heads/astro-registry'], { cwd: w }).stdout;
const porcelain = (w) => git(['status', '--porcelain', '-uall'], { cwd: w }).stdout;

const W = {};

test('1. the pre-phase project: backfill dry run, then --apply (C5)', () => {
  const bare = mkdtempSync(join(tmpdir(), 'ac-e2e-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  const alice = realpathSync(mkdtempSync(join(tmpdir(), 'ac-e2e-alice-')));
  git(['init', '--quiet', '-b', 'main'], { cwd: alice });
  cfg(alice, 'alice');
  git(['remote', 'add', 'origin', bare], { cwd: alice });
  initPlanning(alice, { name: 'astrobot' });
  const titles = ['one', 'two', 'three thing', 'four', 'five', 'six', 'seven a', 'eight', 'nine', 'ten'];
  titles.forEach((t, i) => put(alice, `docs/adr/${String(i + 1).padStart(4, '0')}-${t.replace(/ /g, '-')}.md`, `# ADR-${String(i + 1).padStart(4, '0')} — ${t}\n`));
  put(alice, 'docs/adr/0007-seven-b.md', '# ADR-0007 — seven b\n');
  const log = ['# Decisions', ''];
  for (let i = 1; i <= 6; i++) log.push(`## ADR-00${i} — ${i === 3 ? 'three thing' : `log entry ${i}`}`, '_2026-01-01_', '');
  writeFileSync(paths(alice).decisions, log.join('\n'));
  put(alice, 'docs/notes.md', 'The log decided ADR-002; the folder file is ADR-0002.\n');
  commitAll(alice, 'pre-phase project');
  git(['push', '--quiet', 'origin', 'main'], { cwd: alice });
  const bob = realpathSync(mkdtempSync(join(tmpdir(), 'ac-e2e-bob-')));
  git(['clone', '--quiet', '-b', 'main', bare, bob]);
  cfg(bob, 'bob');
  assert.equal(ac(alice, 'registry', 'init').status, 0);
  Object.assign(W, { bare, alice, bob });

  const before = porcelain(alice);
  const dry = ac(alice, 'decision', 'backfill');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /would claim 10 existing number/);
  assert.match(dry.stdout, /docs\/adr\/0007-seven-b\.md: .*renumber docs\/adr\/0007-seven-b\.md next/);
  assert.equal(porcelain(alice), before);

  const apply = ac(alice, 'decision', 'backfill', '--apply');
  assert.equal(apply.status, 0, apply.stderr);
  assert.match(read(alice, '.astrocode/DECISIONS.md'), /^## D-001 — log entry 1$/m);
  assert.match(read(alice, '.astrocode/DECISIONS.md'), /^## ADR-0003 — three thing$/m);
  assert.equal(read(alice, 'docs/notes.md'), 'The log decided D-002; the folder file is ADR-0002.\n');
  assert.equal(readdirSync(join(alice, 'docs/adr')).length, 11);
  const treeBefore = porcelain(alice) + tip(alice);
  assert.match(ac(alice, 'decision', 'backfill', '--apply').stdout, /already backfilled/);
  assert.equal(porcelain(alice) + tip(alice), treeBefore);
  commitAll(alice, 'backfilled');
  git(['push', '--quiet', 'origin', 'main'], { cwd: alice });
  git(['pull', '--quiet', '--ff-only', 'origin', 'main'], { cwd: bob });
});

test('2. concurrent adds from both clones never collide (C1)', async () => {
  const { alice, bob } = W;
  git(['checkout', '--quiet', '-b', 'feature/alice'], { cwd: alice });
  git(['checkout', '--quiet', '-b', 'feature/bob'], { cwd: bob });
  const [a, b] = await Promise.all([
    acAsync(alice, 'decision', 'add', 'Alice choice', '--why', 'a'),
    acAsync(bob, 'decision', 'add', 'Bob choice', '--why', 'b'),
  ]);
  assert.equal(a.code, 0, a.out);
  assert.equal(b.code, 0, b.out);
  const mine = (w) => readdirSync(join(w, 'docs/adr')).filter((f) => /choice/.test(f));
  assert.equal(mine(alice).length, 1);
  assert.equal(mine(bob).length, 1);
  const na = Number(mine(alice)[0].slice(0, 4));
  const nb = Number(mine(bob)[0].slice(0, 4));
  assert.ok(na >= 11 && nb >= 11 && na !== nb, `${na} vs ${nb}`);
  assert.match(read(alice, '.astrocode/DECISIONS.md'), new RegExp(`^## ADR-${String(na).padStart(4, '0')} — Alice choice$`, 'm'));
  assert.match(read(bob, '.astrocode/DECISIONS.md'), new RegExp(`^## ADR-${String(nb).padStart(4, '0')} — Bob choice$`, 'm'));
  W.claimed = na;
});

test('3. the guard denies 0150 and allows a claimed edit (C3)', () => {
  const { alice } = W;
  const hit = guard(alice, 'Write', { file_path: join(alice, 'docs/adr/0150-x.md'), content: '# x' });
  assert.ok(denied(hit), hit.stdout);
  assert.match(hit.stdout, /ac decision add/);
  assert.ok(denied(guard(alice, 'Bash', { command: 'cat > docs/adr/0150-x.md' })));
  assert.ok(denied(guard(alice, 'Edit', { file_path: join(alice, '.astrocode/DECISIONS.md'), old_string: 'a', new_string: '## ADR-0150 — x' })));
  const claimedFile = readdirSync(join(alice, 'docs/adr')).find((f) => /choice/.test(f));
  assert.ok(!denied(guard(alice, 'Edit', { file_path: join(alice, 'docs/adr', claimedFile), old_string: 'Alice', new_string: 'Alice!' })));
  assert.ok(!denied(guard(alice, 'Write', { file_path: join(alice, `docs/adr/${String(W.claimed + 0).padStart(4, '0')}-another.md`), content: '# x' })));
});

test('4. seeded problems appear in canon check and doctor --json, and nothing is written (C4)', () => {
  const { alice } = W;
  put(alice, 'docs/adr/0150-stray.md', '# ADR-0150 — stray\n'); // bypassing the guard
  put(alice, 'docs/adr/0011-clash-a.md', '# ADR-0011 — clash a\n');
  writeFileSync(paths(alice).decisions, read(alice, '.astrocode/DECISIONS.md').replace('## ADR-0003 — three thing', '## ADR-0003 — three renamed') + '\n## ADR-045 — old series entry\n_2026-01-01_\n');
  const state = () => porcelain(alice) + tip(alice);
  const before = state();
  const check = ac(alice, 'canon', 'check');
  assert.notEqual(check.status, 0);
  for (const re of [/✖ docs\/adr\/0150-stray\.md: .* → ac decision renumber docs\/adr\/0150-stray\.md next/, /✖ docs\/adr\/0007-seven-b\.md: .*0007/, /✖ ADR-045: .* → ac decision renumber ADR-045 next/, /✖ docs\/adr\/0003-three-thing\.md: .* → ac decision renumber/]) {
    assert.match(check.stderr, re);
  }
  const home = mkdtempSync(join(tmpdir(), 'ac-e2e-home-'));
  mkdirSync(join(home, '.astro', 'code'), { recursive: true });
  const doc = spawnSync(process.execPath, [AC, 'doctor', '--json'], { cwd: alice, encoding: 'utf8', env: { ...ENV, HOME: home } });
  assert.equal(doc.status, 1);
  const rows = JSON.parse(doc.stdout);
  const adr = rows.filter((r) => r.id === 'adr' && !r.ok);
  assert.ok(adr.length >= 4, JSON.stringify(adr));
  assert.ok(rows.filter((r) => !r.ok).every((r) => typeof r.fix === 'string' && r.fix));
  for (const kind of ['unclaimed', 'duplicate', 'old-series', 'mismatch']) assert.ok(adr.some((r) => r.detail.includes(`ADR ${kind}`)), kind);
  assert.equal(state(), before);
  // seeds removed: clean again
  git(['checkout', '--quiet', '--', '.astrocode/DECISIONS.md'], { cwd: alice });
  for (const f of ['docs/adr/0150-stray.md', 'docs/adr/0011-clash-a.md']) git(['clean', '-fq', '--', f], { cwd: alice });
});

test('5. a collision, then renumber (C6)', () => {
  const bare = mkdtempSync(join(tmpdir(), 'ac-e2e-origin2-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  const a = realpathSync(mkdtempSync(join(tmpdir(), 'ac-e2e-c-alice-')));
  git(['init', '--quiet', '-b', 'main'], { cwd: a });
  cfg(a, 'alice');
  git(['remote', 'add', 'origin', bare], { cwd: a });
  initPlanning(a, { name: 'collide' });
  for (let i = 1; i <= 10; i++) put(a, `docs/adr/${String(i).padStart(4, '0')}-old-${i}.md`, `# ADR-${String(i).padStart(4, '0')} — old ${i}\n`);
  commitAll(a, 'base');
  git(['push', '--quiet', 'origin', 'main'], { cwd: a });
  const b = realpathSync(mkdtempSync(join(tmpdir(), 'ac-e2e-c-bob-')));
  git(['clone', '--quiet', '-b', 'main', bare, b]);
  cfg(b, 'bob');
  for (const [w, who] of [[a, 'alice'], [b, 'bob']]) {
    git(['checkout', '--quiet', '-b', `feature/${who}`], { cwd: w });
    put(w, `docs/adr/0042-${who}-thing.md`, `# ADR-0042 — ${who} thing\n`);
    put(w, `docs/${who}.md`, `${who} cites ADR-0042\n`);
    commitAll(w, `${who} 0042`);
    git(['push', '--quiet', 'origin', `feature/${who}`], { cwd: w });
  }
  const m = realpathSync(mkdtempSync(join(tmpdir(), 'ac-e2e-c-merge-')));
  git(['clone', '--quiet', '-b', 'main', bare, m]);
  cfg(m, 'merger');
  for (const who of ['alice', 'bob']) assert.equal(git(['merge', '--quiet', '--no-ff', '--no-edit', `origin/feature/${who}`], { cwd: m }).status, 0);
  put(m, 'docs/later.md', 'later cites ADR-0042\n');
  commitAll(m, 'later');
  const bad = ac(m, 'decision', 'renumber', 'docs/adr/0042-bob-thing.md', '0042');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /already used or claimed/);
  const r = ac(m, 'decision', 'renumber', 'docs/adr/0042-bob-thing.md', 'next');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ changed docs\/adr\/0042-bob-thing\.md → docs\/adr\/0043-bob-thing\.md/);
  assert.match(r.stdout, /⚠ docs\/later\.md:1 cites ADR-0042/);
  assert.equal(read(m, 'docs/bob.md'), 'bob cites ADR-0043\n');
  assert.equal(read(m, 'docs/alice.md'), 'alice cites ADR-0042\n');
  assert.equal(read(m, 'docs/later.md'), 'later cites ADR-0042\n');
  const next = ac(a, 'decision', 'add', 'After renumber', '--why', 'w');
  assert.match(next.stdout, /ADR-0044/);
});

test('6. an unreachable registry refuses the claim (C7)', () => {
  const { alice } = W;
  git(['remote', 'set-url', 'origin', join(tmpdir(), 'ac-e2e-gone.git')], { cwd: alice });
  const before = porcelain(alice);
  const r = ac(alice, 'decision', 'add', 'x', '--why', 'y');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /registry|reach/);
  assert.equal(porcelain(alice), before);
  git(['remote', 'set-url', 'origin', W.bare], { cwd: alice });
});

test('7. a copy of this repo\'s .astrocode/ is untouched by backfill and canon check (C9)', () => {
  const p = realpathSync(mkdtempSync(join(tmpdir(), 'ac-e2e-self-')));
  git(['init', '--quiet', '-b', 'main'], { cwd: p });
  cfg(p, 'self');
  mkdirSync(join(p, '.astrocode'), { recursive: true });
  for (const f of ['DECISIONS.md', 'CONVENTIONS.md', 'config.json', 'state.json', 'roadmap.json']) cpSync(join(ROOT, '.astrocode', f), join(p, '.astrocode', f));
  const before = read(p, '.astrocode/DECISIONS.md');
  const bf = ac(p, 'decision', 'backfill', '--apply');
  assert.equal(bf.status, 0, bf.stderr);
  assert.match(bf.stdout, /no ADR folder/);
  assert.equal(read(p, '.astrocode/DECISIONS.md'), before);
  assert.ok(!/^## D-\d+/m.test(read(p, '.astrocode/DECISIONS.md')));
  const chk = ac(p, 'canon', 'check');
  assert.equal(chk.status, 0, chk.stderr);
  assert.doesNotMatch(chk.stdout + chk.stderr, /ADR (unclaimed|duplicate|old-series|mismatch)|✖/);
  assert.equal(read(p, '.astrocode/DECISIONS.md'), before);
});
