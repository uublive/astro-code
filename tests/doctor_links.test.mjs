// Phase 50 t8 — the links check on every installed host, including stale entries in a Claude dir
// install no longer targets. A real install into a home that also has ~/.codex and
// ~/.config/opencode; each test seeds its drift into that tree. Dynamic imports (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, symlinkSync, readdirSync, copyFileSync, lstatSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = ['HOME', 'CLAUDE_CONFIG_DIR', 'CURSOR_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'PATH'];

async function sandbox(fn, { codex = true, opencode = true, claudeBase = true, configDir } = {}) {
  const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'ac-doclink-')));
  process.env.HOME = home;
  for (const k of ['CLAUDE_CONFIG_DIR', 'CURSOR_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME']) delete process.env[k];
  process.env.PATH = `${mkdtempSync(join(tmpdir(), 'ac-nopath-'))}:${dirname(process.execPath)}`;
  if (claudeBase) mkdirSync(join(home, '.claude'), { recursive: true });
  if (codex) mkdirSync(join(home, '.codex'), { recursive: true });
  if (opencode) mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  if (configDir) { process.env.CLAUDE_CONFIG_DIR = configDir(home); mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true }); }
  try {
    const q = encodeURIComponent(`${home}-${Math.random()}`);
    const inst = await import(`../lib/install.mjs?d=${q}`);
    inst.installClaude(FRAMEWORK);
    const { runDoctor } = await import(`../lib/doctor.mjs?d=${q}`);
    const astroHome = join(home, '.astro', 'code');
    const scratch = mkdtempSync(join(tmpdir(), 'ac-scratch-'));
    return await fn({
      home, astroHome, inst, claude: join(home, '.claude'), codexDir: join(home, '.codex'), ocDir: join(home, '.config', 'opencode'),
      run: () => runDoctor({ astroHome, cwd: scratch }), q,
    });
  } finally {
    for (const k of KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}
const bad = (rows) => rows.filter((r) => !r.ok);

test('a shipped command removed from a host command dir is named missing, for Claude and for Codex', async () => {
  await sandbox(({ run, claude, codexDir, ocDir }) => {
    rmSync(join(claude, 'commands', 'astro-status.md'));
    rmSync(join(codexDir, 'skills', 'astro-help'), { recursive: true });
    rmSync(join(ocDir, 'commands', 'astro-plan.md'));
    const rows = bad(run());
    assert.deepEqual(rows.map((r) => r.id), ['links', 'links', 'links']);
    const by = Object.fromEntries(rows.map((r) => [r.host, r]));
    assert.equal(by.claude.detail, 'missing command astro-status');
    assert.equal(by.claude.dir, claude);
    assert.equal(by.codex.detail, 'missing command astro-help');
    assert.equal(by.opencode.detail, 'missing command astro-plan');
    assert.ok(rows.every((r) => r.fix === 'ac install'));
  });
});

test('a dangling command link is named', async () => {
  await sandbox(({ run, claude, astroHome }) => {
    const link = join(claude, 'commands', 'astro-status.md');
    rmSync(link);
    symlinkSync(join(astroHome, 'commands', 'no-such-file.md'), link);
    const rows = bad(run());
    assert.ok(rows.some((r) => r.id === 'links' && r.detail === `dangling link ${link}`), JSON.stringify(rows));
  });
});

test('a stale astro-* link the shipped set no longer contains is named with rm', async () => {
  await sandbox(({ run, claude, astroHome, codexDir }) => {
    const stale = join(claude, 'commands', 'astro-gone.md');
    symlinkSync(join(astroHome, 'commands', 'astro-status.md'), stale);
    mkdirSync(join(codexDir, 'skills', 'astro-old'));
    const rows = bad(run());
    assert.equal(rows.length, 2);
    assert.ok(rows.some((r) => r.host === 'claude' && r.detail === `stale entry ${stale}` && r.fix === `rm "${stale}"`));
    assert.ok(rows.some((r) => r.host === 'codex' && r.fix === `rm -r "${join(codexDir, 'skills', 'astro-old')}"`));
  });
});

test('a stale link in a Claude dir install no longer targets is named', async () => {
  const d2 = (h) => join(h, 'claude2');
  await sandbox(async ({ run, home, q }) => {
    // install ran with CLAUDE_CONFIG_DIR=<d2>; now the variable is gone
    delete process.env.CLAUDE_CONFIG_DIR;
    const dir = d2(home);
    writeFileSync(join(dir, 'commands', 'astro-gone.md'), '# stale\n');
    const rows = bad(run());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].host, 'claude');
    assert.equal(rows[0].dir, dir);
    assert.equal(rows[0].detail, `stale entry ${join(dir, 'commands', 'astro-gone.md')}`);
    assert.match(rows[0].fix, /^rm "/);
    void q;
  }, { configDir: d2, claudeBase: false });
});

test('live links in a no-longer-targeted dir are not flagged', async () => {
  await sandbox(({ run, home }) => {
    delete process.env.CLAUDE_CONFIG_DIR;
    const rows = run().filter((r) => r.dir === join(home, 'claude2'));
    assert.ok(rows.length > 0, 'the earlier dir is examined');
    assert.deepEqual(bad(rows), []);
  }, { configDir: (h) => join(h, 'claude2'), claudeBase: false });
});

test('removing astro-doctor.md is reported', async () => {
  await sandbox(({ run, claude, codexDir }) => {
    rmSync(join(claude, 'commands', 'astro-doctor.md'));
    rmSync(join(codexDir, 'skills', 'astro-doctor'), { recursive: true });
    const rows = bad(run());
    assert.deepEqual(rows.map((r) => r.detail).sort(), ['missing command astro-doctor', 'missing command astro-doctor']);
  });
});

test('all seeded link problems are reported in one run', async () => {
  await sandbox(({ run, claude, astroHome, codexDir, ocDir }) => {
    rmSync(join(claude, 'commands', 'astro-status.md'));
    rmSync(join(claude, 'agents', 'astro-verifier.md'));
    symlinkSync(join(astroHome, 'nothing'), join(claude, 'agents', 'astro-verifier.md'));
    writeFileSync(join(ocDir, 'agents', 'astro-leftover.md'), 'x');
    rmSync(join(codexDir, 'skills', 'astro-help'), { recursive: true });
    const rows = bad(run());
    assert.equal(rows.length, 4, JSON.stringify(rows.map((r) => r.detail)));
  });
});

test('a self-hosted config dir whose commands/ is the clone\'s is not flagged', async () => {
  const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'ac-doclink-')));
  const clone = realpathSync(mkdtempSync(join(tmpdir(), 'ac-clone-')));
  process.env.HOME = home;
  for (const k of ['CLAUDE_CONFIG_DIR', 'CURSOR_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME']) delete process.env[k];
  process.env.PATH = `${mkdtempSync(join(tmpdir(), 'ac-nopath-'))}:${dirname(process.execPath)}`;
  try {
    for (const d of ['commands', 'agents']) { mkdirSync(join(clone, d)); for (const f of readdirSync(join(FRAMEWORK, d))) copyFileSync(join(FRAMEWORK, d, f), join(clone, d, f)); }
    for (const d of ['workflows', 'hooks']) mkdirSync(join(clone, d));
    writeFileSync(join(clone, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));
    mkdirSync(join(home, '.claude'), { recursive: true });
    symlinkSync(join(clone, 'commands'), join(home, '.claude', 'commands'));
    symlinkSync(join(clone, 'agents'), join(home, '.claude', 'agents'));
    const q = encodeURIComponent(`${home}-self`);
    const inst = await import(`../lib/install.mjs?d=${q}`);
    inst.installClaude(clone);
    const { runDoctor } = await import(`../lib/doctor.mjs?d=${q}`);
    const rows = runDoctor({ astroHome: join(home, '.astro', 'code'), clone, cwd: tmpdir() });
    assert.deepEqual(bad(rows).filter((r) => r.id === 'links'), []);
  } finally {
    for (const k of KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
});

test('a Windows-style copy of a shipped command is accepted', async () => {
  await sandbox(({ run, claude, astroHome }) => {
    const link = join(claude, 'commands', 'astro-status.md');
    rmSync(link);
    copyFileSync(join(astroHome, 'commands', 'astro-status.md'), link);
    assert.ok(!lstatSync(link).isSymbolicLink());
    assert.deepEqual(bad(run()), []);
  });
});

test('a host that is not installed produces no rows', async () => {
  await sandbox(({ run }) => {
    const hosts = new Set(run().map((r) => r.host).filter(Boolean));
    assert.deepEqual([...hosts], ['claude']);
  }, { codex: false, opencode: false });
  await sandbox(({ run }) => {
    const hosts = new Set(run().map((r) => r.host).filter(Boolean));
    assert.deepEqual([...hosts].sort(), ['claude', 'codex', 'opencode']);
  });
});
