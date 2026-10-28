// Phase 54 t23 (C14): every `ac verdict defer|history|show|cheap`, `ac verdict plan --broad-files` and
// `ac setup run|list` invocation quoted in MANUAL.md and CHANGELOG.md is a real command: it runs in a scratch
// project without "unknown command", "unknown flag" or a usage error. Real CLI, real tmp git project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase } from '../lib/roadmap.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(ROOT, 'bin', 'ac.mjs');
const ac = (cwd, ...a) => spawnSync(process.execPath, [AC, ...a], { cwd, encoding: 'utf8', env: { ...process.env, ASTRO_SIGNER_AGENT: '' } });
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

const FAMILY = /^ac (?:verdict (?:defer|history|show|cheap)\b|verdict plan\b.*--broad-files|setup (?:run|list)\b)/;

/** Every `ac …` command of the families above quoted in `text`: inline code spans and fenced/indented lines. */
function quoted(text) {
  const out = new Set();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) out.add(m[1]);
  for (const line of text.split('\n')) out.add(line.trim());
  return [...out].map((x) => x.replace(/\s+#.*$/, '').trim()).filter((x) => FAMILY.test(x));
}

function argvOf(cmd) {
  const flat = cmd
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/<(?:phase|n|number)>/g, '1')
    .replace(/<ids>/g, 'C2')
    .replace(/<name>/g, 'build')
    .replace(/<ref>/g, 'HEAD')
    .replace(/<files>/g, 'src/a.mjs');
  return flat.trim().split(/\s+/).slice(1); // drop the leading `ac`
}

async function project() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-docs-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'docs' });
  await addPhase(dir, { number: 1, name: 'Docs phase' });
  const ph = findPhase(dir, '1');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.mjs'), 'x');
  writeFileSync(join(dir, '.astrocode', 'phases', ph.slug, 'CRITERIA.md'), '### C1 — a\n- **Files:** `src/a.mjs`\n\n### C2 [edge] — b\n- **Cheap:** `node -e "process.exit(0)"`\n');
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'init');
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

for (const file of ['MANUAL.md', 'CHANGELOG.md']) {
  test(`${file}: every quoted verdict/setup invocation runs without an unknown command, unknown flag or usage error`, async () => {
    const cmds = quoted(readFileSync(join(ROOT, file), 'utf8'));
    assert.ok(cmds.length > 0, `${file} quotes at least one of the new commands`);
    const p = await project();
    try {
      for (const cmd of cmds) {
        const r = ac(p.dir, ...argvOf(cmd));
        const text = `${r.stdout}\n${r.stderr}`;
        assert.doesNotMatch(text, /unknown command|unknown flags?\b|usage:|unexpected argument|expected C<n>/i, `\`${cmd}\` → ${text.trim().split('\n')[0]}`);
      }
    } finally { p.done(); }
  });
}

test('MANUAL.md documents each new verb, the tags and the setup declaration; CHANGELOG.md has a v0.54.0 entry citing the ADRs', () => {
  const manual = readFileSync(join(ROOT, 'MANUAL.md'), 'utf8');
  const cmds = quoted(manual).join('\n');
  for (const re of [/verdict defer/, /verdict history/, /verdict show/, /verdict cheap/, /--broad-files/, /setup run/, /setup list/]) assert.match(cmds, re);
  for (const re of [/\[edge\]/, /\[core\]/, /Cheap:/, /setup\.steps\./, /setup\.max_mb/, /VERDICTS\.jsonl/, /ADR-090/, /ADR-091/]) assert.match(manual, re);
  const log = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  // Phase 54 shipped in v0.54.0: its entry sits under that heading, not Unreleased.
  const at = log.indexOf('## v0.54.0');
  assert.ok(at > -1, 'a v0.54.0 section');
  assert.match(log.slice(at, log.indexOf('## v0.53.1')), /ADR-090, ADR-091/);
});

test('MANUAL.md points at lib/ for thresholds instead of restating them', () => {
  const manual = readFileSync(join(ROOT, 'MANUAL.md'), 'utf8');
  const sec = manual.slice(manual.indexOf('## Fewer, cheaper verify rounds'), manual.indexOf('## Mutation testing'));
  assert.match(sec, /thresholds live there/);
  assert.doesNotMatch(sec, /\b(?:MAX_NARROW_UNMET|MAX_TARGETED_FILES|NARROW_DENOMINATOR)\b/);
});
