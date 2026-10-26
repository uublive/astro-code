// Shared scaffolding for the phase-51 calibration tests: a real tmp git project with accepted
// (complete) phases carrying kept `ac mutate` runs in the P1 format, a pending and a verified phase
// that carry traps, and a stand-in `claude` that records everything the verifier could see.
// Test infrastructure only; it holds no assertions.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { initPlanning } from '../../../lib/planning.mjs';
import { addPhase, findPhase, setPhaseStatus } from '../../../lib/roadmap.mjs';

export const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (dir, f, body) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), body); };
const sha12 = (...p) => createHash('sha1').update(p.join('\0')).digest('hex').slice(0, 12);

// ---- Source generators: line numbers and columns are computed, never typed ----

// JS: one function per mutant, on its own line. Stryker location is 1-based, end exclusive.
function jsSource(n, tag) {
  const lines = Array.from({ length: n }, (_, i) => `export function ${tag}${i}(a) { return a + ${i}; }`);
  const mutant = (i) => {
    const text = lines[i];
    const expr = `a + ${i}`;
    const col = text.indexOf(expr) + 1;
    return { line: i + 1, replacement: `a - ${i}`, loc: { start: { line: i + 1, column: col }, end: { line: i + 1, column: col + expr.length } }, fn: `${tag}${i}`, text };
  };
  return { text: `${lines.join('\n')}\n`, mutant };
}

// Python: a def and an indented return per mutant; the mutated line is the return.
function pySource(n, tag) {
  const lines = [];
  for (let i = 0; i < n; i += 1) lines.push(`def ${tag}${i}(x):`, `    return x + ${i}`);
  const mutant = (i) => ({ line: 2 * i + 2, line_text: `    return x + ${i}`, replacement_line: `    return x - ${i}`, fn: `${tag}${i}` });
  return { text: `${lines.join('\n')}\n`, mutant };
}

const CRITERIA = (name) => `# ${name} — success criteria\n\n### C1 — it works\n- **Observe:** run it\n- **Fails if:** it does not\n\n### C2 — it is tidy\n- **Observe:** read it\n- **Fails if:** it is not\n`;

/**
 * A git project with these phases (each with a CRITERIA.md):
 *   1 First   complete, ARCHIVED under milestones/1/ , Stryker data on src/first.mjs
 *   2 Second  complete, live, mutmut data on src/second.py
 *   3 Third   pending,  killed + test-gap mutants (a trap: never drawn)
 *   4 Fourth  verified, killed + test-gap mutants (a trap: never drawn)
 * Per accepted phase: `killed` killed mutants, 1 timeout, `testGap` judged test-gap survivors (the
 * last one `no-coverage`), `equivalent` judged equivalent, `unjudged` unjudged survivors, and for
 * mutmut `notExact` killed mutants whose change is not exact.
 *
 * `tools: ['gremlins']` builds a Go project whose only accepted phase has a kept Gremlins run.
 * `noRuns: true` keeps no run at all. Returns the dir, the slugs, and the expected keys:
 * `easy` / `hard` (`[{ key, slug, tool, file }]`, accepted phases only) and `trap` (keys that must
 * never be drawn).
 */
export async function makeCalibrationProject({
  killed = 4, testGap = 3, equivalent = 2, unjudged = 2, notExact = 1, tools = ['stryker', 'mutmut'], noRuns = false,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-cal-proj-'));
  sh(dir, 'init', '-q', '-b', 'main');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'calproj' });
  const goOnly = tools.length === 1 && tools[0] === 'gremlins';
  put(dir, goOnly ? 'go.mod' : 'package.json', goOnly ? 'module example.com/p\n\ngo 1.22\n' : '{"name":"calproj"}\n');
  if (!goOnly) put(dir, 'pyproject.toml', '[project]\nname = "calproj"\n');
  put(dir, '.gitignore', 'node_modules/\n.venv/\n');
  const commit = (m) => { sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', m); };
  commit('init');

  const total = killed + 1 + testGap + equivalent + unjudged + notExact;
  const defs = [
    { n: 1, name: 'First', tool: 'stryker', file: 'src/first.mjs', accepted: true, archived: true },
    { n: 2, name: 'Second', tool: 'mutmut', file: 'src/second.py', accepted: true },
    { n: 3, name: 'Third', tool: 'stryker', file: 'src/third.mjs', accepted: false, status: 'pending' },
    { n: 4, name: 'Fourth', tool: 'stryker', file: 'src/fourth.mjs', accepted: false, status: 'verified' },
  ].filter((d) => (goOnly ? false : d.tool === 'stryker' ? tools.includes('stryker') || !d.accepted : tools.includes('mutmut')));
  if (goOnly) defs.push({ n: 1, name: 'First', tool: 'gremlins', file: 'a.go', accepted: true });

  const made = [];
  for (const d of defs) {
    const src = d.tool === 'mutmut' ? pySource(total, 'g') : d.tool === 'stryker' ? jsSource(total, d.file.includes('first') ? 'f' : d.file.includes('second') ? 's' : d.file.includes('third') ? 't' : 'u') : { text: 'package p\n\nfunc A() int { return 1 + 2 }\n', mutant: () => ({ line: 3 }) };
    put(dir, d.file, src.text);
    made.push({ ...d, src });
  }
  commit('feat: sources');
  const head = sh(dir, 'rev-parse', 'HEAD').stdout.trim();

  const expected = { easy: [], hard: [], trap: [] };
  const phases = {};
  mkdirSync(join(dir, '.astrocode', '.local', 'mutate-runs'), { recursive: true });
  put(dir, '.astrocode/.local/.gitignore', '*\n');
  for (const d of made) {
    if (!d.archived) await addPhase(dir, { number: d.n, name: d.name });
  }
  for (const d of made) {
    const slug = d.archived ? `${String(d.n).padStart(2, '0')}-${d.name.toLowerCase()}` : findPhase(dir, String(d.n)).slug;
    const phaseDir = d.archived ? join(dir, '.astrocode', 'milestones', '1', 'phases', slug) : join(dir, '.astrocode', 'phases', slug);
    mkdirSync(phaseDir, { recursive: true });
    writeFileSync(join(phaseDir, 'CRITERIA.md'), CRITERIA(d.name));
    phases[d.name.toLowerCase()] = { number: d.n, slug, dir: phaseDir, file: d.file, tool: d.tool };

    // ---- The mutants of this phase, by role ----
    const roles = [];
    for (let i = 0; i < killed; i += 1) roles.push('killed');
    roles.push('timeout');
    for (let i = 0; i < testGap; i += 1) roles.push(i === testGap - 1 && testGap > 1 ? 'gap-nocov' : 'gap');
    for (let i = 0; i < equivalent; i += 1) roles.push('equivalent');
    for (let i = 0; i < unjudged; i += 1) roles.push('unjudged');
    if (d.tool === 'mutmut') for (let i = 0; i < notExact; i += 1) roles.push('notexact');
    const list = [];
    const judgements = [];
    const survivors = [];
    roles.forEach((role, i) => {
      const key = `s:${sha12(slug, i)}`;
      const status = role === 'killed' || role === 'notexact' ? 'killed' : role === 'timeout' ? 'timeout' : role === 'gap-nocov' ? 'no-coverage' : 'survived';
      const base = { file: d.file, mutator: d.tool === 'mutmut' ? `x_g${i}__mutmut_1` : 'ArithmeticOperator', status, id: String(i + 1), scope: 'in', key };
      if (d.tool === 'gremlins') {
        list.push({ ...base, file: d.file, line: 3, mutator: 'ARITHMETIC_BASE' });
      } else {
        const m = d.src.mutant(i);
        list.push(d.tool === 'mutmut'
          ? { ...base, line: m.line, fn: m.fn, kind: '`+` → `-`', line_text: m.line_text, replacement_line: m.replacement_line, exact: role !== 'notexact' }
          : { ...base, line: m.line, fn: m.fn, kind: 'ArithmeticOperator', replacement: m.replacement, loc: m.loc });
      }
      if (role === 'gap' || role === 'gap-nocov') judgements.push({ key, file: d.file, triage: 'test-gap', at: '2026-01-01T00:00:00.000Z' });
      if (role === 'equivalent') judgements.push({ key, file: d.file, triage: 'equivalent', justification: 'same result either way', at: '2026-01-01T00:00:00.000Z' });
      if (status === 'survived' || status === 'no-coverage') survivors.push({ file: d.file, line: list[list.length - 1].line, mutator: base.mutator, status, id: base.id, key });
      const entry = { key, slug, tool: d.tool, file: d.file, line: list[list.length - 1].line };
      if (d.accepted && role === 'killed') expected.easy.push(entry);
      if (d.accepted && (role === 'gap' || role === 'gap-nocov')) expected.hard.push(entry);
      if (!d.accepted && (role === 'killed' || role === 'gap' || role === 'gap-nocov')) expected.trap.push(key);
    });
    writeFileSync(join(phaseDir, 'SURVIVORS.json'), `${JSON.stringify({ version: 1, judgements }, null, 2)}\n`);
    if (!noRuns) {
      put(dir, `.astrocode/.local/mutate-runs/${slug}.mutants.jsonl`, `${list.map((l) => JSON.stringify(l)).join('\n')}\n`);
      put(dir, `.astrocode/.local/mutate-runs/${slug}.json`, `${JSON.stringify({ head, tool: d.tool, outcome: 'survivors', capped: false, complete: true, counts: {}, tool_installed: true, started_at: null, survivors }, null, 2)}\n`);
    }
  }

  // The archived milestone snapshot, and the live roadmap's statuses.
  const archived = made.find((d) => d.archived);
  if (archived) {
    const a = phases.first;
    put(dir, '.astrocode/milestones/1/roadmap.json', `${JSON.stringify({ version: 1, milestone: 1, closed_at: '2026-01-01T00:00:00.000Z', phases: [{ number: 1, name: 'First', slug: a.slug, status: 'complete', milestone: 1 }] }, null, 2)}\n`);
  }
  const rmFile = join(dir, '.astrocode', 'roadmap.json');
  const rm = JSON.parse(readFileSync(rmFile, 'utf8'));
  writeFileSync(rmFile, `${JSON.stringify({ ...rm, milestone: 2 }, null, 2)}\n`);
  for (const d of made) {
    if (d.archived) continue;
    const st = d.accepted ? 'complete' : d.status;
    if (st !== 'pending') await setPhaseStatus(dir, phases[d.name.toLowerCase()].slug, st);
  }
  commit('chore: planning state');
  return { dir, head, phases, expected, total };
}

/** Edit a tracked file and commit it, so the kept run's `head` no longer matches it (a drift). */
export function drift(p, file, from, to) {
  const f = join(p.dir, file);
  writeFileSync(f, readFileSync(f, 'utf8').replace(from, to));
  sh(p.dir, 'add', '-A');
  sh(p.dir, 'commit', '-q', '-m', 'chore: edit after the run');
}

// ---- The stand-in for `claude` ----

/**
 * Write an executable `claude` into `binDir`. Every non-`--version` invocation appends one JSON line
 * to `logFile`: argv, stdin, cwd, env, `git status --porcelain`, `git log --all` subjects, ref names,
 * the file list, `changed` (files differing from `original`, each as a unified diff), `removed` and
 * `added` paths, and `rule` (the index of the script rule that matched the diff). It answers with a
 * JSON envelope holding a fenced verdict.
 *
 * `script`: `{ default: ['fail'], rules: [{ includes: 'a - 3', outcomes: ['pass','pass','fail'] }], cost: 1.5 }`.
 * Outcomes cycle per rule by how many earlier invocations matched it: `pass` (every criterion
 * passed: a false PASS), `fail` (C1 failed), `invalid` (no verdict) or `crash` (exit 1). `cost: null`
 * omits `total_cost_usd`.
 */
export function writeVerifierStub(binDir, { original, script = {}, logFile, version = '2.1.292' }) {
  mkdirSync(binDir, { recursive: true });
  const cfg = { original, script: { default: ['fail'], rules: [], cost: 1.5, ...script }, logFile, version };
  const body = `#!${process.execPath}
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const CFG = ${JSON.stringify(cfg)};
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log(CFG.version + ' (Claude Code)'); process.exit(0); }
const run = (cmd, args, cwd) => cp.spawnSync(cmd, args, { cwd, encoding: 'utf8' });
const lines = (s) => s.split('\\n').filter(Boolean);
let stdin = '';
try { stdin = fs.readFileSync(0, 'utf8'); } catch (e) { stdin = ''; }
const cwd = process.cwd();
const tracked = (dir) => lines(run('git', ['ls-files'], dir).stdout);
const here = tracked(cwd);
const orig = tracked(CFG.original);
const present = (f) => fs.existsSync(path.join(cwd, f));
const changed = [];
for (const f of orig) {
  if (!present(f)) continue;
  const a = path.join(CFG.original, f);
  const b = path.join(cwd, f);
  if (fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8')) continue;
  changed.push({ file: f, diff: run('diff', ['-u', '-L', 'a/' + f, '-L', 'b/' + f, a, b], cwd).stdout });
}
const rec = {
  argv, stdin, cwd, env: process.env,
  status: run('git', ['status', '--porcelain'], cwd).stdout,
  log: lines(run('git', ['log', '--all', '--format=%s'], cwd).stdout),
  refs: lines(run('git', ['for-each-ref', '--format=%(refname)'], cwd).stdout),
  files: here,
  changed,
  removed: orig.filter((f) => !present(f)),
  added: here.filter((f) => !orig.includes(f)),
};
const text = changed.map((c) => c.diff).join('\\n');
rec.rule = CFG.script.rules.findIndex((r) => text.includes(r.includes));
let seen = 0;
try {
  for (const l of lines(fs.readFileSync(CFG.logFile, 'utf8'))) if (JSON.parse(l).rule === rec.rule) seen += 1;
} catch (e) { /* first call */ }
const seq = rec.rule >= 0 ? CFG.script.rules[rec.rule].outcomes : CFG.script.default;
const outcome = seq[seen % seq.length];
fs.appendFileSync(CFG.logFile, JSON.stringify(rec) + '\\n');
if (outcome === 'crash') { console.error('stub crash'); process.exit(1); }
const prompt = argv[argv.length - 1] || '';
const cm = /(\\S*CRITERIA\\.md)/.exec(prompt);
let ids = ['C1', 'C2'];
try { ids = [...new Set([...fs.readFileSync(cm[1], 'utf8').matchAll(/^#{1,6}\\s*(C\\d+)\\b/gm)].map((m) => m[1]))]; } catch (e) { /* default ids */ }
let result;
if (outcome === 'invalid') result = 'I looked at it and I am not sure.';
else result = 'Verdict.\\n\`\`\`json\\n' + JSON.stringify({ mode: 'full', broad: false, criteria: ids.map((id, i) => ({ id, passed: outcome === 'pass' || i > 0 })) }) + '\\n\`\`\`\\n';
const env = { type: 'result', subtype: 'success', is_error: false, result };
if (CFG.script.cost !== null) env.total_cost_usd = CFG.script.cost;
console.log(JSON.stringify(env));
`;
  const file = join(binDir, 'claude');
  writeFileSync(file, body);
  chmodSync(file, 0o755);
  return file;
}

/** The records a stub wrote, parsed. */
export function readStubLog(logFile) {
  try { return readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}
