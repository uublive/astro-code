# astro-code benchmark #2 — the paths run #1 could not reach

Note: save this in your board agenda, as soon as you create session I will set it to AUTO

Run #1 (`cgbench`, v0.11.0) was clean and useful, and it correctly refused to claim it had
validated ADR-031. Its own caveats define this run: greenfield, pure-logic, every phase
under the 8-task `seqBudget`, so **all five ran `strategy: sequential`** and the parallel
worktree path, the wave integrator and the heal ladder were never exercised once.

This run exists to hit those paths, on code that already exists, and to check the fixes
that run #1 produced.

Two corrections you should have before you start:

- **The extraction script in the first brief was broken.** You caught it: workflow payloads
  are JSON-escaped in the transcript, so `/"remediationCycles":(\d+)/` never matched and the
  headline metric printed `0%` unconditionally. The script below is fixed. Good catch.
- **The baseline I gave you was also wrong**, from a different flaw of mine — I derived it
  from a file-count proxy rather than the real field. Recomputed with your unescaping, the
  true OCP (v0.9.x) baseline is in §4. The direction of run #1's result survives; the
  magnitudes do not.

---

## 1. Preconditions — report the actual output

```bash
git log --oneline -1 && grep '"version"' package.json
cat ~/.astro/code/version          # MUST read 0.11.2 — this is what actually runs
node --test 2>&1 | tail -5          # expect 447 pass / 0 fail
```

Note `~/Development` does not exist in the container; the bind-mount path is
`/Users/buu/Development/...`. Also expect `~/.astro/code/lib` and `bin` to be stale
leftovers from an old clone — the installer never copies them, and `ac` on PATH symlinks
straight to the repo, so it is cosmetic. Confirm `commands/`, `agents/` and `workflows/`
under `~/.astro/code` match the repo before trusting the run, as you did last time.

**Forge MCP:** probe once with
`ToolSearch("select:mcp__forge__forge_knowledge,mcp__forge__forge_knowledge_list,mcp__forge__forge_capture_knowledge")`.
The root cause of its absence was reportedly addressed — if the tools ARE present this run
also discharges the phase-15 connected-mode UAT, which has **still never run**. If absent,
say so and skip §6; do not let it block the benchmark.

---

## 2. What to build — extend `cgbench`, do not start fresh

`cgbench` is now an existing codebase with 168 tests, established conventions and its own
canon. That is the point: run #1's biggest confound was greenfield code with nothing to
integrate against.

Add **3–4 phases**, and size them so the parallel path actually engages:

- **Each phase must be ≥ 9 tasks**, because `seqBudget` is 8 — at or under it, execution
  stays sequential and this whole run repeats #1. Check the plan's task count before
  executing; if the planner produced 8 or fewer, that phase will not test anything new.
- **Each phase needs at least one wave with ≥ 2 independent tasks**, or there is nothing to
  parallelise even above the budget.
- Stay on `main`. Leave `use_worktrees` at `true`. Leave `models.integrator` unset so the
  wave integrator runs at its **haiku** default (ADR-027) — that tier has been exercised
  exactly once, ever.

Suggested direction (pick your own if it sizes better): a plugin/preset system for output
formats, a config-file layer with precedence rules, `--json` output, changelog *merging*
across ranges, and a `--check` mode that exits non-zero on an empty changelog. These touch
existing modules rather than adding isolated new ones, which is what forces genuine
integration.

Constraints unchanged: deterministic, offline, no services, tests from the first task.

**Do not use `/astro-fast`.** And discuss phase N+1 **before** executing phase N — see §5.

---

## 3. Measurement — corrected script

The wrapper tags (`<duration_ms>`, `<task-id>`, `<subagent_tokens>`) are **not** escaped
while the JSON payload **is**, which is exactly what made the old bug invisible: durations
looked right while every verdict field silently read zero.

```js
import { readFileSync, readdirSync } from 'node:fs'
const TD = process.env.TD
let txt = ''
for (const f of readdirSync(TD)) if (f.endsWith('.jsonl')) txt += readFileSync(`${TD}/${f}`, 'utf8')

const unesc = (s) => s.replace(/\\"/g, '"').replace(/\\\\/g, '\\')   // <-- the fix
const seen = new Set(), rows = []
for (const raw of txt.split('<task-notification>').slice(1)) {
  const d = raw.match(/<duration_ms>(\d+)<\/duration_ms>/); if (!d) continue
  const id = raw.match(/<task-id>([^<]+)<\/task-id>/)
  const key = (id ? id[1] : '') + ':' + d[1]
  if (seen.has(key)) continue                       // duplication is ~2.1x, never divide by 2
  seen.add(key)
  const b = unesc(raw)
  rows.push({
    kind: /Research a phase/.test(b) ? 'plan' : /Execute a phase/.test(b) ? 'exec' : 'other',
    min: +(d[1] / 60000).toFixed(1),
    tokens: +((raw.match(/<subagent_tokens>(\d+)</) || [])[1] || 0),
    rem: +((b.match(/"remediationCycles":(\d+)/) || [])[1] ?? -1),   // -1 => parse failed
    healed: ((b.match(/"healed":\[([^\]]*)\]/) || [])[1] || '').split(',').filter(Boolean).length,
    strategy: (b.match(/"strategy":"(\w+)"/) || [])[1] || null,
    stop: (b.match(/"stoppedReason":"([a-z-]+)"/) || [])[1] || null,
    tasks: +((b.match(/"tasks":(\d+)/) || [])[1] || 0),
  })
}
const exec = rows.filter(r => r.kind === 'exec')
const agg = v => `runs=${String(v.length).padEnd(3)} total=${(v.reduce((a,r)=>a+r.min,0)/60).toFixed(2)}h mean=${(v.reduce((a,r)=>a+r.min,0)/(v.length||1)).toFixed(1)}min`
console.log('deduped runs   ', rows.length, '(must equal workflow dir count when quiescent)')
console.log('parse failures ', exec.filter(r => r.rem === -1).length, '(MUST be 0 — else the unescape is wrong)')
console.log('plan           ', agg(rows.filter(r => r.kind === 'plan')))
console.log('exec           ', agg(exec))
console.log('  rem == 0     ', agg(exec.filter(r => r.rem === 0)))
console.log('  rem >  0     ', agg(exec.filter(r => r.rem > 0)))
console.log('REMEDIATION RATE', exec.length ? (exec.filter(r=>r.rem>0).length/exec.length*100).toFixed(0)+'%' : 'n/a')
console.log('strategies     ', exec.map(r => `${r.strategy}(${r.tasks}t)`).join(', '))
console.log('healed runs    ', exec.filter(r => r.healed > 0).length, ' stops:', [...new Set(exec.map(r=>r.stop))].join(','))
```

**Two sanity gates before you believe any number.** `parse failures` must be `0` — if not,
the unescaping is wrong and every verdict field is garbage. And the deduped run count must
equal the workflow directory count **when nothing is in flight** (a running workflow has a
directory but no notification yet, which reads as a false mismatch — that tripped you last
time at 6 vs 7).

---

## 4. Corrected baseline

OCP, astro-code v0.9.x, recomputed with the unescaping fix:

| | runs | total | mean |
|---|---|---|---|
| plan | 9 | 1.76h | 11.7min |
| exec | 11 | 9.27h | 50.6min |
| exec, `remediationCycles == 0` | 4 | 2.54h | **38.0min** |
| exec, `remediationCycles > 0` | 7 | 6.74h | **57.8min** |
| **remediation rate** | | | **64%** |

`stoppedReason` on OCP included `max-cycles` and `integration-failed` — some runs exhausted
the remediation budget and failed outright, not merely ran long. Watch for those here.

For reference, run #1 (`cgbench`, greenfield, all-sequential): plan 8.2min, exec 11.8min,
remediation rate 0%.

**The open question this run answers:** does the 0% survive when phases are large, waves are
parallel, and the code already exists? If remediation reappears at scale, ADR-031 helped the
easy case only — which is a real and reportable result, not a failure.

---

## 5. Feature checks specific to this run

1. **Parallel path actually engaged.** Report `strategy` and task count per exec run. If
   every run still says `sequential`, the phases were too small and the run does not answer
   the question — say so prominently rather than reporting the timings as if it did.
2. **The wave integrator at haiku (ADR-027).** Did it cherry-pick cleanly? Did it bail
   per-branch (preserving one branch while its clean peers still landed) or per-wave? A
   per-wave bail is a defect. Quote the integrator's `note`.
3. **Heal ladder + post-heal test gate**, if a heal fires. `healed` non-empty means it did.
   Note that ADR-028 gives the gate three outcomes — cgbench HAS a suite, so a missing-suite
   skip would be wrong here.
4. **ADR-032 pipelining.** It now emits **one line** when the gate is not met — quote it.
   And discuss phase N+1 **before** executing phase N, or the gate can never pass (that was
   the §2.2 trap you found; the docs now say so).
5. **ADR-034 canon pull.** If any local-only ADR ever exists, pull must preserve it and print
   `⚠ kept N local-only decision(s)`. If you can, provoke it deliberately: hand-write an
   `## ADR-999` heading into `.astrocode/DECISIONS.md`, run `ac canon pull`, and confirm it
   survives and is reported. This replaces the silent destruction you hit last time.
6. **ADR-033 acceptance provenance.** Use `ac phase accept <n> --agent "FORGEMASTER"` for
   every phase you sign. Confirm `accepted_kind: "agent"` lands in `roadmap.json` and that
   the terminal shows the AGENT marker. Plain `ac phase accept` now asserts a human made the
   judgement — do not use it.
7. **Stale worktrees.** Should stay zero on `main`. *Optional controlled experiment:* if you
   have budget, run ONE extra phase on a feature branch with `use_worktrees` still `true` and
   report whether every branch comes back STALE with `merge-base` pointing at `main`'s tip.
   That is a known-but-unconfirmed bug and a clean datapoint. Label it separately; it is not
   part of the main measurement.

---

## 6. Forge knowledge graph — only if the tools are present

Same as before, and still never run: did `forge_knowledge` actually get **called** (grep
`"name":"mcp__forge__`, not the bare id — 53 of your 53 hits last time were frontmatter);
did `/astro-new-project` prefer browse; did `/astro-decision` stage a capture. **No
astro-code capture has ever reached the queue**, so a first one is a genuine milestone.
If an ADR did not lift into an honest project-agnostic generator and was correctly skipped,
report that too — that is the mechanism working, not failing.

---

## 7. Report

Same shape as your v0.11.0 report, which was the right shape. Lead with the table against
§4's baseline, then the §5 feature checks, then bugs.

Two things I want you to be harsh about:

- **Anything that silently did nothing and looked like success.** That failure mode has now
  appeared six times in this framework — the forge probe, the pipeline gate, the canon
  overwrite, the broken metric script, the flag typo path, and the acceptance signature. It
  is the single most valuable class of finding you can return.
- **Whether the numbers actually support the conclusion.** Run #1's report was right to say
  the mechanism worked but the theory was unproven. Hold this one to the same bar, and if
  the confounds are still too large to conclude anything, say that instead of reporting a
  win.
