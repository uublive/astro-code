// Phase 41 — the witness mod's pure helpers (ADR-074 amends ADR-033).
// RED first (ADR-018): hooks/lib/gates.js does not exist yet, so every symbol arrives through
// `await import(...)` inside an async body and a missing module fails each test on its own.
//
// gates.js is plain values in, plain values out: no `$`, no event, no imports. The pure rules
// pinned here are the gate table (which typed command unlocks which `ac` gate), the Bash
// parser/rewriter (catching mistakes, not a sandbox) and the CONTEXT.md marker rewrite.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyContext } from '../lib/planning.mjs';

const GATES_URL = '../mods/astro-mods/hooks/lib/gates.js';
const gates = () => import(GATES_URL);

// ── parseTyped: the slash form, from `command.run` { command, args } ────────

test('parseTyped: /astro-accept unlocks phase accept and phase reject for that phase', async () => {
  const { parseTyped, idsMatch } = await gates();
  for (const args of ['41', '41-witness-mod-x']) {
    const t = parseTyped('astro-accept', args);
    assert.deepStrictEqual(t.gates, ['phase accept', 'phase reject']);
    assert.strictEqual(t.kind, 'phase');
    assert.ok(idsMatch('phase', t.id, '41'), `${args} must mean phase 41`);
  }
});

test('parseTyped: /astro-fix-accept unlocks fix accept; /astro-discuss unlocks the discuss marker', async () => {
  const { parseTyped } = await gates();
  const fix = parseTyped('astro-fix-accept', '2026-10-11-foo');
  assert.deepStrictEqual(fix.gates, ['fix accept']);
  assert.strictEqual(fix.kind, 'fix');
  assert.strictEqual(fix.id, '2026-10-11-foo');
  const discuss = parseTyped('astro-discuss', '41 --challenge');
  assert.deepStrictEqual(discuss.gates, ['discuss marker']);
  assert.strictEqual(discuss.kind, 'phase');
  assert.strictEqual(discuss.id, '41');
});

test('parseTyped: a typed gate command with no id has an undetermined id, never a guess', async () => {
  const { parseTyped } = await gates();
  for (const c of ['astro-accept', 'astro-fix-accept', 'astro-discuss']) {
    const t = parseTyped(c, '');
    assert.ok(t, `${c} is still a gate command`);
    assert.strictEqual(t.id, null);
  }
});

test('parseTyped: every other command unlocks nothing', async () => {
  const { parseTyped } = await gates();
  assert.strictEqual(parseTyped('astro-autonomous', ''), null);
  assert.strictEqual(parseTyped('astro-status', ''), null);
  assert.strictEqual(parseTyped('compact', ''), null);
});

// ── parseBang: the `!` form, from a composer `prompt.submit` { text } ───────

test('parseBang: a ! gate command unlocks exactly that gate and id', async () => {
  const { parseBang, idsMatch } = await gates();
  const a = parseBang('! ac phase accept 41');
  assert.deepStrictEqual(a.gates, ['phase accept']);
  assert.ok(idsMatch('phase', a.id, '41'));
  const r = parseBang('!ac phase reject 41');
  assert.deepStrictEqual(r.gates, ['phase reject']);
  const f = parseBang('! ac fix accept foo');
  assert.deepStrictEqual(f.gates, ['fix accept']);
  assert.strictEqual(f.id, 'foo');
});

test('parseBang: anything else is null', async () => {
  const { parseBang } = await gates();
  for (const text of ['hello', '! ls', '/astro-accept 41', '', 'ac phase accept 41']) {
    assert.strictEqual(parseBang(text), null, JSON.stringify(text));
  }
});

// ── findGates: the Bash parser ──────────────────────────────────────────────

test('findGates: one clean gate segment is found, with the ref and its end offset', async () => {
  const { findGates } = await gates();
  const table = [
    ['ac phase accept 41', 'phase accept', '41'],
    ['ac phase accept 41-witness-mod-detect-human-vs-agent --by me', 'phase accept', '41-witness-mod-detect-human-vs-agent'],
    ['cd /x && ac phase accept 41', 'phase accept', '41'],
    ['FOO=1 ac phase reject 41 --reason "it\'s broken; really"', 'phase reject', '41'],
    ['node /abs/bin/ac.mjs fix accept 2026-10-11-foo', 'fix accept', '2026-10-11-foo'],
    ['/abs/ac phase accept 41 # note', 'phase accept', '41'],
    ['ac phase accept 41 2>&1 | tail -1', 'phase accept', '41'],
  ];
  for (const [cmd, gate, ref] of table) {
    const hit = findGates(cmd);
    assert.strictEqual(hit.kind, 'one', cmd);
    assert.strictEqual(hit.gate, gate, cmd);
    assert.strictEqual(hit.ref, ref, cmd);
    assert.ok(cmd.slice(0, hit.refEnd).endsWith(ref), `${cmd}: refEnd must sit right after the ref`);
  }
});

test('findGates: a command that merely mentions a gate is none', async () => {
  const { findGates } = await gates();
  for (const cmd of ['git commit -m "ac phase accept 41"', 'ac phase verify 41', 'ac fix show x', 'echo phase accept']) {
    assert.strictEqual(findGates(cmd).kind, 'none', cmd);
  }
});

test('findGates: what it cannot read with confidence is ambiguous, never guessed', async () => {
  const { findGates } = await gates();
  for (const cmd of [
    'ac phase accept 41 && ac fix accept foo',
    'ac phase accept --force 41',
    'ac phase accept $N',
    "bash -c 'ac phase accept 41'",
    "lean-ctx -c 'ac phase accept 41'",
    'echo $(ac phase accept 41)',
  ]) {
    assert.strictEqual(findGates(cmd).kind, 'ambiguous', cmd);
  }
});

// ── rewriteGate: a pure splice by offsets ───────────────────────────────────

test('rewriteGate: adds a flag right after the ref and touches nothing else', async () => {
  const { findGates, rewriteGate } = await gates();
  const cases = [
    ['ac phase accept 41 --by me', '--witnessed composer', 'ac phase accept 41 --witnessed composer --by me'],
    ['cd x && ac phase accept 41 2>&1 | tail -1', '--agent claude', 'cd x && ac phase accept 41 --agent claude 2>&1 | tail -1'],
  ];
  for (const [cmd, add, want] of cases) {
    const out = rewriteGate(cmd, findGates(cmd), { add });
    assert.strictEqual(out, want);
    assert.strictEqual(out.replace(` ${add}`, ''), cmd, 'the output differs from the input only at the splice');
  }
});

test('rewriteGate: strips a model-supplied --witnessed and its value before adding --agent', async () => {
  const { findGates, rewriteGate } = await gates();
  const cmd = 'ac phase accept 41 --witnessed composer --by me';
  const out = rewriteGate(cmd, findGates(cmd), { add: '--agent claude', strip: ['--witnessed'] });
  assert.strictEqual(out, 'ac phase accept 41 --agent claude --by me');
});

// ── idsMatch ────────────────────────────────────────────────────────────────

test('idsMatch: phases compare by their leading integer', async () => {
  const { idsMatch } = await gates();
  assert.ok(idsMatch('phase', '41', '041'));
  assert.ok(idsMatch('phase', '41', '41-x'));
  assert.ok(idsMatch('phase', '41-witness-mod', '41'));
  assert.ok(!idsMatch('phase', '41', '14'));
  assert.ok(!idsMatch('phase', '41', '4'));
});

test('idsMatch: a fix matches the exact id, or <date>-<typed slug>; never a longer slug or a bare ref', async () => {
  const { idsMatch } = await gates();
  // phase 41 verify C3: `ac fix accept sample-bug` can resolve to 2026-10-12-other-sample-bug
  assert.ok(idsMatch('fix', '2026-10-11-foo', '2026-10-11-foo'));
  assert.ok(idsMatch('fix', 'foo', 'foo'));
  assert.ok(idsMatch('fix', 'foo', '2026-10-11-foo'), 'the slug /astro-fix-accept documents, run with its date');
  assert.ok(idsMatch('fix', 'sample-bug', '2026-10-12-sample-bug'));
  assert.ok(!idsMatch('fix', 'sample-bug', '2026-10-12-other-sample-bug'), 'a longer slug that ends with it is another fix');
  assert.ok(!idsMatch('fix', '2026-10-11-foo', 'foo'), 'the dated id is not a bare ref');
  assert.ok(!idsMatch('fix', '2026-10-12-sample-bug', 'sample-bug'));
  assert.ok(!idsMatch('fix', 'fo', '2026-10-11-foo'), 'a fragment is not the slug');
  assert.ok(!idsMatch('fix', 'foo-bar', 'foo'));
});

test('idsMatch: an undetermined id never matches', async () => {
  const { idsMatch } = await gates();
  assert.ok(!idsMatch('phase', null, '41'));
  assert.ok(!idsMatch('fix', null, 'foo'));
});

// ── the CONTEXT.md marker ───────────────────────────────────────────────────

test('markerRewrite: a Write whose first line is the human marker becomes the agent marker', async () => {
  const { markerRewrite, AGENT_MARKER } = await gates();
  const out = markerRewrite({ tool: 'Write', content: '<!-- astro-discuss: captured -->\n# T\nbody\n' });
  assert.strictEqual(out, `${AGENT_MARKER}\n# T\nbody\n`);
});

test('markerRewrite: CRLF and leading blank lines are kept', async () => {
  const { markerRewrite, AGENT_MARKER } = await gates();
  assert.strictEqual(
    markerRewrite({ tool: 'Write', content: '<!-- astro-discuss: captured -->\r\n# T\r\n' }),
    `${AGENT_MARKER}\r\n# T\r\n`,
  );
  assert.strictEqual(
    markerRewrite({ tool: 'Write', content: '\n\n<!-- astro-discuss: captured -->\n# T\n' }),
    `\n\n${AGENT_MARKER}\n# T\n`,
    'classifyContext counts the first NON-BLANK line, so witness does too',
  );
});

test('markerRewrite: an agent marker is never upgraded, and a Write marker on any line is rewritten', async () => {
  const { markerRewrite, AGENT_MARKER } = await gates();
  assert.strictEqual(markerRewrite({ tool: 'Write', content: `${AGENT_MARKER}\n# T\n` }), null);
  assert.strictEqual(markerRewrite({ tool: 'Write', content: '<!-- astro-discuss: captured by agent: bob -->\n' }), null);
  assert.strictEqual(markerRewrite({ tool: 'Write', content: '# T\nx\n<!-- astro-discuss: captured by agent: bob -->\n' }), null);
});

test('markerRewrite: an Edit reads new_string, and only its first line counts', async () => {
  const { markerRewrite, AGENT_MARKER } = await gates();
  assert.strictEqual(
    markerRewrite({ tool: 'Edit', new_string: '<!-- astro-discuss: captured -->\nmore\n' }),
    `${AGENT_MARKER}\nmore\n`,
  );
  assert.strictEqual(markerRewrite({ tool: 'Edit', new_string: 'intro\n<!-- astro-discuss: captured -->\n' }), null);
  assert.strictEqual(markerRewrite({ tool: 'Read', content: '<!-- astro-discuss: captured -->\n' }), null);
});

test('drift: the plugin copy of the human-marker rule agrees with lib/planning.mjs on every variant', async () => {
  const { isHumanMarkerLine, markerRewrite, AGENT_MARKER } = await gates();
  const variants = [
    '<!-- astro-discuss: captured -->',
    '<!--astro-discuss:captured-->',
    '<!--   astro-discuss:   captured   -->',
    '<!-- ASTRO-DISCUSS: CAPTURED -->',
    '  <!-- astro-discuss: captured -->  ',
    '<!-- astro-discuss: captured by agent: claude -->',
    '<!-- astro-discuss: captured by agent claude -->',
    '<!-- astro-discuss: captured by claude -->',
    '<!-- astro-discuss: captured extra -->',
    '<!-- astro-discuss: captured --> trailing',
    '# heading',
    '',
  ];
  for (const line of variants) {
    assert.strictEqual(isHumanMarkerLine(line), classifyContext(line).kind === 'human', JSON.stringify(line));
  }
  const rewritten = markerRewrite({ tool: 'Write', content: '<!-- astro-discuss: captured -->\n# T\n' });
  assert.deepStrictEqual(classifyContext(rewritten), { kind: 'agent', author: 'claude' });
  assert.strictEqual(classifyContext(AGENT_MARKER).kind, 'agent');
});

test('AGENT_NAME carries no > (debt 2026-09-24-a-in-the-agent-name-in-a-context-marker)', async () => {
  const { AGENT_NAME, AGENT_MARKER } = await gates();
  assert.ok(AGENT_NAME && !AGENT_NAME.includes('>'));
  assert.ok(AGENT_MARKER.includes(AGENT_NAME));
});

test('GATES is frozen: the one table', async () => {
  const { GATES } = await gates();
  assert.ok(Object.isFrozen(GATES));
});

// ── isPhaseContextPath ──────────────────────────────────────────────────────

test('isPhaseContextPath: only a phase directory CONTEXT.md names a phase', async () => {
  const { isPhaseContextPath } = await gates();
  assert.strictEqual(isPhaseContextPath('/a/.astrocode/phases/41-x/CONTEXT.md'), 41);
  assert.strictEqual(isPhaseContextPath('C:\\a\\.astrocode\\phases\\41-x\\CONTEXT.md'), 41);
  for (const p of ['/a/.astrocode/CONTEXT.md', '/a/phases/41-x/CONTEXT.md', '/a/.astrocode/phases/41-x/PLAN.md', undefined, 42]) {
    assert.strictEqual(isPhaseContextPath(p), null, String(p));
  }
});

test('markerRewrite: only the first non-blank line is a provenance claim; a marker later in the body is left alone (C6 d)', async () => {
  const { markerRewrite, AGENT_MARKER } = await gates();
  assert.strictEqual(markerRewrite({ tool: 'Write', content: '# T\n<!-- astro-discuss: captured -->\nbody\n' }), null);
  // line 1 is rewritten, a marker quoted in the body stays byte-identical (phase 41 verify C6)
  const body = 'The human marker `<!-- astro-discuss: captured -->` means a human captured it.';
  assert.strictEqual(
    markerRewrite({ tool: 'Write', content: `<!-- astro-discuss: captured -->\n# T\n\n${body}\n` }),
    `${AGENT_MARKER}\n# T\n\n${body}\n`);
});

test('idsMatch: two dated fixes match only on the same date', async () => {
  const { idsMatch } = await gates();
  assert.ok(!idsMatch('fix', '2026-10-01-foo-bar', '2026-09-01-foo-bar'));
  assert.ok(idsMatch('fix', '2026-10-01-foo-bar', '2026-10-01-foo-bar'));
});

test('rewriteRaw / segmentDeclaresAgent: unreadable gate calls and empty --agent values', async () => {
  const { rewriteRaw, findGates, segmentDeclaresAgent } = await gates();
  assert.strictEqual(rewriteRaw('ac phase accept 41 && ac phase accept 42'), 'ac phase accept 41 --agent claude && ac phase accept 42 --agent claude');
  assert.strictEqual(rewriteRaw('bash -c "ac phase accept 41"'), 'bash -c "ac phase accept 41 --agent claude"');
  assert.strictEqual(rewriteRaw('N=41; ac phase accept $N'), 'N=41; ac phase accept $N --agent claude');
  assert.strictEqual(rewriteRaw('ac phase accept 41 --agent bob && ls'), null);
  assert.ok(!segmentDeclaresAgent(findGates('ac phase accept 45 --agent')));
  assert.ok(!segmentDeclaresAgent(findGates('ac phase accept 41 --agent ""')));
  assert.ok(segmentDeclaresAgent(findGates('ac phase accept 41 --agent bob')));
});

test('editRewrite: an Edit that leaves line 1 claiming human provenance becomes a whole-file replacement (phase 41 C6)', async () => {
  const { editRewrite, AGENT_MARKER } = await gates();
  const file = `${AGENT_MARKER}\n# C\n`;
  assert.deepStrictEqual(editRewrite(file, { old_string: ' by agent: claude', new_string: '' }), { old_string: file, new_string: file, replace_all: false });
  assert.deepStrictEqual(editRewrite(file, { old_string: AGENT_MARKER, new_string: '\n<!-- astro-discuss: captured -->' }), { old_string: file, new_string: `\n${AGENT_MARKER}\n# C\n`, replace_all: false });
  assert.strictEqual(editRewrite(file, { old_string: '# C', new_string: '# Context' }), null, 'an ordinary edit is left alone');
  assert.strictEqual(editRewrite(file, { old_string: 'missing', new_string: 'x' }), null, 'an Edit that does not apply is left alone');
  assert.strictEqual(editRewrite('<!-- astro-discuss: captured -->\n# C\n', { old_string: '# C', new_string: '# D' }), null, 'already human: not this Edit\'s claim');
});

test('isPhaseContextPath: //, /./, /../ and case still name the phase CONTEXT.md (phase 41 C6)', async () => {
  const { isPhaseContextPath } = await gates();
  for (const p of ['/w/.astrocode/phases//41-x/CONTEXT.md', '/w/.astrocode/phases/41-x/./CONTEXT.md',
    '/w/.astrocode/phases/41-x/../41-x/CONTEXT.md', '/w/.astrocode/phases/41-x/context.md']) {
    assert.strictEqual(isPhaseContextPath(p), 41, p);
  }
  assert.strictEqual(isPhaseContextPath('/w/.astrocode/phases/41-x/PLAN.md'), null);
});

test('signSegments: a quoted or continued gate verb is still signed as the agent, and loses --witnessed (phase 41 C2/C3)', async () => {
  const { signSegments } = await gates();
  assert.strictEqual(signSegments('node --no-warnings bin/ac.mjs phase "accept" 41 --witnessed composer'), 'node --no-warnings bin/ac.mjs phase "accept" 41 --agent claude');
  assert.strictEqual(signSegments('node bin/ac.mjs phase \\\naccept 41 --witnessed composer'), 'node bin/ac.mjs phase \\\naccept 41 --agent claude');
  assert.strictEqual(signSegments('ac fix "accept" sample-bug --witnessed "composer" && ls'), 'ac fix "accept" sample-bug --agent claude && ls');
  assert.strictEqual(signSegments('ac phase accept "41" --agent bot'), null, 'a declared agent is left alone');
  assert.strictEqual(signSegments('ls -la'), null);
});

// ── phase 46: quoted mention behind an ac head, variable verbs, --witnessed dropping, Bash marker ──

test('C11: an ADR title that quotes a gate with escaped quotes is a mention, not a gate (ADR-080 corruption)', async () => {
  const { onlyQuotedMention, findGates } = await gates();
  const adr = 'ac decision add "A human gate (phase accept/reject, fix accept) may cite a decision made elsewhere with --evidence \\"<id or URL>\\", stored beside the record; a citation never makes the signer human"';
  assert.strictEqual(onlyQuotedMention(adr), true);
  assert.strictEqual(findGates(adr).kind, 'none');
  assert.strictEqual(onlyQuotedMention('git commit -m "docs: say \\"ac phase accept 41\\" in the manual"'), true);
  assert.strictEqual(onlyQuotedMention('ac decision add "say \\"phase accept 41\\" here"'), true);
});

test('C11: a real gate stays a non-mention, however it hides', async () => {
  const { onlyQuotedMention, findGates } = await gates();
  assert.strictEqual(onlyQuotedMention('ac "phase" "accept" 4'), false);
  assert.strictEqual(onlyQuotedMention('ac decision add x; ac phase accept 4'), false);
  assert.strictEqual(onlyQuotedMention('ac $X accept 41'), false);
  const hit = findGates('echo "say \\"hi\\"" && ac phase accept 41');
  assert.strictEqual(hit.kind, 'one');
  assert.strictEqual(hit.ref, '41');
});

test('C10: a gate verb held in a variable is ambiguous, VAR_VERB, and signed as the agent on the ac segment only', async () => {
  const { findGates, VAR_VERB, signSegments } = await gates();
  const cases = [
    ['V=accept; ac phase $V 41', 'V=accept; ac phase $V 41 --agent claude'],
    ['V=accept && ac phase "$V" 41', 'V=accept && ac phase "$V" 41 --agent claude'],
    ['export V=reject; ac phase $V 41 --reason x', 'export V=reject; ac phase $V 41 --reason x --agent claude'],
    ['G=accept; ac fix $G 2026-10-01-foo', 'G=accept; ac fix $G 2026-10-01-foo --agent claude'],
    ['ac $X accept 41', 'ac $X accept 41 --agent claude'],
  ];
  for (const [cmd, signed] of cases) {
    assert.strictEqual(findGates(cmd).kind, 'ambiguous', cmd);
    assert.ok(VAR_VERB.test(cmd), cmd);
    assert.strictEqual(signSegments(cmd), signed, cmd);
  }
  assert.notStrictEqual(findGates('ac phase show $N').kind, 'ambiguous');
  assert.ok(!VAR_VERB.test('ac phase show $N'));
});

test('C9: dropWitnessed removes every --witnessed form and says null when there was none', async () => {
  const { dropWitnessed, rewriteRaw } = await gates();
  assert.strictEqual(dropWitnessed('ac phase accept 41 --witnessed composer'), 'ac phase accept 41');
  assert.strictEqual(dropWitnessed('ac phase accept 41 --witnessed=composer'), 'ac phase accept 41');
  assert.strictEqual(dropWitnessed('ac phase accept 41 --witnessed "composer"'), 'ac phase accept 41');
  assert.strictEqual(dropWitnessed("ac phase accept 41 --witnessed 'composer' --reason x"), 'ac phase accept 41 --reason x');
  assert.strictEqual(dropWitnessed('ac phase accept 41 --witnessed --reason x'), 'ac phase accept 41 --reason x', 'a bare flag never eats the next flag');
  assert.strictEqual(dropWitnessed('ac phase accept 41'), null);
  assert.strictEqual(rewriteRaw('ac phase accept 41 --witnessed composer && ls'), 'ac phase accept 41 --agent claude && ls');
});

test('C8: a Bash write of the human CONTEXT.md marker is rewritten to the agent marker, every other byte intact', async () => {
  const { bashMarkerRewrite, AGENT_MARKER } = await gates();
  const H = '<!-- astro-discuss: captured -->';
  const ctx = '.astrocode/phases/41-x/CONTEXT.md';
  for (const cmd of [
    `printf '${H}\\nbody\\n' > ${ctx}`,
    `sed -i '1s/.*/${H}/' ${ctx}`,
    `cat > ${ctx} <<'EOF'\n${H}\nbody\nEOF`,
  ]) {
    const r = bashMarkerRewrite(cmd);
    assert.deepStrictEqual(r.phases, [41], cmd);
    assert.strictEqual(r.command, cmd.replace(H, AGENT_MARKER));
  }
  assert.strictEqual(bashMarkerRewrite(`printf 'hello' > ${ctx}`), null, 'no marker');
  assert.strictEqual(bashMarkerRewrite(`printf '${H}' > notes/CONTEXT.md`), null, 'not a phase CONTEXT.md');
  assert.strictEqual(bashMarkerRewrite(`printf '${AGENT_MARKER}' > ${ctx}`), null, 'already the agent marker');
});

test('C4: rewriteGate leaves a --evidence citation byte-identical, and a citation never hides or fakes a gate', async () => {
  const { findGates, rewriteGate } = await gates();
  const ev = '--evidence "https://board.example/d/42?x=1&y=2"';
  const cmd = `ac phase accept 41 ${ev}`;
  const hit = findGates(cmd);
  assert.strictEqual(hit.kind, 'one');
  assert.strictEqual(rewriteGate(cmd, hit, { add: '--witnessed composer' }), `ac phase accept 41 --witnessed composer ${ev}`);
  const both = `ac phase accept 41 --witnessed composer --agent bob ${ev}`;
  assert.strictEqual(rewriteGate(both, findGates(both), { strip: ['--witnessed', '--agent'], add: '--agent claude' }), `ac phase accept 41 --agent claude ${ev}`);
  const sneaky = findGates('ac phase accept 41 --evidence "see phase accept 12"');
  assert.strictEqual(sneaky.kind, 'one');
  assert.strictEqual(sneaky.ref, '41');
});

test('C8/C10 remediation: cd, variable-path and printf-format marker writes, and variable verbs, are signed as the agent', async () => {
  const { bashMarkerRewrite, signSegments, VAR_VERB, AGENT_MARKER } = await gates();
  const H = '<!-- astro-discuss: captured -->';
  const a = bashMarkerRewrite(`cd .astrocode/phases/01-thing-one && printf '${H}\\nbody\\n' > CONTEXT.md`);
  assert.ok(a.unknown && a.command.includes(AGENT_MARKER));
  const b = bashMarkerRewrite(`P=.astrocode/phases/41-x/CONTEXT.md; printf '${H}\\nbody\\n' > $P`);
  assert.deepStrictEqual(b.phases, [41]);
  const c = bashMarkerRewrite(`printf '<!-- astro-discuss: %s -->\\n' captured > .astrocode/phases/41-x/CONTEXT.md`);
  assert.strictEqual(c.command, `printf '<!-- astro-discuss: %s -->\\n' captured\\ by\\ agent:\\ claude > .astrocode/phases/41-x/CONTEXT.md`);
  assert.strictEqual(bashMarkerRewrite(`printf '${H}' > notes/CONTEXT.md`), null);
  assert.ok(VAR_VERB.test('ac $P $V 1'));
  assert.strictEqual(signSegments('V=accept; P=phase; ac $P $V 1'), 'V=accept; P=phase; ac $P $V 1 --agent claude');
  assert.strictEqual(signSegments('export V="phase accept" --agent claude; ac $V 1'), 'export V="phase accept" --agent claude; ac $V 1 --agent claude');
  assert.strictEqual(signSegments('declare V="phase accept" --agent claude; ac $V 1'), 'declare V="phase accept" --agent claude; ac $V 1 --agent claude');
});

// Phase 46 re-verify (C8/C10, narrowed by the user to plain spellings): each command below ran in a
// real shell. The marker cases are judged by EFFECT (effectGuard), so the spelling no longer matters.
test('C8: a Bash write judged by its effect on line 1: sed -i 1d, an escaped marker, a copy from /tmp end with the agent marker', async () => {
  const { effectGuard, bashMarkerRewrite, AGENT_MARKER } = await gates();
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const H = '<!-- astro-discuss: captured -->';
  const ctx = '.astrocode/phases/41-x/CONTEXT.md';
  const run = (seed, cmd) => {
    const d = mkdtempSync(join(tmpdir(), 'w46-'));
    mkdirSync(join(d, '.astrocode/phases/41-x'), { recursive: true });
    if (seed !== null) writeFileSync(join(d, ctx), seed);
    // BSD sed (macOS) needs a backup-suffix argument after -i; GNU sed forbids a separate one
    const bsd = process.platform === 'darwin' ? `sed() { if [ "$1" = -i ]; then shift; command sed -i '' "$@"; else command sed "$@"; fi; }; ` : '';
    const r = spawnSync('bash', ['-c', bsd + cmd], { cwd: d, encoding: 'utf8' });
    return { status: r.status, text: readFileSync(join(d, ctx), 'utf8') };
  };
  const agentLine1 = (text) => text.split('\n')[0] === AGENT_MARKER;
  for (const [seed, cmd] of [
    [`x\n${H}\nbody\n`, `sed -i '1d' ${ctx}`],
    [`<!-- astro-discuss: captured by agent: seed -->\nbody\n`, `sed -i 's/ by agent: seed//' ${ctx}`],
    ['old\n', `printf '<!-- astro-discuss: capt\\x75red -->\\nbody\\n' > ${ctx}`],
    ['old\n', `printf '<!-- astro-discuss: capt''ured -->\\nbody\\n' > ${ctx}`],
    ['old\n', `echo -e '<!-- astro-discuss: capt\\x75red -->' > ${ctx}`],
    [null, `printf '${H}\\nbody\\n' > m.md; cp m.md ${ctx}`],
  ]) {
    const g = effectGuard(cmd);
    assert.ok(g, cmd);
    const r = run(seed, g);
    assert.equal(r.status, 0, cmd);
    assert.ok(agentLine1(r.text), `${cmd} -> ${JSON.stringify(r.text)}`);
    assert.ok(r.text.includes('body') || seed?.includes('body') === false, cmd);
  }
  // a file that already carried the human marker stays human after an agent's body edit (no false demotion)
  assert.equal(run(`${H}\nbody\n`, effectGuard(`sed -i 's/body/text/' ${ctx}`)).text, `${H}\ntext\n`);
  // the exit status is the command's own
  assert.equal(run('x\n', effectGuard(`printf y > ${ctx}; false`)).status, 1);
  // a read names the file but cannot write it: left alone
  assert.equal(effectGuard(`cat ${ctx}`), null);
  // printf with inner quotes: the rewrite keeps the format one word, so the body survives
  const q = bashMarkerRewrite(`printf "<!-- astro-discuss: "captured" -->\\nbody\\n" > ${ctx}`);
  const r = run('old\n', q.command);
  assert.equal(r.text, `${AGENT_MARKER}\nbody\n`);
});

test('C10: an expansion anywhere in the verb, eval, an xargs slot and a subshell are signed, and the command still runs', async () => {
  const { VAR_VERB, signSegments } = await gates();
  const { spawnSync } = await import('node:child_process');
  const cases = {
    'V=ept; ac phase acc$V 41': 'V=ept; ac phase acc$V 41 --agent claude',
    'V=ept; ac phase "acc$V" 41': 'V=ept; ac phase "acc$V" 41 --agent claude',
    'V=accept; eval "ac phase $V 41"': 'V=accept; eval "ac phase $V 41" --agent claude',
    'V=accept; xargs -I{} ac phase {} 41 <<< $V': 'V=accept; xargs -I{} ac phase {} 41 <<< $V --agent claude',
    'V=accept; (ac phase $V 41)': 'V=accept; (ac phase $V 41 --agent claude)',
    '(cd x; ac phase $V 41)': '(cd x; ac phase $V 41 --agent claude)',
  };
  for (const [cmd, signed] of Object.entries(cases)) {
    assert.ok(VAR_VERB.test(cmd), cmd);
    assert.equal(signSegments(cmd), signed, cmd);
  }
  // what ac receives, with `ac` a function that prints its arguments
  const argsOf = (cmd) => spawnSync('bash', ['-c', `ac() { echo "$*"; }; export -f ac; ${cmd}`], { encoding: 'utf8' }).stdout.trim();
  assert.equal(argsOf(signSegments('V=accept; (ac phase $V 41)')), 'phase accept 41 --agent claude');
  assert.equal(argsOf(signSegments('V=accept; eval "ac phase $V 41"')), 'phase accept 41 --agent claude');
  assert.equal(argsOf(signSegments('V=ept; ac phase acc$V 41')), 'phase accept 41 --agent claude');
  assert.ok(!VAR_VERB.test('ac phase show 41') && !VAR_VERB.test('ac phase show $N'));
  // inside a shell -c string the signature goes in the string: after it, it would be the inner $0
  const sh = {
    'V=accept; bash -c "ac phase $V 1"': 'V=accept; bash -c "ac phase $V 1 --agent claude"',
    "export V=accept; bash -c 'ac phase $V 1'": "export V=accept; bash -c 'ac phase $V 1 --agent claude'",
    'V=accept; bash -lc "ac phase $V 1"': 'V=accept; bash -lc "ac phase $V 1 --agent claude"',
    'V=accept; sh -c "ac phase $V 1"': 'V=accept; sh -c "ac phase $V 1 --agent claude"',
    // run 4: any shell path or prefix, a compound body, a word after the string
    'V=accept; /bin/bash -c "ac phase $V 1"': 'V=accept; /bin/bash -c "ac phase $V 1 --agent claude"',
    'V=accept; bash -c "cd . && ac phase $V 1"': 'V=accept; bash -c "cd . && ac phase $V 1 --agent claude"',
    'V=accept; env bash -c "ac phase $V 1"': 'V=accept; env bash -c "ac phase $V 1 --agent claude"',
    'V=accept; bash -c "ac phase $V 1" x': 'V=accept; bash -c "ac phase $V 1 --agent claude" x',
  };
  for (const [cmd, signed] of Object.entries(sh)) assert.equal(signSegments(cmd), signed, cmd);
  const { onlyQuotedMention } = await gates();
  assert.equal(onlyQuotedMention('V=accept; /bin/bash -c "ac phase $V 1"'), false, 'a shell by path runs its string');
  // executed: the inner shell's `ac` (exported by argsOf) receives the signature
  for (const cmd of ['V=accept; /bin/bash -c "ac phase $V 1"', 'V=accept; bash -c "cd . && ac phase $V 1"', 'V=accept; bash -c "ac phase $V 1" x']) {
    assert.equal(argsOf(signSegments(cmd)), 'phase accept 1 --agent claude', cmd);
  }
  assert.equal(argsOf('export V=accept; ' + "bash -c 'ac() { echo \"$*\"; }; ac phase $V 1 --agent claude'"), 'phase accept 1 --agent claude');
});

test('C4: --evidence before the ref: the ref is still found and witness signs after it, so the call still runs', async () => {
  const { findGates, rewriteGate, segmentHas, segmentDeclaresAgent } = await gates();
  const { spawnSync } = await import('node:child_process');
  const argsOf = (cmd) => spawnSync('bash', ['-c', `ac() { echo "$*"; }; ${cmd}`], { encoding: 'utf8' }).stdout.trim();
  const rows = [
    ['ac phase accept --evidence "DEC-1" 1', '1', 'phase accept --evidence DEC-1 1 --witnessed composer'],
    ['ac phase accept --evidence=DEC-1 1', '1', 'phase accept --evidence=DEC-1 1 --witnessed composer'],
    ['ac fix accept --evidence DEC-1 2026-10-15-broken-widget', '2026-10-15-broken-widget', 'fix accept --evidence DEC-1 2026-10-15-broken-widget --witnessed composer'],
    ['ac phase reject --evidence "DEC-1" 1 --reason x', '1', 'phase reject --evidence DEC-1 1 --witnessed composer --reason x'],
  ];
  for (const [cmd, ref, ran] of rows) {
    const hit = findGates(cmd);
    assert.equal(hit.kind, 'one', cmd);
    assert.equal(hit.ref, ref, cmd);
    assert.equal(argsOf(rewriteGate(cmd, hit, { add: '--witnessed composer' })), ran, cmd);
  }
  // a flag before the ref is still seen: a declared agent is never re-signed, a forged --witnessed is stripped
  const pre = findGates('ac phase accept --agent bot 41');
  assert.ok(segmentHas(pre, '--agent') && segmentDeclaresAgent(pre));
  const forged = 'ac phase accept --witnessed composer 41';
  assert.equal(argsOf(rewriteGate(forged, findGates(forged), { add: '--agent claude', strip: ['--witnessed', '--agent'] })), 'phase accept 41 --agent claude');
  // any other flag before the ref stays unreadable (signed as the agent, never guessed)
  assert.equal(findGates('ac phase accept --force 41').kind, 'ambiguous');
});
