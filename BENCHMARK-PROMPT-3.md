# astro-code benchmark #3 — answer the remediation question

Note: save this in your board agenda, as soon as you create session I will set it to AUTO


Two runs so far. #1 was greenfield and all-sequential, so it exercised nothing hard and
correctly declined to claim it had validated anything. #2 hit the parallel path for the
first time and found real defects, but its own numbers were unusable: 17 task-executions
were thrown away to a harness bug, one phase was operator-contaminated, two runs aborted on
unrelated defects, and n was 3–5.

**This run exists to produce a remediation rate that means something**, and to confirm the
fixes #2 produced. Everything below is shaped by that.

Nothing from the previous runs survives — do not look for it, do not try to extend it.
Start clean.

---

## 0. Hard requirements — get these wrong and the run is void

1. **The project MUST live under `/Users/buu/Development/<name>`.** Only that path and
   `/data` persist; a project in the container home is destroyed when the session ends.
   Run #2's seed was lost exactly that way.
2. **`origin/main` MUST equal local `HEAD` when each `/astro-execute` launches**, and you
   must make **no commits during a phase**. This is not hygiene — it is the single largest
   confound in run #2. The harness forks parallel worktrees from `origin/main`, not from
   local `HEAD`, so any commit ahead of the remote makes an entire wave come back STALE and
   re-run. It cost 17 wasted executions across three phases. The one phase that launched
   with `origin/main == HEAD` and stayed quiet healed **0 of 11**.
   - So: `git push` before every `/astro-execute`, and verify with
     `git rev-parse HEAD` vs `git rev-parse origin/main`. Report any run where they differed.
3. **Aim for ~10 exec runs.** A rate over n=3 is noise. Prefer more phases over bigger ones
   if you have to choose, but every phase must still clear the size bar in §2.

---

## 1. Preconditions — report the actual output

```bash
cd /Users/buu/Development/astro-code
git log --oneline -1 && grep '"version"' package.json
cat ~/.astro/code/version          # MUST read 0.12.0 — this is what actually runs
node --test 2>&1 | tail -5          # expect 453 pass / 0 fail
```

`~/Development` does not exist in the container; use the `/Users/buu/Development` path.
`~/.astro/code/lib` and `bin` are stale leftovers the installer never copies — cosmetic,
but confirm `commands/`, `agents/` and `workflows/` match the repo before trusting the run.

**Forge MCP:** one probe —
`ToolSearch("select:mcp__forge__forge_knowledge,mcp__forge__forge_knowledge_list,mcp__forge__forge_capture_knowledge")`.
If present, §6 also discharges the phase-15 connected-mode UAT, which has **still never
run** in three attempts. If absent, say so and skip §6.

---

## 2. What to build

Your choice, but it must satisfy all of:

- **Deterministic and offline.** No network, no services, no clock-dependent behaviour
  outside an injectable seam, no API keys. Non-determinism destroys reproducibility and
  inflates verification.
- **A real test suite from the first task.** ADR-028 gives the post-heal gate a
  "no runnable suite" path; a project without tests measures a degraded path.
- **~6–8 phases, each ≥ 9 tasks.** `seqBudget` is 8 and the cutover is strictly-greater, so
  a plan that comes back at exactly 8 silently degrades to sequential. **Check the task
  count in PLAN.md before executing** — run #2 caught one phase at exactly 8 and re-planned
  it. Without that check the phase tests nothing.
- **At least one wave of ≥ 2 independent tasks per phase**, or there is nothing to
  parallelise even above the budget.
- Enough real coupling that later phases integrate against earlier ones rather than adding
  isolated modules. That coupling is what generates the remediation this run is measuring.

Stay on `main`. Leave `use_worktrees: true`. Leave the model config at `ac init` defaults —
**the integrator is now `sonnet` everywhere (ADR-035 reverted the haiku carve-out)**; if you
find `haiku` anywhere in the effective config, stop and report it.

Do not use `/astro-fast`. Discuss phase N+1 **before** executing phase N, or ADR-032's
pipeline gate can never pass.

---

## 3. Measurement

The wrapper tags (`<duration_ms>`, `<task-id>`, `<subagent_tokens>`) are **not** escaped
while the JSON payload **is** — that mix is what hid a broken metric in run #1.

```js
import { readFileSync, readdirSync } from 'node:fs'
const TD = process.env.TD
let txt = ''
for (const f of readdirSync(TD)) if (f.endsWith('.jsonl')) txt += readFileSync(`${TD}/${f}`, 'utf8')

const unesc = (s) => s.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
const seen = new Set(), rows = []
for (const raw of txt.split('<task-notification>').slice(1)) {
  const d = raw.match(/<duration_ms>(\d+)<\/duration_ms>/); if (!d) continue
  const id = raw.match(/<task-id>([^<]+)<\/task-id>/)
  const key = (id ? id[1] : '') + ':' + d[1]
  if (seen.has(key)) continue                       // duplication is ~2.1x; never divide by 2
  seen.add(key)
  const b = unesc(raw)
  rows.push({
    kind: /Research a phase/.test(b) ? 'plan' : /Execute a phase/.test(b) ? 'exec' : 'other',
    min: +(d[1] / 60000).toFixed(1),
    tokens: +((raw.match(/<subagent_tokens>(\d+)</) || [])[1] || 0),
    rem: +((b.match(/"remediationCycles":(\d+)/) || [])[1] ?? -1),
    healed: ((b.match(/"healed":\[([^\]]*)\]/) || [])[1] || '').split(',').filter(Boolean).length,
    strategy: (b.match(/"strategy":"(\w+)"/) || [])[1] || null,
    stop: (b.match(/"stoppedReason":"([a-z-]+)"/) || [])[1] || null,
    tasks: +((b.match(/"tasks":(\d+)/) || [])[1] || 0),
    executed: +((b.match(/"executed":(\d+)/) || [])[1] || 0),
  })
}
const exec = rows.filter(r => r.kind === 'exec')
const agg = v => `runs=${String(v.length).padEnd(3)} total=${(v.reduce((a,r)=>a+r.min,0)/60).toFixed(2)}h mean=${(v.reduce((a,r)=>a+r.min,0)/(v.length||1)).toFixed(1)}min`
console.log('parse failures ', exec.filter(r => r.rem === -1).length, '(MUST be 0)')
console.log('plan           ', agg(rows.filter(r => r.kind === 'plan')))
console.log('exec           ', agg(exec))
console.log('  rem == 0     ', agg(exec.filter(r => r.rem === 0)))
console.log('  rem >  0     ', agg(exec.filter(r => r.rem > 0)))
console.log('REMEDIATION RATE', exec.length ? (exec.filter(r=>r.rem>0).length/exec.length*100).toFixed(0)+'%' : 'n/a')
console.log('WASTED EXECS   ', exec.reduce((a,r) => a + Math.max(0, r.executed - r.tasks), 0), '(executed beyond plan = heal re-runs)')
console.log('strategies     ', exec.map(r => `${r.strategy}(${r.tasks}t/${r.executed}x)`).join(', '))
console.log('stops          ', [...new Set(exec.map(r=>r.stop))].join(','))
```

**Two sanity gates.** `parse failures` must be `0`. And the deduped **`plan + exec`** count
must equal the number of directories under `<TD>/*/subagents/workflows/` **when nothing is
in flight** — compare `plan + exec`, *not* all rows: bare `Agent` calls (`/astro-adopt`'s
mapper, and every Agent-fallback tier) emit a notification but have no workflow directory,
and counting them makes the gate mis-fire.

**`WASTED EXECS` is the confound tracker.** It should be ~0 if §0.2 was honoured. If it is
not, the timing numbers are inflated and you must say so before quoting a rate.

---

## 4. Baseline

| | plan mean | exec mean | exec clean | exec remediated | remediation rate |
|---|---|---|---|---|---|
| OCP, v0.9.x | 11.7min | 50.6min | 38.0min | 57.8min | **64%** |
| run #1, v0.11.0 (greenfield, sequential) | 8.2min | 11.8min | 11.8min | — | **0%** |
| run #2, v0.11.2 (parallel, 17 wasted execs) | 13.5min | 30.5min | 21.2min | 44.4min | **40%** (n=5) |

**The open question: what is the remediation rate when phases are large, waves are parallel,
the code has real internal coupling, and no executions are wasted?** Run #2 could not answer
it. With ~10 clean runs, this one can.

A result above 0% is not a failure of ADR-031 — note whether remediations are single-cycle
and resolve (`stoppedReason: "passed"`) versus exhausting `max-cycles` as OCP's did. That
axis matters as much as the rate.

---

## 5. Verify the v0.12.0 fixes

1. **Integrator at sonnet.** Confirm no `haiku` in the effective config or in any spawned
   agent's model. Report the integrator's per-branch behaviour and quote a `note`.
2. **No unscoped destructive git.** Filter on *actual tool invocations*, not prompt text:
   any `git stash` without a pathspec, or any `git clean` / `reset --hard` / `checkout .`
   run by the integrator in the main tree is a **critical regression**. Run #2 found one
   that destroyed a completed plan.
3. **`tasks: 0` is a hard failure.** If you can, provoke it: after a plan lands, move its
   `PLAN.md` aside and run `/astro-execute`. Expect `stoppedReason: "no-tasks"`, a failed
   verdict naming the likely cause, and **no** executor or verifier spawn. Restore it
   afterwards. Previously this returned an all-benign no-op.
4. **Plan artifacts are committed** by `/astro-plan` before execute is suggested.
5. **`.gitignore` carries `.claude/worktrees/`** after `ac init`.
6. **ADR-032 pipeline** emits one line every time, including both negative branches.
7. **ADR-034 canon pull**: hand-write an `## ADR-999` heading into `.astrocode/DECISIONS.md`,
   run `ac canon pull`, confirm it survives and is reported.
8. **ADR-033 / ADR-035 provenance**: sign every phase with
   `ac phase accept <n> --agent "FORGEMASTER"` and confirm `accepted_kind: "agent"`. Since
   you are authoring the discussions too, use the agent form of the CONTEXT.md marker:
   `<!-- astro-discuss: captured by agent: FORGEMASTER -->`.
9. **ADR-017 stamps.** Every task commit subject must end with `(phase NN tK)`. Run #2 had
   four of five unstamped in one wave. Report the stamped/unstamped split — the integrator
   maps branches to tasks by grepping for it.

---

## 6. Forge knowledge graph — only if the tools are present

Did `forge_knowledge` actually get **called**? Grep `"name":"mcp__forge__`, never the bare
id — run #2 had 53 hits for the bare id and **zero** real calls; all 53 were frontmatter.
Did `/astro-new-project` prefer browse over search? Did `/astro-decision` stage a capture?
**No astro-code capture has ever reached the queue.** If an ADR did not lift into an honest
project-agnostic generator and was correctly skipped, report that too — that is the
mechanism working.

---

## 7. Report

Lead with the table against §4, then `WASTED EXECS` and whether §0.2 held, then the §5
checks, then bugs by severity.

Two standing asks:

- **Be harsh about anything that silently did nothing and looked like success.** Seven
  instances so far — the forge probe, the pipeline gate, the canon overwrite, the broken
  metric script, the flag-typo path, the acceptance signature, and the zero-task no-op. It
  is the most valuable class of finding you can return, and the reason several of these
  fixes exist.
- **Say plainly if the numbers still cannot carry a conclusion.** Both previous reports
  declined to claim a win they had not earned, and both were right to. Hold this one to the
  same bar; a clean "still unproven, here is what would settle it" beats a flattering rate.
