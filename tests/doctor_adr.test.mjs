// `ac doctor` reports ADR consistency, one row per finding with its fix (phase 53 t8, ADR-087).
// Same harness as tests/doctor.test.mjs: a fake HOME with a real install, then a real project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = ['HOME', 'CLAUDE_CONFIG_DIR', 'CURSOR_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'PATH'];

async function sandbox(fn) {
  const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ac-docadr-')));
  const home = join(base, 'home');
  mkdirSync(home, { recursive: true });
  process.env.HOME = home;
  for (const k of ['CLAUDE_CONFIG_DIR', 'CURSOR_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME']) delete process.env[k];
  process.env.PATH = `${mkdtempSync(join(tmpdir(), 'ac-nopath-'))}:${dirname(process.execPath)}`;
  try {
    const q = encodeURIComponent(`${home}-${Math.random()}`);
    const inst = await import(`../lib/install.mjs?d=${q}`);
    inst.installClaude(FRAMEWORK);
    const { runDoctor, renderDoctor } = await import(`../lib/doctor.mjs?d=${q}`);
    const astroHome = join(home, '.astro', 'code');
    return await fn({ run: (o = {}) => runDoctor({ astroHome, cwd: base, ...o }), render: renderDoctor });
  } finally {
    for (const k of KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}

const adrRows = (rows) => rows.filter((r) => r.id === 'adr');

function project({ seeded, remote = true, adr = true }) {
  const proj = mkdtempSync(join(tmpdir(), 'ac-docadr-proj-'));
  git(['init', '--quiet'], { cwd: proj });
  git(['config', 'user.email', 'a@example.com'], { cwd: proj });
  git(['config', 'user.name', 'a'], { cwd: proj });
  let bare = null;
  if (remote) {
    bare = join(mkdtempSync(join(tmpdir(), 'ac-origin-')), 'origin.git');
    git(['init', '--quiet', '--bare', bare]);
    git(['remote', 'add', 'origin', bare], { cwd: proj });
  }
  initPlanning(proj, { name: 'proj' });
  if (adr) {
    mkdirSync(join(proj, 'docs/adr'), { recursive: true });
    const put = (name, title) => writeFileSync(join(proj, 'docs/adr', name), `# ADR-${name.slice(0, 4)} — ${title}\n`);
    for (let i = 1; i <= 10; i++) put(`${String(i).padStart(4, '0')}-f${i}.md`, i === 3 ? 'three real' : `f${i}`);
    if (seeded) { put('0150-stray.md', 'stray'); put('0007-second.md', 'second seven'); }
    writeFileSync(paths(proj).decisions, '# Decisions\n\n## ADR-0003 — three logged\n_2026-01-01_\n\n' + (seeded ? '## ADR-045 — old series\n_2026-01-01_\n' : ''));
    if (!seeded) writeFileSync(paths(proj).decisions, '# Decisions\n\n## ADR-0003 — three real\n_2026-01-01_\n');
  }
  return { proj, bare };
}

async function claimRegistry(proj) {
  const { claimsText } = await import('../lib/adr.mjs');
  const { transact } = await import('../lib/shared.mjs');
  const claims = {
    version: 1,
    claims: Array.from({ length: 10 }, (_, i) => ({ number: i + 1, source: 'backfill' })),
    backfill: { at: 'x', log_width: 3, folder_width: 4, relabel: {} },
  };
  assert.equal(transact(proj, { remote: 'origin', branch: 'astro-registry', message: 'seed' }, () => ({ updates: { 'adr-claims.json': claimsText(claims) } })).ok, true);
}

test('each seeded ADR problem is its own failing `adr` row ending in its fix', async () => {
  await sandbox(async ({ run, render }) => {
    const { proj } = project({ seeded: true });
    await claimRegistry(proj);
    const rows = adrRows(run({ cwd: proj }));
    assert.equal(rows.length, 4);
    assert.ok(rows.every((r) => r.ok === false && /^ac decision renumber /.test(r.fix)));
    for (const needle of [/unclaimed/, /0007/, /ADR-045/, /three real/]) assert.ok(rows.some((r) => needle.test(r.detail)), String(needle));
    const lines = render(rows);
    assert.equal(lines.length, 4);
    assert.ok(lines.every((l) => / → ac decision renumber /.test(l)));
  });
});

test('a clean ADR project has one ok `adr` row', async () => {
  await sandbox(async ({ run }) => {
    const { proj } = project({ seeded: false });
    await claimRegistry(proj);
    const rows = adrRows(run({ cwd: proj }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ok, true);
    assert.match(rows[0].detail, /consistent/);
  });
});

test('outside a project, a non-ADR project and an unreachable registry are skipped, not failed', async () => {
  await sandbox(async ({ run }) => {
    const outside = adrRows(run());
    assert.equal(outside.length, 1);
    assert.deepEqual([outside[0].ok, /^skipped —/.test(outside[0].detail)], [true, true]);
    const { proj } = project({ seeded: false, adr: false });
    const plain = adrRows(run({ cwd: proj }));
    assert.deepEqual([plain.length, plain[0].ok, /^skipped —/.test(plain[0].detail)], [1, true, true]);
    const seeded = project({ seeded: true });
    git(['remote', 'set-url', 'origin', join(tmpdir(), 'ac-gone.git')], { cwd: seeded.proj });
    const down = adrRows(run({ cwd: seeded.proj }));
    assert.deepEqual([down.length, down[0].ok, /^skipped —/.test(down[0].detail)], [1, true, true]);
  });
});

test('`--json` failing rows all carry fix', async () => {
  await sandbox(async ({ run }) => {
    const { proj } = project({ seeded: true });
    await claimRegistry(proj);
    const failing = JSON.parse(JSON.stringify(run({ cwd: proj }))).filter((r) => !r.ok);
    const rows = failing.filter((r) => r.id === 'adr');
    assert.equal(rows.length, 4);
    assert.ok(failing.every((r) => typeof r.fix === 'string' && r.fix.length > 0));
    assert.ok(rows.every((r) => typeof r.fix === 'string' && r.fix.length > 0));
  });
});

test('doctor writes nothing and moves no registry tip', async () => {
  await sandbox(async ({ run }) => {
    const { proj } = project({ seeded: true });
    await claimRegistry(proj);
    const state = () => ({
      status: git(['status', '--porcelain', '-uall'], { cwd: proj }).stdout,
      tip: git(['ls-remote', 'origin', 'refs/heads/astro-registry'], { cwd: proj }).stdout,
    });
    const before = state();
    run({ cwd: proj });
    assert.deepEqual(state(), before);
  });
});
