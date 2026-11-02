#!/usr/bin/env node
// ONE-OFF benchmark harness for phase 55's acceptance. Hand-run only.
//
// It must NEVER be wired into tests, hooks, workflows, `ac verify`, `npm test` or CI (phase 55
// CONTEXT decisions 8 and 9: development has to get faster, not slower, so this measurement is
// taken once, by hand, and then left alone). It lives in the phase folder, outside the npm
// package (`files` in package.json) and outside `tests/`, so nothing reaches it by accident.
//
// What it measures: 8 fixed small coding tasks (bench/tasks/*), each with criteria written
// BEFORE any run, executed 3 times per arm (8 x 2 x 3 = 48 runs):
//   with    = agents/astro-executor.md at HEAD (carries the smallest-complete-change section)
//   without = the same file at the parent of the commit stamped `(phase 55 t1)`
// Each run: copy the task's seed into a fresh git repo, run the executor headless with the arm's
// agent body as its system prompt and TASK.md as the prompt, then run the REAL
// agents/astro-verifier.md headless against that task's CRITERIA.md and take ITS pass/fail.
// Nothing else judges a pass. Records go to bench/runs.jsonl, one line per run, and the run is
// resumable: a (task, arm, rep) already recorded is skipped.
//
// Usage (from anywhere):
//   node .astrocode/phases/55-smallest-complete-change-discipline-for/bench/run.mjs --dry-run
//   node .../bench/run.mjs --budget-usd 60
//   node .../bench/run.mjs --report
// Flags: --dry-run (print the plan and the resolved arm shas, run nothing), --budget-usd N (stop
// before a run once the recorded spend is >= N), --report (rebuild totals from runs.jsonl only,
// print them and write bench/report.md), --allow-lean-ctx (do not isolate MCP servers; records say
// "lean-ctx present in both arms").
//
// Controls: both arms start `claude` with --strict-mcp-config and an empty --mcp-config, so
// lean-ctx's injected "solution efficiency" block is out of BOTH arms. The executor and verifier
// run with permissions bypassed inside a throwaway temp dir (nothing interactive can answer a
// prompt headless); that is the one place this harness trusts a model with a shell.
//
// Field notes for the JSON result of `claude -p --output-format json`: cost is `total_cost_usd`,
// tokens come from `usage.input_tokens` / `usage.output_tokens` (cache tokens are kept apart as
// cache_tokens), duration is measured here as wall_ms. cost_usd and the token counts in a record
// are executor + verifier together, because a run is both.
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, appendFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BENCH = dirname(fileURLToPath(import.meta.url))
const REPO = join(BENCH, '..', '..', '..', '..')
const TASKS = join(BENCH, 'tasks')
const RUNS = join(BENCH, 'runs.jsonl')
const REPORT_MD = join(BENCH, 'report.md')

const MODEL = 'claude-sonnet-5-5' // pinned for the executor AND the verifier, in both arms
const REPS = 3
const ARMS = ['with', 'without']
const SEED = 55
const T1_STAMP = '(phase 55 t1)'

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
const gitOut = (args, cwd = REPO) => {
  const r = run('git', args, { cwd })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`)
  return r.stdout.trim()
}

// Strip the YAML frontmatter: an agent file's body is what becomes the system prompt.
const bodyOf = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, '')

function resolveArms() {
  const t1 = gitOut(['log', '--fixed-strings', `--grep=${T1_STAMP}`, '--format=%H', '-1'])
  if (!t1) throw new Error(`no commit stamped ${T1_STAMP} found; the "without" arm cannot be resolved`)
  const withSha = gitOut(['rev-parse', 'HEAD'])
  const withoutSha = gitOut(['rev-parse', `${t1}^`])
  return {
    with: { sha: withSha, body: bodyOf(gitOut(['show', 'HEAD:agents/astro-executor.md'])) },
    without: { sha: withoutSha, body: bodyOf(gitOut(['show', `${withoutSha}:agents/astro-executor.md`])) },
    verifier: {
      sha: gitOut(['log', '-1', '--format=%H', '--', 'agents/astro-verifier.md']),
      body: bodyOf(readFileSync(join(REPO, 'agents', 'astro-verifier.md'), 'utf8')),
    },
  }
}

const taskIds = () => readdirSync(TASKS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()

// mulberry32: a tiny seeded PRNG, so the interleaved run order is the same on every invocation.
function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function plan() {
  const all = []
  for (const task of taskIds()) for (const arm of ARMS) for (let rep = 1; rep <= REPS; rep++) all.push({ task, arm, rep })
  const rnd = prng(SEED)
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return all
}

const readRuns = () => (existsSync(RUNS) ? readFileSync(RUNS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const keyOf = (r) => `${r.task}|${r.arm}|${r.rep}`

// One headless claude call. The prompt goes on stdin so it cannot be mistaken for a flag.
function claude({ system, prompt, cwd, isolate }) {
  const args = ['-p', '--output-format', 'json', '--model', MODEL, '--system-prompt', system, '--permission-mode', 'bypassPermissions']
  if (isolate) args.push('--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}')
  const t0 = Date.now()
  const r = run('claude', args, { cwd, input: prompt })
  const wall = Date.now() - t0
  if (r.error || r.status !== 0) {
    throw new Error(`claude failed (${r.error ? r.error.message : `exit ${r.status}`}): ${(r.stderr || r.stdout || '').slice(0, 400)}`)
  }
  let j
  try { j = JSON.parse(r.stdout) } catch { throw new Error(`claude did not return JSON: ${r.stdout.slice(0, 200)}`) }
  const u = j.usage || {}
  return {
    text: String(j.result ?? ''),
    cost: Number(j.total_cost_usd) || 0,
    input: Number(u.input_tokens) || 0,
    output: Number(u.output_tokens) || 0,
    cache: (Number(u.cache_creation_input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0),
    wall,
  }
}

function locChanged(dir, seedSha) {
  run('git', ['add', '-A'], { cwd: dir })
  const out = run('git', ['diff', '--cached', '--numstat', seedSha], { cwd: dir }).stdout
  let added = 0
  let removed = 0
  for (const line of out.split('\n').filter(Boolean)) {
    const [a, d] = line.split('\t')
    added += Number(a) || 0 // binary files show "-"
    removed += Number(d) || 0
  }
  return { added, removed }
}

function parseVerdict(text) {
  const m = [...text.matchAll(/^\s*\**VERDICT:\**\s*(PASS|FAIL)\b\s*[-:—]?\s*(.*)$/gim)].pop()
  return m ? { passed: m[1].toUpperCase() === 'PASS', summary: m[2].trim().slice(0, 300) } : { passed: false, summary: 'no VERDICT line in the verifier reply (counted as a fail)' }
}

function runOne({ task, arm, rep }, arms, isolate) {
  const started_at = new Date().toISOString()
  const dir = mkdtempSync(join(tmpdir(), 'ac-bench55-'))
  try {
    cpSync(join(TASKS, task, 'seed'), dir, { recursive: true })
    for (const c of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', 'commit', '-qm', 'seed']]) {
      const r = run('git', c, { cwd: dir })
      if (r.status !== 0) throw new Error(`git ${c.join(' ')} failed in the run dir: ${r.stderr}`)
    }
    const seedSha = run('git', ['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim()
    const taskMd = readFileSync(join(TASKS, task, 'TASK.md'), 'utf8')

    const ex = claude({
      system: arms[arm].body,
      prompt: `${taskMd}\nWork in the current directory (a git repo). Make one atomic commit when done.`,
      cwd: dir,
      isolate,
    })
    const loc = locChanged(dir, seedSha)

    // The real verifier reads CRITERIA.md from a phase folder; it sees the goal and the criteria,
    // never the executor's summary (claim-blind, ADR-021).
    const phaseDir = join(dir, '.astrocode', 'phases', '01-bench')
    cpSync(join(TASKS, task, 'CRITERIA.md'), join(phaseDir, 'CRITERIA.md'), { recursive: true })
    const vr = claude({
      system: arms.verifier.body,
      prompt:
        `Verify the project in the current directory against .astrocode/phases/01-bench/CRITERIA.md.\n` +
        `Phase goal:\n${taskMd}\n` +
        `This is a benchmark run: do not run \`ac verdict\` or write any file outside a scratch location. ` +
        `End your reply with exactly one line, \`VERDICT: PASS\` or \`VERDICT: FAIL\`, then a one-line reason.`,
      cwd: dir,
      isolate,
    })
    const verdict = parseVerdict(vr.text)

    return {
      task, arm, rep,
      passed: verdict.passed,
      verdict_summary: verdict.summary,
      loc_added: loc.added,
      loc_removed: loc.removed,
      cost_usd: Number((ex.cost + vr.cost).toFixed(4)),
      input_tokens: ex.input + vr.input,
      output_tokens: ex.output + vr.output,
      cache_tokens: ex.cache + vr.cache,
      wall_ms: ex.wall + vr.wall,
      executor_sha: arms[arm].sha,
      verifier_sha: arms.verifier.sha,
      model: MODEL,
      lean_ctx: isolate ? 'excluded from both arms (no MCP servers)' : 'present in both arms',
      started_at,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function report(runs) {
  const lines = []
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2))
  lines.push('| arm | runs | passed | LOC changed (total) | LOC changed (mean) | cost $ | input tokens | output tokens | wall (min) |')
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (const arm of ARMS) {
    const rs = runs.filter((r) => r.arm === arm)
    const sum = (f) => rs.reduce((s, r) => s + (Number(f(r)) || 0), 0)
    const loc = sum((r) => r.loc_added + r.loc_removed)
    lines.push(`| ${arm} | ${rs.length} | ${rs.filter((r) => r.passed).length} / 24 | ${loc} | ${rs.length ? fmt(loc / rs.length) : '-'} | ${fmt(sum((r) => r.cost_usd))} | ${sum((r) => r.input_tokens)} | ${sum((r) => r.output_tokens)} | ${fmt(sum((r) => r.wall_ms) / 60000)} |`)
  }
  lines.push('')
  lines.push('| task | with (passed / runs) | without (passed / runs) |')
  lines.push('| --- | ---: | ---: |')
  for (const task of [...new Set(runs.map((r) => r.task))].sort()) {
    const cell = (arm) => {
      const rs = runs.filter((r) => r.task === task && r.arm === arm)
      return `${rs.filter((r) => r.passed).length} / ${rs.length}`
    }
    lines.push(`| ${task} | ${cell('with')} | ${cell('without')} |`)
  }
  const w = runs.filter((r) => r.arm === 'with' && r.passed).length
  const wo = runs.filter((r) => r.arm === 'without' && r.passed).length
  lines.push('')
  lines.push(`with ${w} / 24 vs without ${wo} / 24 — with >= without - 1: ${runs.length ? (w >= wo - 1 ? 'YES' : 'NO') : 'n/a'} (${runs.length} of 48 runs recorded${runs.length < 48 ? ' - INCOMPLETE' : ''})`)
  return lines.join('\n') + '\n'
}

function main() {
  if (has('--report')) {
    const out = report(readRuns())
    writeFileSync(REPORT_MD, out)
    process.stdout.write(out)
    return
  }
  const arms = resolveArms()
  const done = new Set(readRuns().map(keyOf))
  const todo = plan().filter((p) => !done.has(keyOf(p)))
  const isolate = !has('--allow-lean-ctx')
  const budget = val('--budget-usd') === undefined ? Infinity : Number(val('--budget-usd'))
  if (Number.isNaN(budget)) throw new Error('--budget-usd needs a number')

  console.log(`arms: with=${arms.with.sha}  without=${arms.without.sha}  verifier=${arms.verifier.sha}`)
  console.log(`model: ${MODEL}   mcp isolation: ${isolate ? 'on (strict, empty config)' : 'off (lean-ctx present in both arms)'}`)
  console.log(`runs: ${todo.length} to do, ${done.size} already recorded, 48 in total; budget: ${budget === Infinity ? 'none' : `$${budget}`}`)
  if (has('--dry-run')) {
    for (const p of todo) console.log(`  ${p.task}  ${p.arm}  rep ${p.rep}`)
    return
  }
  for (const p of todo) {
    const spent = readRuns().reduce((s, r) => s + (Number(r.cost_usd) || 0), 0)
    if (spent >= budget) { console.log(`budget reached ($${spent.toFixed(2)} >= $${budget}); stopping. Re-invoke to resume.`); return }
    console.log(`run ${p.task} ${p.arm} rep ${p.rep} ...`)
    const rec = runOne(p, arms, isolate)
    appendFileSync(RUNS, JSON.stringify(rec) + '\n')
    console.log(`  ${rec.passed ? 'PASS' : 'FAIL'}  loc ${rec.loc_added}+/${rec.loc_removed}-  $${rec.cost_usd}  ${Math.round(rec.wall_ms / 1000)}s`)
  }
  console.log('all runs recorded. Run with --report for the totals.')
}

try { main() } catch (e) { console.error(`✖ ${e.message}`); process.exitCode = 1 }
