// Regression guard for commands/astro-kit-convert.md — pins the command contract
// (frontmatter + load-bearing body invariants from CONTEXT.md decisions 2-7 and
// ADR-023/024/025) and the doc listing in astro-help.md / README.md.  Test-after
// (depends_on t2, t4): t2 wrote the command spec, t4 wrote the doc listings; this
// file asserts their shape so a future reword can't silently drop the contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS = join(ROOT, 'commands');
const CONVERT_MD = join(COMMANDS, 'astro-kit-convert.md');
const HELP_MD = join(COMMANDS, 'astro-help.md');
const README_MD = join(ROOT, 'README.md');

const src = readFileSync(CONVERT_MD, 'utf8');

/**
 * Slice out the YAML frontmatter block (between the two `---` fences) so
 * assertions about argument-hint / allowed-tools are scoped to the header,
 * not incidentally matched in the prose body.
 */
function extractFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, 'astro-kit-convert.md must open with a --- frontmatter block');
  return match[1];
}

const frontmatter = extractFrontmatter(src);

// ── 1. Frontmatter: argument-hint ────────────────────────────────────────────────
test('astro-kit-convert.md frontmatter declares argument-hint: [source path]', () => {
  assert.match(
    frontmatter,
    /argument-hint:\s*\[source path\]/,
    `frontmatter must declare "argument-hint: [source path]" — found:\n\n${frontmatter}`,
  );
});

// ── 2. Frontmatter: allowed-tools includes AskUserQuestion + Agent ──────────────
test('astro-kit-convert.md frontmatter allowed-tools includes AskUserQuestion and Agent', () => {
  const toolsLine = frontmatter.match(/^allowed-tools:\s*(.+)$/m);
  assert.ok(toolsLine, `frontmatter must have an allowed-tools line — found:\n\n${frontmatter}`);
  const tools = toolsLine[1].split(',').map((t) => t.trim());
  assert.ok(
    tools.includes('AskUserQuestion'),
    `allowed-tools must include "AskUserQuestion" (needed to confirm the capability map / ` +
      `email_attachment gap-fill) — found: ${tools.join(', ')}`,
  );
  assert.ok(
    tools.includes('Agent'),
    `allowed-tools must include "Agent" (needed to spawn the read-only astro-mapper agent) — ` +
      `found: ${tools.join(', ')}`,
  );
});

// ── 3. Body: scaffolding is indirected through ac path templates / $KIT_TPL ─────
//
// ADR-024/de-risk #14 — never hardcode the template tree, always go through
// `$(ac path templates)/kit/` (aliased $KIT_TPL) so convert stays in lockstep with
// astro-kit-new's scaffold.

test('astro-kit-convert.md indirects scaffolding through ac path templates / $KIT_TPL', () => {
  const hasAcPathTemplates = /\$\(ac path templates\)/.test(src);
  const hasKitTpl = /\$KIT_TPL/.test(src);
  assert.ok(
    hasAcPathTemplates && hasKitTpl,
    `body must reference "$(ac path templates)" and "$KIT_TPL" so scaffolding is never ` +
      `hardcoded (ADR-024) — found ac-path-templates=${hasAcPathTemplates}, KIT_TPL=${hasKitTpl}`,
  );
});

// ── 4. Body: references the parity contract / golden fixtures / normalization ───
//
// ADR-025 — parity is proven by a golden-fixture parity contract with a declared
// normalization list, not a human "looks right".

test('astro-kit-convert.md references the parity contract, golden fixtures, and normalization', () => {
  const hasParity = /parity/i.test(src);
  const hasFixtures = /fixtures?/i.test(src);
  const hasNormalization = /normaliz/i.test(src);
  assert.ok(
    hasParity && hasFixtures && hasNormalization,
    `body must reference the parity contract (ADR-025), golden fixtures, and the declared ` +
      `normalization list — found parity=${hasParity}, fixtures=${hasFixtures}, ` +
      `normalization=${hasNormalization}`,
  );
});

// ── 5. Body: requires flagging non-self-contained (network/secret) parts ────────
//
// CONTEXT.md decision 7 — infra/network-only/secret pieces that can't be made
// self-contained must be flagged as explicit manual follow-ups, never silently
// dropped and never wired in as a hidden external dependency.

test('astro-kit-convert.md requires flagging non-self-contained parts as follow-ups', () => {
  const hasFlag = /flag/i.test(src);
  const hasSelfContained = /self-contained/i.test(src);
  const hasNeverDropped = /never\s+(?:be\s+)?(?:silently\s+)?dropped|never\s+silently/i.test(src);
  assert.ok(
    hasFlag && hasSelfContained,
    `body must instruct flagging capabilities that can't be made self-contained — found ` +
      `flag=${hasFlag}, self-contained=${hasSelfContained}`,
  );
  assert.ok(
    hasNeverDropped,
    `body must state flagged capabilities are never silently dropped — found no such wording`,
  );
});

// ── 6. Body: references astro-mapper ─────────────────────────────────────────────
//
// CONTEXT.md / t2 — step 1 spawns the read-only astro-mapper agent against the
// source (reuse the astro-adopt.md mapping primitive) rather than inventing a
// second mapping pass.

test('astro-kit-convert.md references astro-mapper', () => {
  assert.match(
    src,
    /astro-mapper/,
    'body must reference the "astro-mapper" agent for source mapping (step 1) — found none',
  );
});

// ── 7. Body: ends by pointing at a numbered /astro-discuss 1 ────────────────────
//
// Command specs must always reference a phase by number, never by an implicit
// "the current phase" — matches astro-kit-new's hand-off convention.

test('astro-kit-convert.md ends by pointing at a numbered /astro-discuss 1', () => {
  assert.match(
    src,
    /\/astro-discuss\s+1\b/,
    'body must point at "/astro-discuss 1" (numbered phase reference) to hand off the loop',
  );
});

// ── 8. Docs: astro-help.md and README.md both list astro-kit-convert ────────────

test('astro-help.md lists astro-kit-convert', () => {
  const helpSrc = readFileSync(HELP_MD, 'utf8');
  assert.match(
    helpSrc,
    /astro-kit-convert/,
    'commands/astro-help.md must list astro-kit-convert alongside the other kit commands',
  );
});

test('README.md lists astro-kit-convert', () => {
  const readmeSrc = readFileSync(README_MD, 'utf8');
  assert.match(
    readmeSrc,
    /astro-kit-convert/,
    'README.md must list astro-kit-convert alongside the other kit commands',
  );
});
