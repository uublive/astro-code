// lib/adrrenumber.mjs: move one decision, rewrite only its own branch's references (phase 53 t11, ADR-087).
// Real bare remote plus clones with real merges; dynamic import of the new module (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';

const renum = () => import('../lib/adrrenumber.mjs');
const canon = () => import('../lib/canon.mjs');

const mkBare = () => {
  const bare = mkdtempSync(join(tmpdir(), 'ac-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  return bare;
};
const cfg = (w, name) => {
  git(['config', 'user.email', `${name}@example.com`], { cwd: w });
  git(['config', 'user.name', name], { cwd: w });
  git(['config', 'commit.gpgsign', 'false'], { cwd: w });
};
const commitAll = (w, msg) => { git(['add', '-A'], { cwd: w }); const r = git(['commit', '--quiet', '-m', msg], { cwd: w }); assert.equal(r.status, 0, r.stdout + r.stderr); };
const put = (w, rel, text) => { mkdirSync(join(w, rel, '..'), { recursive: true }); writeFileSync(join(w, rel), text); };
const read = (w, rel) => readFileSync(join(w, rel), 'utf8');
const entry = (id, title) => `\n## ${id} — ${title}\n_2026-01-01_\n\n**Why:** see ${id}\n`;
const UNION = '.astrocode/DECISIONS.md merge=union\n.astrocode/DECISIONS.in-force.md merge=union\n';

function base() {
  const bare = mkBare();
  const alice = mkdtempSync(join(tmpdir(), 'ac-rn-alice-'));
  git(['init', '--quiet', '-b', 'main'], { cwd: alice });
  cfg(alice, 'alice');
  git(['remote', 'add', 'origin', bare], { cwd: alice });
  initPlanning(alice, { name: 'rn' });
  mkdirSync(join(alice, 'docs/adr'), { recursive: true });
  for (let i = 1; i <= 10; i++) {
    const n = String(i).padStart(4, '0');
    put(alice, `docs/adr/${n}-old-${i}.md`, `# ADR-${n} — old ${i}\n`);
  }
  commitAll(alice, 'base');
  git(['push', '--quiet', 'origin', 'main'], { cwd: alice });
  return { bare, alice };
}

// alice and bob each add a DIFFERENT 0042 on their own branch, with citations of their own; both are
// merged into main; one more citation is committed on main afterwards.
function collision() {
  const { bare, alice } = base();
  const bob = mkdtempSync(join(tmpdir(), 'ac-rn-bob-'));
  git(['clone', '--quiet', '-b', 'main', bare, bob]);
  cfg(bob, 'bob');
  for (const [w, who] of [[alice, 'alice'], [bob, 'bob']]) {
    git(['checkout', '--quiet', '-b', `feature/${who}`], { cwd: w });
    put(w, `docs/adr/0042-${who}-thing.md`, `# ADR-0042 — ${who} thing\n\nOwn reference: ADR-0042.\n`);
    put(w, `docs/${who}.md`, `# ${who}\n${who} cites ADR-0042 here.\nSee docs/adr/0042-${who}-thing.md too.\n`);
    const log = paths(w).decisions;
    writeFileSync(log, read(w, '.astrocode/DECISIONS.md') + entry('ADR-0042', `${who} thing`));
    commitAll(w, `${who} adds 0042`);
    git(['push', '--quiet', 'origin', `feature/${who}`], { cwd: w });
  }
  const merged = mkdtempSync(join(tmpdir(), 'ac-rn-merged-'));
  git(['clone', '--quiet', '-b', 'main', bare, merged]);
  cfg(merged, 'merger');
  writeFileSync(join(merged, '.git/info/attributes'), UNION);
  for (const who of ['alice', 'bob']) {
    const m = git(['merge', '--quiet', '--no-ff', '--no-edit', `origin/feature/${who}`], { cwd: merged });
    assert.equal(m.status, 0, m.stdout + m.stderr);
  }
  put(merged, 'docs/later.md', 'later cites ADR-0042 after the merge.\n');
  commitAll(merged, 'later citation');
  return { bare, alice, bob, merged };
}
const snap = (w) => git(['status', '--porcelain', '-uall'], { cwd: w }).stdout + git(['rev-parse', 'HEAD'], { cwd: w }).stdout
  + [...readdirSync(join(w, 'docs'))].join(',') + read(w, '.astrocode/DECISIONS.md');

test('renumbering bob\'s file moves the file, its heading and its DECISIONS entry to one new claimed number', async () => {
  const { renumberDecision } = await renum();
  const { merged } = collision();
  const r = await renumberDecision(merged, 'docs/adr/0042-bob-thing.md', 'next');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.from, r.to, r.toId], [42, 43, 'ADR-0043']);
  assert.ok(!existsSync(join(merged, 'docs/adr/0042-bob-thing.md')));
  assert.match(read(merged, 'docs/adr/0043-bob-thing.md'), /^# ADR-0043 — bob thing\n\nOwn reference: ADR-0043\./);
  const log = read(merged, '.astrocode/DECISIONS.md');
  assert.match(log, /^## ADR-0043 — bob thing$/m);
  assert.match(log, /^## ADR-0042 — alice thing$/m);
  assert.ok(!/^## ADR-0042 — bob thing$/m.test(log));
  assert.match(read(merged, '.astrocode/DECISIONS.in-force.md'), /## ADR-0043 — bob thing/);
  // alice's decision is untouched
  assert.match(read(merged, 'docs/adr/0042-alice-thing.md'), /^# ADR-0042 — alice thing/);
});

test('every citation bob\'s branch added names the new number, and alice\'s still read 0042', async () => {
  const { renumberDecision } = await renum();
  const { merged } = collision();
  const r = await renumberDecision(merged, 'docs/adr/0042-bob-thing.md', 'next');
  assert.equal(read(merged, 'docs/bob.md'), '# bob\nbob cites ADR-0043 here.\nSee docs/adr/0043-bob-thing.md too.\n');
  assert.equal(read(merged, 'docs/alice.md'), '# alice\nalice cites ADR-0042 here.\nSee docs/adr/0042-alice-thing.md too.\n');
  assert.ok(r.otherSide >= 1);
});

test('the post-merge citation is untouched and listed', async () => {
  const { renumberDecision } = await renum();
  const { merged } = collision();
  const r = await renumberDecision(merged, 'docs/adr/0042-bob-thing.md', 'next');
  assert.equal(read(merged, 'docs/later.md'), 'later cites ADR-0042 after the merge.\n');
  assert.deepEqual(r.unattributed, [{ file: 'docs/later.md', line: 1 }]);
});

test('every changed file is listed', async () => {
  const { renumberDecision } = await renum();
  const { merged } = collision();
  const before = git(['status', '--porcelain', '-uall'], { cwd: merged }).stdout;
  assert.equal(before, '');
  const r = await renumberDecision(merged, 'docs/adr/0042-bob-thing.md', 'next');
  const dirty = git(['status', '--porcelain', '-uall'], { cwd: merged }).stdout.split('\n').filter(Boolean)
    .map((l) => l.slice(3)).filter((f) => !f.startsWith('.astrocode/.local'));
  const listed = r.changed.flatMap((c) => c.split(' → '));
  for (const f of dirty) {
    // a renamed file shows as its old and new path
    const plain = f.includes(' -> ') ? f.split(' -> ') : [f];
    for (const x of plain) assert.ok(listed.includes(x) || x === '.astrocode/DECISIONS.in-force.md', `${x} changed but is not listed: ${JSON.stringify(r.changed)}`);
  }
  assert.ok(r.changed.includes('docs/adr/0042-bob-thing.md → docs/adr/0043-bob-thing.md'));
  assert.ok(r.changed.includes('docs/bob.md'));
  assert.ok(r.changed.includes('.astrocode/DECISIONS.md'));
});

test('the other clone\'s next add skips the new number', async () => {
  const { renumberDecision } = await renum();
  const { addDecision } = await canon();
  const { alice, merged } = collision();
  await renumberDecision(merged, 'docs/adr/0042-bob-thing.md', 'next');
  const a = await addDecision(alice, { title: 'Alice after', why: 'w' });
  assert.equal(a.id, 'ADR-0044');
});

test('an explicit number already used or claimed is refused with nothing changed', async () => {
  const { renumberDecision } = await renum();
  const { merged } = collision();
  const before = snap(merged);
  const used = await renumberDecision(merged, 'docs/adr/0042-bob-thing.md', 42);
  assert.equal(used.ok, false);
  assert.match(used.error, /already used or claimed/);
  assert.equal(snap(merged), before);
  const ok = await renumberDecision(merged, 'docs/adr/0042-bob-thing.md', 60);
  assert.equal(ok.ok, true);
  assert.ok(existsSync(join(merged, 'docs/adr/0060-bob-thing.md')));
  const claimed = await renumberDecision(merged, 'docs/adr/0042-alice-thing.md', 60);
  assert.equal(claimed.ok, false);
  assert.match(claimed.error, /already used or claimed/);
});

test('an id carried by two files is refused as ambiguous', async () => {
  const { renumberDecision } = await renum();
  const { merged } = collision();
  const before = snap(merged);
  const r = await renumberDecision(merged, 'ADR-0042', 'next');
  assert.equal(r.ok, false);
  assert.equal(r.refused, 'ambiguous');
  assert.match(r.error, /ambiguous, name the file/);
  assert.equal(snap(merged), before);
});

test('renumber ADR-045 next moves a DECISIONS-only heading', async () => {
  const { renumberDecision } = await renum();
  const { alice } = base();
  writeFileSync(paths(alice).decisions, read(alice, '.astrocode/DECISIONS.md') + entry('ADR-045', 'Old series') + entry('ADR-046', 'Other'));
  put(alice, 'docs/cite.md', 'cites ADR-045 and ADR-046.\n');
  commitAll(alice, 'old series');
  git(['checkout', '--quiet', '-b', 'feature/x'], { cwd: alice });
  const r = await renumberDecision(alice, 'ADR-045', 'next');
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([r.from, r.to], [45, 47]);
  const log = read(alice, '.astrocode/DECISIONS.md');
  assert.match(log, /^## ADR-0047 — Old series$/m);
  assert.match(log, /^## ADR-046 — Other$/m);
  assert.ok(existsSync(join(alice, 'docs/adr/0010-old-10.md')));
  // the citation was added on main, not on this branch: listed, not guessed
  assert.equal(read(alice, 'docs/cite.md'), 'cites ADR-045 and ADR-046.\n');
  assert.deepEqual(r.unattributed, [{ file: 'docs/cite.md', line: 1 }]);
});

test('on an unmerged feature branch its own uncommitted citation lines are rewritten', async () => {
  const { renumberDecision } = await renum();
  const { alice } = base();
  put(alice, 'docs/adr/0010-clash.md', '# ADR-0010 — clash\n');
  git(['rm', '--quiet', '-f', 'docs/adr/0010-old-10.md'], { cwd: alice });
  commitAll(alice, 'main has 0010 clash');
  git(['push', '--quiet', 'origin', 'main'], { cwd: alice });
  git(['checkout', '--quiet', '-b', 'feature/own'], { cwd: alice });
  put(alice, 'docs/adr/0011-mine.md', '# ADR-0011 — mine\n');
  put(alice, 'docs/committed.md', 'committed cites ADR-0011.\n');
  commitAll(alice, 'mine');
  writeFileSync(join(alice, 'docs/committed.md'), 'committed cites ADR-0011.\nuncommitted cites ADR-0011.\n');
  put(alice, 'docs/untracked.md', 'untracked cites ADR-0011.\n');
  const r = await renumberDecision(alice, 'docs/adr/0011-mine.md', 'next');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.to, 12);
  assert.equal(read(alice, 'docs/committed.md'), 'committed cites ADR-0012.\nuncommitted cites ADR-0012.\n');
  assert.equal(read(alice, 'docs/untracked.md'), 'untracked cites ADR-0012.\n');
  assert.deepEqual(r.unattributed, []);
});

test('a squash-merged decision rewrites only its own file and entry and lists every other citation', async () => {
  const { renumberDecision } = await renum();
  const { alice } = base();
  git(['checkout', '--quiet', '-b', 'feature/sq'], { cwd: alice });
  put(alice, 'docs/adr/0011-squashed.md', '# ADR-0011 — squashed\n');
  put(alice, 'docs/cites.md', 'squashed cites ADR-0011.\n');
  writeFileSync(paths(alice).decisions, read(alice, '.astrocode/DECISIONS.md') + entry('ADR-0011', 'squashed'));
  commitAll(alice, 'feature work');
  git(['checkout', '--quiet', 'main'], { cwd: alice });
  git(['merge', '--quiet', '--squash', 'feature/sq'], { cwd: alice });
  commitAll(alice, 'squash');
  const r = await renumberDecision(alice, 'docs/adr/0011-squashed.md', 'next');
  assert.equal(r.ok, true, r.error);
  assert.ok(existsSync(join(alice, 'docs/adr/0012-squashed.md')));
  assert.match(read(alice, '.astrocode/DECISIONS.md'), /^## ADR-0012 — squashed$/m);
  assert.equal(read(alice, 'docs/cites.md'), 'squashed cites ADR-0011.\n');
  assert.deepEqual(r.unattributed, [{ file: 'docs/cites.md', line: 1 }]);
});

test('--dry-run writes nothing', async () => {
  const { renumberDecision } = await renum();
  const { merged, alice } = collision();
  const before = snap(merged);
  const r = await renumberDecision(merged, 'docs/adr/0042-bob-thing.md', 'next', { dryRun: true });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  assert.equal(r.to, 43);
  assert.ok(r.changed.includes('docs/bob.md'));
  assert.equal(snap(merged), before);
  assert.ok(!existsSync(join(paths(merged).local, 'adr-claims.json')));
  // and no claim reached the registry
  const { addDecision } = await canon();
  assert.equal((await addDecision(alice, { title: 'After dry run', why: 'w' })).id, 'ADR-0043');
});

test('only the named decision changes', async () => {
  const { renumberDecision } = await renum();
  const { merged } = collision();
  const files = () => readdirSync(join(merged, 'docs/adr')).sort();
  const aliceFile = read(merged, 'docs/adr/0042-alice-thing.md');
  const aliceDoc = read(merged, 'docs/alice.md');
  const old = files().filter((f) => /old/.test(f));
  await renumberDecision(merged, 'docs/adr/0042-bob-thing.md', 'next');
  assert.deepEqual(files().filter((f) => /old/.test(f)), old);
  assert.equal(read(merged, 'docs/adr/0042-alice-thing.md'), aliceFile);
  assert.equal(read(merged, 'docs/alice.md'), aliceDoc);
  assert.equal(files().length, 12);
});
