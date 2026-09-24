// Phase 26 t2 — RED-then-GREEN in one task (PLAN.md: "t2 writes its test first inside
// the task"). Covers the shared transcript/watermark path helpers this task adds to
// `hooks/_astro-ctx.mjs` (P7): `transcriptSlug`, `principlesStoreDir`, `claudeConfigDirs`,
// `mineFilesPath`, `unsweptSessions`, `MINE_NUDGE_SESSIONS`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK = new URL('../hooks/_astro-ctx.mjs', import.meta.url).pathname;
const LIB_HOSTS_CLAUDE = new URL('../lib/hosts/claude.mjs', import.meta.url).pathname;

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'ac-tp-home-'));
  const claude = join(home, '.claude');
  mkdirSync(claude, { recursive: true });
  return { home, claude };
}

test('transcriptSlug replaces every non-alphanumeric character (#38)', async () => {
  const { transcriptSlug } = await import(HOOK);
  assert.equal(transcriptSlug('/a/luigi.lauro/CIL_Quote'), '-a-luigi-lauro-CIL-Quote');
});

test('principlesStoreDir mirrors lib/principles.mjs principlesDir', async () => {
  const { principlesStoreDir } = await import(HOOK);
  const { principlesDir } = await import('../lib/principles.mjs');
  const env1 = { HOME: '/x/home' };
  assert.equal(principlesStoreDir(env1), principlesDir(env1));
  const env2 = { HOME: '/x/home', ASTRO_PRINCIPLES_DIR: '/custom/store' };
  assert.equal(principlesStoreDir(env2), principlesDir(env2));
});

test('claudeConfigDirs mirrors [...configTargets().keys()] under sandbox fixtures', async () => {
  const { claude, home } = sandbox();
  const prevDir = process.env.CLAUDE_CONFIG_DIR;
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  try {
    // No registry at all.
    {
      const { claudeConfigDirs } = await import(`${HOOK}?c=${encodeURIComponent(home)}a`);
      const { configTargets } = await import(`${LIB_HOSTS_CLAUDE}?c=${encodeURIComponent(home)}a`);
      assert.deepEqual(claudeConfigDirs(process.env), [...configTargets().keys()]);
    }

    // profiles.json with two profiles.
    mkdirSync(join(claude, '.jean-claude'), { recursive: true });
    writeFileSync(
      join(claude, '.jean-claude', 'profiles.json'),
      JSON.stringify({ profiles: { work: { configDir: join(home, '.claude-work') }, b: { configDir: join(home, '.claude-b') } } }),
    );
    {
      const { claudeConfigDirs } = await import(`${HOOK}?c=${encodeURIComponent(home)}b`);
      const { configTargets } = await import(`${LIB_HOSTS_CLAUDE}?c=${encodeURIComponent(home)}b`);
      assert.deepEqual(claudeConfigDirs(process.env), [...configTargets().keys()]);
      assert.equal(claudeConfigDirs(process.env).length, 3);
    }

    // CLAUDE_CONFIG_DIR not otherwise covered.
    process.env.CLAUDE_CONFIG_DIR = join(home, '.claude-env');
    {
      const { claudeConfigDirs } = await import(`${HOOK}?c=${encodeURIComponent(home)}c`);
      const { configTargets } = await import(`${LIB_HOSTS_CLAUDE}?c=${encodeURIComponent(home)}c`);
      assert.deepEqual(claudeConfigDirs(process.env), [...configTargets().keys()]);
      assert.ok(claudeConfigDirs(process.env).includes(join(home, '.claude-env')));
    }
  } finally {
    if (prevDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prevDir;
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
  }
});

test('mineFilesPath ends in .local/mine/files/<slug>.json', async () => {
  const { mineFilesPath } = await import(HOOK);
  assert.equal(mineFilesPath('/store', 'my-slug'), join('/store', '.local', 'mine', 'files', 'my-slug.json'));
});

test('MINE_NUDGE_SESSIONS is 10', async () => {
  const { MINE_NUDGE_SESSIONS } = await import(HOOK);
  assert.equal(MINE_NUDGE_SESSIONS, 10);
});

test('unsweptSessions counts only top-level *.jsonl files, across config dirs, respecting a recorded offset', async () => {
  const { unsweptSessions, transcriptSlug, mineFilesPath } = await import(HOOK);
  const { home, claude } = sandbox();
  const root = join(home, 'proj');
  const slug = transcriptSlug(root);
  const dir1 = join(claude, 'projects', slug);
  mkdirSync(join(dir1, 'sub-session', 'subagents'), { recursive: true });
  writeFileSync(join(dir1, 'a.jsonl'), 'x'.repeat(50));
  writeFileSync(join(dir1, 'b.jsonl'), 'y'.repeat(50));
  // A subagent file must never be counted.
  writeFileSync(join(dir1, 'sub-session', 'subagents', 'agent.jsonl'), 'z'.repeat(50));
  // Another project's dir must never be counted.
  mkdirSync(join(claude, 'projects', 'other-project'), { recursive: true });
  writeFileSync(join(claude, 'projects', 'other-project', 'c.jsonl'), 'w'.repeat(50));

  const env = { HOME: home, CLAUDE_CONFIG_DIR: claude };

  // No recorded offset at all → both files unswept.
  assert.equal(unsweptSessions(root, env), 2);

  // Record an offset equal to file size for `a.jsonl` — it is swept, `b.jsonl` is not.
  const storeDir = join(home, '.astro', 'principles');
  const filesPath = mineFilesPath(storeDir, slug);
  mkdirSync(join(filesPath, '..'), { recursive: true });
  writeFileSync(filesPath, JSON.stringify({
    version: 1,
    files: { [join(dir1, 'a.jsonl')]: { offset: 50 } },
  }));
  const env2 = { HOME: home, CLAUDE_CONFIG_DIR: claude, ASTRO_PRINCIPLES_DIR: storeDir };
  assert.equal(unsweptSessions(root, env2), 1);

  // Appended bytes make it unswept again.
  truncateSync(join(dir1, 'a.jsonl'), 60);
  assert.equal(unsweptSessions(root, env2), 2);

  // A missing or corrupt files JSON reads as "nothing swept".
  writeFileSync(filesPath, 'not json{{{');
  assert.equal(unsweptSessions(root, env2), 2);
});
