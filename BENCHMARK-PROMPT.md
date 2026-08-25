# Benchmark astro-code v0.11.0 end-to-end on a fresh project

Note: save this in your board tasks, as soon as you create session I will set it to AUTO

Build a small app from scratch using astro-code, running the full loop as autonomously as
you can, and **measure it rigorously**. The point is not the app — it is a clean
before/after datapoint on whether v0.10.0/v0.11.0 actually made astro-code faster without
costing quality. Treat yourself as the operator: answer the loop's questions decisively
rather than waiting on a human.

## 0. Preconditions — verify, don't assume

Run these first and **report the actual output**. If any is wrong, stop and say so.

```bash
cd ~/Development/astro-code && git log --oneline -1 && cat package.json | grep '"version"'
cat ~/.astro/code/version          # MUST read 0.11.0 — this is what actually runs
node --test 2>&1 | tail -5          # expect 439 pass / 0 fail
```

`~/.astro/code/version` is the one that matters: the repo can be ahead of what is
installed. If it is not `0.11.0`, run `node ~/Development/astro-code/bin/ac.mjs install`
from the repo and re-check.

Also record, because it changes what the run exercises:

- Are `mcp__forge__forge_knowledge` / `mcp__forge__forge_capture_knowledge` /
  `mcp__forge__forge_knowledge_list` in your toolset? If not, run **one**
  `ToolSearch("select:mcp__forge__forge_knowledge,mcp__forge__forge_knowledge_list,mcp__forge__forge_capture_knowledge")`
  before concluding they are absent — they are often *connected but deferred*.
- Which branch the project ends up on (see §2 — this matters).

## 1. What to build

A **deterministic, offline, dependency-light CLI + library**. Suggested: a changelog
generator that reads `git log`, parses conventional commits, groups them by type, and
renders Markdown, with a `--since <ref>` flag and a version-bump suggestion.

Pick something else if you prefer, but it MUST satisfy all of:

- **A real test suite from phase 1 onward.** Non-negotiable. astro-code's post-heal gate
  and its verifier both run the suite; a project with no tests measures a degraded path
  (see ADR-028) and the numbers will not be comparable.
- No network calls, no external services, no database, no API keys. Anything non-
  deterministic destroys reproducibility and inflates verification time.
- Enough substance for **4–6 phases**. Fewer and there is nothing to average; more and
  you are just burning quota.
- Pure logic separable from I/O, so criteria can be observed by running things rather
  than by reading code.

## 2. Run the loop — and stay on the default branch

**Work on `main`/`master`, not a feature branch.** Known issue: the harness forks agent
worktrees from the default branch, so on a feature branch every parallel wave reads as
STALE, routes to the heal ladder, and re-runs everything — roughly 2x cost, and it would
contaminate the measurement. If you must use a feature branch, set
`ac config set use_worktrees false` first and note it in the report.

Then, per phase:

```
/astro-new-project        # once, at the start
/astro-discuss <n>
/astro-plan <n>
/astro-execute <n>
/astro-accept <n>
```

Notes on running it autonomously:

- **Answer `/astro-discuss` yourself**, decisively, using the knowledge graph if you have
  it. Cap it at **2 rounds** per phase and record how many rounds you actually used.
- `/astro-execute` should launch the **next** phase's plan concurrently (ADR-032). Record
  whether that actually happened — it is gated on the next phase being pending, unplanned
  and `ac phase context` = `ready`, and it is deliberately silent when the gate is not met,
  which looks identical to it being broken.
- **Do NOT use `/astro-fast` for any phase** — it skips planning and single-passes verify,
  so including it would poison the comparison. If you want a fast-lane datapoint, run it as
  a clearly-labelled extra phase and report it separately.
- `/astro-accept` is normally a human gate (REQ-006). You are standing in for the human, so
  actually check the phase does what was asked before accepting. Say explicitly in the
  report that acceptance was automated — the two-gate guarantee is weakened for this run,
  which is fine for a benchmark and not fine for production.

## 3. Measurement protocol — read this carefully

### The trap that will silently double your numbers

**Every workflow completion notification appears TWICE in the session transcript.** Naive
grepping over `<duration_ms>` therefore reports exactly 2x the real workflow time and 2x
the run count. This has already produced one wrong conclusion — an earlier analysis
reported "planning costs as much as execution" when planning was actually 18% of workflow
time. Dedup by `<task-id>`, and then **cross-check**:

> the number of deduped runs MUST equal the number of directories under
> `<project-transcript-dir>/*/subagents/workflows/`

If those two numbers disagree, your dedup is wrong. Do not proceed until they match.

### Where the data lives

```
<TD>=/data/claude/accounts/<account>/projects/-Users-buu-Development-<project>
$TD/*.jsonl                              # main session transcripts (notifications live here)
$TD/*/subagents/workflows/<runId>/       # one dir per workflow run — the ground-truth count
$TD/*/subagents/workflows/<runId>/journal.jsonl   # one result line per agent
```

### Extraction script

Write this to a file and run it (inline `node -e` may be blocked):

```js
import { readFileSync, readdirSync } from 'node:fs'
const TD = process.env.TD
let txt = ''
for (const f of readdirSync(TD)) if (f.endsWith('.jsonl')) txt += readFileSync(`${TD}/${f}`, 'utf8')

const seen = new Set(), rows = []
for (const b of txt.split('<task-notification>').slice(1)) {
  const d = b.match(/<duration_ms>(\d+)<\/duration_ms>/); if (!d) continue
  const id = b.match(/<task-id>([^<]+)<\/task-id>/)
  const key = (id ? id[1] : '') + ':' + d[1]
  if (seen.has(key)) continue                      // <-- the dedup that matters
  seen.add(key)
  rows.push({
    // classify by the SUMMARY TEXT, never by agent count: a plan run and a small
    // execute run both have ~5 agents and are indistinguishable that way.
    kind: /Research a phase/.test(b) ? 'plan' : /Execute a phase/.test(b) ? 'exec' : 'other',
    min: +(d[1] / 60000).toFixed(1),
    tokens: +((b.match(/<subagent_tokens>(\d+)</) || [])[1] || 0),
    remediationCycles: +((b.match(/"remediationCycles":(\d+)/) || [])[1] || 0),
    healed: ((b.match(/"healed":\[([^\]]*)\]/) || [])[1] || '').split(',').filter(Boolean).length,
    strategy: (b.match(/"strategy":"(\w+)"/) || [])[1] || null,
    passed: /"passed":true/.test(b),
  })
}
const agg = (v) => ({ runs: v.length, hours: +(v.reduce((a, r) => a + r.min, 0) / 60).toFixed(2),
                      meanMin: +(v.reduce((a, r) => a + r.min, 0) / (v.length || 1)).toFixed(1) })
const plan = rows.filter(r => r.kind === 'plan'), exec = rows.filter(r => r.kind === 'exec')
const clean = exec.filter(r => r.remediationCycles === 0), remed = exec.filter(r => r.remediationCycles > 0)
console.log('DEDUPED RUNS:', rows.length, '(must equal the workflow dir count)')
console.log('plan          ', agg(plan))
console.log('exec          ', agg(exec))
console.log('exec clean    ', agg(clean))
console.log('exec remediated', agg(remed))
console.log('REMEDIATION RATE:', exec.length ? (remed.length / exec.length * 100).toFixed(0) + '%' : 'n/a')
console.log('total tokens  ', rows.reduce((a, r) => a + r.tokens, 0).toLocaleString())
```

Also run `ac stats` in the project dir for session tokens and wall-clock — but note it
reports **elapsed** time, which includes your thinking and any idle gaps. On a comparable
prior project only ~25% of elapsed time was workflows. Report both, clearly labelled;
never present elapsed time as workflow time.

### The headline metric

**Remediation rate** — the fraction of `/astro-execute` runs where `remediationCycles > 0`.
This is the number the last two releases were aimed at.

Baseline to beat (project OCP, astro-code v0.9.x, deduped):

| | runs | total | mean |
|---|---|---|---|
| plan | 9 | 1.8h | 12min |
| exec | 10 | 8.1h | 49min |
| exec, verify passed first time | 9 | 3.4h | 22min |
| exec, entered remediation | 9 | 7.1h | 47min |
| **remediation rate** | | | **~50%** |

ADR-031 made the executor read `CRITERIA.md` (previously it was judged against a bar it
had never seen). **If the theory holds, the remediation rate should fall well below 50%
and the exec mean should move toward 22min.** If it does not move, the theory is wrong —
say so plainly, that is a useful result.

### Also record

1. **Did the ADR-032 pipelined plan fire?** Count concurrent plan+exec workflows. If never,
   check whether the gate conditions were ever met before concluding it is broken.
2. **Did anything game the criteria?** ADR-031's real risk is an executor satisfying a
   criterion's literal wording while missing the goal. Read the verifier's evidence on at
   least two phases and judge whether the implementation genuinely achieves the goal.
3. **Forge knowledge graph (this doubles as phase-15 connected-mode UAT, never yet run):**
   - did `/astro-discuss` or `/astro-plan` actually call `forge_knowledge`? Quote what came
     back and whether it changed a decision.
   - did `/astro-new-project` use `forge_knowledge_list` (browse) rather than search?
   - did `/astro-decision` stage a capture after any ADR? **No astro-code capture has ever
     reached the queue**, so a first one is a real milestone. If an ADR did not lift into a
     project-agnostic generator and was correctly skipped, say that too.
   - Grep your own transcript for `"name":"mcp__forge__` to confirm actual CALLS, not just
     mentions — the tool ids appear as plain text in command frontmatter, so a naive grep
     shows hits even when nothing fired.
4. **Any stale-worktree events** (`grep 'worktree branches are STALE'`) — should be zero on
   the default branch.
5. **Test-suite health at the end**: full suite green, and whether any phase's verify FAILED
   for a reason that was actually a criteria/plan defect rather than a code defect.

## 4. What to report back

- The preconditions output from §0.
- The table from the extraction script, next to the baseline above.
- Remediation rate, stated as a single number, with your judgement on whether ADR-031 worked.
- The forge findings from §3.3.
- Anything that broke, surprised you, or that the framework made harder than it should be —
  especially any case where something silently did nothing and looked like success. That
  failure mode has recurred repeatedly in this codebase and is the most valuable thing you
  can find.

Be skeptical of your own numbers. If a result looks too good, re-check the dedup first.
