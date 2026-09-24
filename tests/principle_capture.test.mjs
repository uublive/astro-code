// Phase 23 t14 — the prose guard for the principle-capture spec (test-after by design,
// PLAN.md: it asserts on command/template text that only exists once t7/t8/t10/t11/t12/t13
// have landed). Follows tests/forge.test.mjs's shape: readFileSync, scoped slices, and
// messages that quote the missing/offending text.
//
// Three concerns, kept in one file because they all guard the SAME single-source-of-truth
// promise (P1): the spec is the only place the rules are stated in full; the four capture
// commands and `astro-execute.md`'s surprise step point at it (or at `ac phase surprise` /
// `ac milestone harvest`) and never restate it; and the invocation the spec prints is the
// one the CLI actually accepts, end to end, against a real isolated HOME (C1/C2/C5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS_DIR = join(ROOT, 'commands');
const AGENTS_DIR = join(ROOT, 'agents');
const WORKFLOWS_DIR = join(ROOT, 'workflows');
const TEMPLATES_DIR = join(ROOT, 'templates');
const SPEC_PATH = join(TEMPLATES_DIR, 'principle-capture.md');
const AC = join(ROOT, 'bin', 'ac.mjs');

const cmd = (name) => readFileSync(join(COMMANDS_DIR, name), 'utf8');
const specSrc = readFileSync(SPEC_PATH, 'utf8');

const CAPTURE_COMMANDS = [
  'astro-decision.md',
  'astro-discuss.md',
  'astro-accept.md',
  'astro-complete-milestone.md',
];
// The four capture commands plus the surprise-note step in astro-execute.md (D3) — the
// full set of places the lift rule must be referenced by pointer only, never restated.
const CAPTURE_OR_SURPRISE_COMMANDS = [...CAPTURE_COMMANDS, 'astro-execute.md'];

const POINTER = '$(ac path templates)/principle-capture.md';

// ── 1. The spec states every rule the plan pins (P1) ────────────────────────────────

test('templates/principle-capture.md states the volume cap of 3', () => {
  assert.ok(
    /\bat most\s+\*{0,2}3\*{0,2}\b/i.test(specSrc) || /\b3\s+proposals per moment/i.test(specSrc),
    'the spec must state the volume cap of 3 proposals per moment (D4)',
  );
});

test('templates/principle-capture.md states the lift-the-generator phrase', () => {
  assert.ok(
    specSrc.includes('Strip every project noun'),
    'the spec must state the lift rule verbatim, beginning "Strip every project noun" — this is the ONE place it may live (single source)',
  );
});

test('templates/principle-capture.md requires a non-empty --why', () => {
  assert.ok(
    /--why/.test(specSrc) && /non-empty/i.test(specSrc),
    'the spec must require a non-empty --why for each proposal',
  );
});

test('templates/principle-capture.md states the exact report line', () => {
  assert.ok(
    specSrc.includes('proposed N principle(s) — ac principles list --proposed'),
    'the spec must state the exact report line (D5, ADR-055)',
  );
});

test('templates/principle-capture.md states zero proposals means saying nothing', () => {
  assert.ok(
    /zero proposals.{0,40}say nothing/is.test(specSrc.replace(/\n/g, ' ')),
    'the spec must state that zero proposals means saying nothing (never "proposed 0")',
  );
});

test('templates/principle-capture.md forbids an inline accept prompt', () => {
  assert.ok(
    /no inline accept prompt/i.test(specSrc),
    'the spec must state there is no inline accept prompt, ever — review is batched',
  );
});

test('templates/principle-capture.md states --from-session is always omitted', () => {
  assert.ok(
    /--from-session.{0,40}always omitted/is.test(specSrc.replace(/\n/g, ' ')),
    'the spec must state --from-session is always omitted (no session id reaches a command)',
  );
});

// ── 2. Single source: every caller points at the spec, none restates the lift rule ──

test('each of the four capture commands points at the spec by its `ac path templates` form', () => {
  const missing = CAPTURE_COMMANDS.filter((name) => !cmd(name).includes(POINTER));
  assert.deepEqual(
    missing,
    [],
    `every capture command must reference the spec as \`${POINTER}\` — missing in: ${missing.join(', ')}`,
  );
});

test('none of the capture/surprise commands restates the lift rule inline (single source)', () => {
  const offenders = CAPTURE_OR_SURPRISE_COMMANDS.filter((name) => cmd(name).includes('strip every project noun'));
  assert.deepEqual(
    offenders,
    [],
    `the lift rule must live ONLY in templates/principle-capture.md — restated (drift bait) in: ${offenders.join(', ')}`,
  );
});

// ── 3. Forge writes stay removed (D1), and execute/workflows never call `ac principles` ──

test('no commands/, agents/, templates/ or workflows/ file references the forge write tool', () => {
  const offenders = [];
  for (const dir of [COMMANDS_DIR, AGENTS_DIR, TEMPLATES_DIR, WORKFLOWS_DIR]) {
    for (const rel of readdirSync(dir, { recursive: true })) {
      const full = join(dir, rel);
      if (!statSync(full).isFile()) continue;
      if (readFileSync(full, 'utf8').includes('forge_capture_knowledge')) {
        offenders.push(full.slice(ROOT.length + 1));
      }
    }
  }
  assert.deepEqual(offenders, [], `forge_capture_knowledge must not appear anywhere: ${offenders.join(', ')}`);
});

test('astro-execute.md and workflows/ never mention `ac principles` — execute only ever records surprises', () => {
  assert.ok(
    !cmd('astro-execute.md').includes('ac principles'),
    'astro-execute.md must not mention `ac principles` — it records surprises (D3), it does not propose (CONTEXT.md D3)',
  );
  for (const rel of readdirSync(WORKFLOWS_DIR, { recursive: true })) {
    const full = join(WORKFLOWS_DIR, rel);
    if (!statSync(full).isFile()) continue;
    assert.ok(
      !readFileSync(full, 'utf8').includes('ac principles'),
      `workflows/${rel} must not mention \`ac principles\``,
    );
  }
});

test('astro-execute.md names `ac phase surprise`, astro-complete-milestone.md names `ac milestone harvest`', () => {
  assert.ok(cmd('astro-execute.md').includes('ac phase surprise'), 'astro-execute.md must invoke `ac phase surprise`');
  assert.ok(
    cmd('astro-complete-milestone.md').includes('ac milestone harvest'),
    'astro-complete-milestone.md must invoke `ac milestone harvest` for the retrospective sweep',
  );
});

// ── 4. Ordering: the spec pointer sits where P6 pinned it in each command ───────────

test('astro-accept.md: the spec pointer sits after "Something fails" and not inside the "All criteria hold" bullet', () => {
  const src = cmd('astro-accept.md');
  const allCriteriaIdx = src.indexOf('**All criteria hold**');
  const somethingFailsIdx = src.indexOf('**Something fails**');
  const pointerIdx = src.indexOf(POINTER);
  assert.ok(allCriteriaIdx !== -1 && somethingFailsIdx !== -1 && pointerIdx !== -1, 'all three anchors must exist in astro-accept.md');
  const allCriteriaEnd = src.indexOf('**Who is signing', allCriteriaIdx);
  assert.ok(
    pointerIdx < allCriteriaIdx || pointerIdx >= allCriteriaEnd,
    'the spec pointer must not sit inside the "All criteria hold" bullet',
  );
  assert.ok(
    pointerIdx > somethingFailsIdx,
    'the spec pointer must sit after "Something fails" — the propose step runs on the rejection path',
  );
});

test('astro-discuss.md: the spec pointer sits after `ac phase context <N> --author`', () => {
  const src = cmd('astro-discuss.md');
  const authorIdx = src.indexOf('ac phase context');
  const pointerIdx = src.indexOf(POINTER);
  assert.ok(authorIdx !== -1 && pointerIdx !== -1, 'both anchors must exist in astro-discuss.md');
  assert.ok(pointerIdx > authorIdx, 'the spec pointer must sit after `ac phase context <N> --author` is checked');
});

test('astro-decision.md: the spec pointer sits after `ac decision add`', () => {
  const src = cmd('astro-decision.md');
  const addIdx = src.indexOf('ac decision add');
  const pointerIdx = src.indexOf(POINTER);
  assert.ok(addIdx !== -1 && pointerIdx !== -1, 'both anchors must exist in astro-decision.md');
  assert.ok(pointerIdx > addIdx, 'the spec pointer must sit after `ac decision add` has already run (step 3 succeeded)');
});

// ── 5. Drive C1/C2/C5: the prescribed invocation actually runs, end to end ──────────

/**
 * Extract the fenced ```sh``` invocation line from the spec (P1 §5) — the single line
 * beginning `ac principles add`. Fails loudly if the spec no longer contains it, so a
 * future reword of the invocation cannot silently stop being exercised.
 */
function extractInvocation(src) {
  const fenceStart = src.indexOf('```sh');
  assert.ok(fenceStart !== -1, 'templates/principle-capture.md must contain a ```sh fenced invocation block');
  const fenceEnd = src.indexOf('```', fenceStart + 5);
  assert.ok(fenceEnd !== -1, 'the ```sh fence must close');
  const block = src.slice(fenceStart + 5, fenceEnd);
  const line = block.split('\n').map((l) => l.trim()).find((l) => l.startsWith('ac principles add'));
  assert.ok(line, `the fenced block must contain a line starting "ac principles add" — got:\n${block}`);
  return line;
}

/**
 * Minimal shell-word tokenizer for the extracted invocation — splits on whitespace,
 * honoring double-quoted spans (the only quoting the spec's invocation ever uses).
 */
function tokenize(line) {
  const tokens = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return tokens;
}

/** Fill the spec's placeholders with concrete values for a test run. */
function fillPlaceholders(line, { statement, kind, why, project, ref, excerpt }) {
  return line
    .replace('<lifted statement>', statement)
    .replace('<principle|pattern|preference|antipattern>', kind)
    .replace('<why>', why)
    .replace('<project>', project)
    .replace('<ref>', ref)
    .replace("<the user's own words>", excerpt);
}

function mkHome() {
  return mkdtempSync(join(tmpdir(), 'ac-capture-home-'));
}

function mkProject(home) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-capture-proj-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  const env = envFor(home);
  const init = spawnSync(process.execPath, [AC, 'init'], { cwd: dir, encoding: 'utf8', env });
  assert.strictEqual(init.status, 0, init.stderr);
  return dir;
}

function envFor(home, extra = {}) {
  const env = { ...process.env, HOME: home };
  delete env.ASTRO_PRINCIPLES_DIR;
  env.GIT_AUTHOR_NAME = 'dev';
  env.GIT_AUTHOR_EMAIL = 'dev@example.com';
  env.GIT_COMMITTER_NAME = 'dev';
  env.GIT_COMMITTER_EMAIL = 'dev@example.com';
  Object.assign(env, extra);
  return env;
}

function run(argv, cwd, home) {
  return spawnSync(process.execPath, [AC, ...argv], { cwd, encoding: 'utf8', env: envFor(home) });
}

function storeDir(home) {
  return join(home, '.astro', 'principles');
}

function extractId(text) {
  const m = text.match(/\b(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\b/);
  return m && m[1];
}

test('C1/C2/C5: the invocation extracted from the spec runs end to end and is reviewable', () => {
  const rawLine = extractInvocation(specSrc);
  assert.ok(rawLine.startsWith('ac principles add'), 'the extracted line must start with "ac principles add"');

  const home = mkHome();
  const dir = mkProject(home);

  const filled = fillPlaceholders(rawLine, {
    statement: 'Tests exercise the prescribed invocation, not a paraphrase of it',
    kind: 'principle',
    why: 'a spec nobody runs drifts silently from the CLI it describes',
    project: 'astro-code',
    ref: 'phase 3',
    excerpt: 'the user said this in their own words',
  });

  const tokens = tokenize(filled);
  assert.equal(tokens[0], 'ac', 'the invocation must be invoked as `ac …`');
  const argv = tokens.slice(1);

  const add = run(argv, dir, home);
  assert.strictEqual(add.status, 0, `the prescribed invocation must exit 0 — stderr:\n${add.stderr}`);
  const id = extractId(add.stdout);
  assert.ok(id, `the invocation must print an id — got: ${add.stdout}`);

  // The review command parsed verbatim out of the spec's report line (§7): the literal
  // stem, not a re-typed guess at what it says.
  const reportLine = specSrc.match(/proposed N principle\(s\) — (ac principles list --proposed)/);
  assert.ok(reportLine, 'the spec report line must name the exact review command');
  const reviewArgv = reportLine[1].split(/\s+/).slice(1);

  const list = run(reviewArgv, dir, home);
  assert.strictEqual(list.status, 0, `\`${reportLine[1]}\` must exit 0 — stderr:\n${list.stderr}`);
  assert.match(list.stdout, new RegExp(id), 'the review command must list the just-proposed entry');

  const show = run(['principles', 'show', id, '--json'], dir, home);
  assert.strictEqual(show.status, 0, show.stderr);
  const entry = JSON.parse(show.stdout);
  assert.strictEqual(entry.status, 'proposed');
  assert.match(entry.why, /spec nobody runs drifts/);
  assert.match(entry.source.ref, /phase 3/);
  assert.match(entry.source.excerpt, /the user said this/);
  assert.match(entry.source.project, /astro-code/);
});

test('C15/D6 known gap: re-running the invocation over accepted, rejected and amended entries never touches them, and never mints a new accepted entry', () => {
  const rawLine = extractInvocation(specSrc);
  const statement = 'Never write directly under the principles store; the propose path is the only way in';

  const home = mkHome();
  const dir = mkProject(home);

  // Pre-seed: accepted, rejected-with-reason, and accepted-then-amended entries, all
  // sharing the same statement — the known-gap scenario D2's CONTEXT.md accepts for now.
  const accepted = run(['principles', 'add', statement, '--kind', 'principle'], dir, home);
  assert.strictEqual(accepted.status, 0, accepted.stderr);
  const acceptedId = extractId(accepted.stdout);

  const proposedForRejection = run(['principles', 'add', statement, '--kind', 'principle', '--propose'], dir, home);
  assert.strictEqual(proposedForRejection.status, 0, proposedForRejection.stderr);
  const rejectedId = extractId(proposedForRejection.stdout);
  const reject = run(['principles', 'reject', rejectedId, '--reason', 'too broad as stated'], dir, home);
  assert.strictEqual(reject.status, 0, reject.stderr);

  const proposedForAmend = run(['principles', 'add', statement, '--kind', 'principle', '--propose'], dir, home);
  assert.strictEqual(proposedForAmend.status, 0, proposedForAmend.stderr);
  const amendedId = extractId(proposedForAmend.stdout);
  const accept2 = run(['principles', 'accept', amendedId], dir, home);
  assert.strictEqual(accept2.status, 0, accept2.stderr);
  const amend = run(['principles', 'amend', amendedId, '--reason', 'clarify', '--statement', `${statement}, always`], dir, home);
  assert.strictEqual(amend.status, 0, amend.stderr);

  const entryFile = (id) => join(storeDir(home), `${id}.md`);
  const before = {
    accepted: readFileSync(entryFile(acceptedId), 'utf8'),
    rejected: readFileSync(entryFile(rejectedId), 'utf8'),
    amended: readFileSync(entryFile(amendedId), 'utf8'),
  };
  const acceptedFilesBefore = readdirSync(storeDir(home)).filter((f) => f.endsWith('.md'));

  const filled = fillPlaceholders(rawLine, {
    statement,
    kind: 'principle',
    why: 'the propose path is the only way in',
    project: 'astro-code',
    ref: 'phase 3',
    excerpt: 'never write directly under the store, in the user own words',
  });
  const argv = tokenize(filled).slice(1);
  const rerun = run(argv, dir, home);
  assert.strictEqual(rerun.status, 0, `re-running the invocation must exit 0 — stderr:\n${rerun.stderr}`);

  assert.strictEqual(readFileSync(entryFile(acceptedId), 'utf8'), before.accepted, 'the accepted entry must stay byte-identical');
  assert.strictEqual(readFileSync(entryFile(rejectedId), 'utf8'), before.rejected, 'the rejected entry must stay byte-identical');
  assert.strictEqual(readFileSync(entryFile(amendedId), 'utf8'), before.amended, 'the amended entry must stay byte-identical');

  const newId = extractId(rerun.stdout);
  assert.ok(newId && newId !== acceptedId && newId !== rejectedId && newId !== amendedId, 're-running must mint a fresh entry, never target an existing one');
  const newEntry = JSON.parse(run(['principles', 'show', newId, '--json'], dir, home).stdout);
  assert.strictEqual(newEntry.status, 'proposed', 're-running the invocation must never mint a new ACCEPTED entry — only a proposal');

  const acceptedFilesAfter = readdirSync(storeDir(home)).filter((f) => f.endsWith('.md'));
  assert.strictEqual(acceptedFilesAfter.length, acceptedFilesBefore.length + 1, 'exactly one new file — the fresh proposal — must have been added');
});
