# astro-code v0.11.2 — benchmark #2: the paths run #1 could not reach

Run #2 exists to hit what run #1 never touched: parallel worktree execution, the wave
integrator at its haiku default (ADR-027), and the heal ladder — on a codebase that already
exists — and to answer whether ADR-031's 0% remediation rate survives at scale.

**It does not survive.** Remediation reappeared. But the confounds are large enough that the
magnitude should not be quoted, and the run's most valuable output is not the timing table —
it is four defects that each reported success while doing nothing or doing harm.

## TL;DR

- **The parallel path engaged on every real phase.** `strategy: parallel` on all four,
  12/10/9/11 tasks, 5-wave / 4-wave shapes, up to **7 concurrent worktrees**. First time ever.
- **Remediation is back: 2 of 5 exec runs (40%), or 2 of 3 complete runs (67%)** against
  run #1's 0% and OCP's 64%. Both were single-cycle and resolved; **no `max-cycles`**, unlike OCP.
- **The wave integrator ran a bare `git stash -u` in the shared working tree and never popped
  it**, destroying another phase's completed plan. The next workflow then found no plan,
  discovered **0 tasks**, and reported a benign-looking sequential no-op. Four steps, each
  reporting success. Fully recovered from `stash@{0}^3`.
- **17 task-executions were thrown away** across phases 1-3 because parallel worktrees forked
  from `origin/main` instead of local `HEAD`, so entire waves came back STALE and were healed.
  **Workaround confirmed:** keep `origin/main == HEAD` at launch and make no commits during the
  run → phase 4 healed **zero**.
- **The integrator bail is per-branch, not per-wave** — §5.2's defect condition is NOT met.
  Proven by a mixed wave: `t2` preserved as stale while its peer `t5` cherry-picked and torn down.
- **ADR-034, ADR-033 and ADR-032 all work.** Canon pull preserved a local-only ADR and said so;
  agent acceptance records `accepted_kind: "agent"`; the pipeline gate fired on every phase.
- **Forge MCP is still absent.** The phase-15 connected-mode UAT has still never run.

## 0. A premise correction the brief could not have known

**Run #1's `cgbench` no longer exists.** It lived at `/home/appuser/astro-cgbench` with a bare
origin at `/home/appuser/cgbench-origin.git` — the ephemeral container home. Only `/data` and
`/Users/buu/Development` persist. Confirmed absent from the container and from the host under
`/Users/buu`. The only survivor is the run-#1 transcript.

So "extend `cgbench`, do not start fresh" could not be satisfied by inheritance. On the
operator's instruction the seed was **reconstructed by hand, outside the astro-code loop and
outside the measurement**: a changelog generator with 14 modules, **232 tests**, 14 conventional
commits, tags `v0.1.0`-`v0.3.0`, a binding `CONVENTIONS.md`, and a real `.astrocode/` canon
adopted via `/astro-adopt` + `astro-mapper`.

**This is a real confound and it is not small.** The measured phases integrate against
pre-existing code with established conventions — which is what the brief wanted — but that code
is a stand-in authored by the same agent that then ran the benchmark, not run #1's artifact.
Cross-run comparison of the *codebase* is not apples-to-apples. The measured quantity
(durations, remediation, strategy) is a property of the framework, not of the code.

**Any future benchmark codebase must live under `/Users/buu/Development/<name>`.**

## 1. Preconditions — actual output

| check | result |
|---|---|
| `astro-code` HEAD | `25f6ebd fix(canon,execute): stop canon pull destroying local-only ADRs; make the pipeline gate observable (ADR-034)` |
| `package.json` | `0.11.2` |
| `~/.astro/code/version` | **`0.11.2`** ✓ |
| `node --test` | **447 pass / 0 fail** ✓ |
| `commands/` `agents/` `workflows/` vs repo | byte-identical (`diff -rq` clean) ✓ |
| `ac` on PATH | `/data/bin/ac -> /Users/buu/Development/astro-code/bin/ac.mjs` ✓ |
| Forge MCP | **absent** — `select:` on the three tools returns nothing; a keyword sweep returns only `WebSearch` |

Config was left at `ac init` defaults: `use_worktrees: true`, `max_concurrent_agents: 6`,
`lean_execution: true`. Note `ac init` writes `models.integrator: "haiku"` **explicitly** rather
than leaving it unset — same tier either way, but "unset" is not what a fresh project gets.

## 2. Measurement against the §4 baseline

Both sanity gates were checked. **`parse failures` = 0** — the unescape is correct and every
verdict field parsed. The second gate is discussed in §2.2; it fails as specified.

Timings exclude one run: `wx8iyke92`, the 2.3-minute phase-3 no-op that executed **zero tasks**
because its plan had been destroyed (§4.1). Including it would drag the exec mean from 30.5 to
25.8min and dilute the remediation rate from 40% to 33% on work that never happened.

| | OCP v0.9.x runs | total | mean | **v0.11.2 runs** | **total** | **mean** |
|---|---|---|---|---|---|---|
| plan | 9 | 1.76h | 11.7min | **5** | **1.13h** | **13.5min** |
| exec | 11 | 9.27h | 50.6min | **5** | **2.54h** | **30.5min** |
| exec, `remediationCycles == 0` | 4 | 2.54h | 38.0min | **3** | **1.06h** | **21.2min** |
| exec, `remediationCycles > 0` | 7 | 6.74h | 57.8min | **2** | **1.48h** | **44.4min** |
| **remediation rate** | | | **64%** | | | **40%** |

Run #1 (greenfield, all-sequential) for reference: plan 8.2min, exec 11.8min, remediation 0%.

Per-run, deduped:

```
plan   p01   12.5min                    exec  p01   48.4min  rem=1  parallel  12t  healed=7
plan   p02   15.1min                    exec  p02   37.5min  rem=0  parallel  10t  healed=6
plan   p03   12.6min                    exec  p03   40.4min  rem=1  parallel   9t  healed=4
plan   p04   14.5min  (undersized)      exec  p04    6.5min  rem=0  parallel  11t  healed=0
plan   p04   13.0min  (re-plan)         exec  p04   19.6min  rem=0  parallel  11t  healed=0
                                        exec  p03    2.3min  rem=0  sequential 0t  EXCLUDED (no-op)
other  mapper 3.1min
```

`stoppedReason` values seen: `passed` (3), `single-pass` (1, the no-op), `integration-failed` (2).
**No `max-cycles`** — OCP exhausted its remediation budget; this run never did.

### 2.1 Two readings of the remediation rate, both defensible

- **All real exec runs (n=5): 40%.** Includes phase 4's two partial runs, which aborted at
  integration for reasons unrelated to remediation. Most comparable to OCP, whose 11 runs
  included `max-cycles` and `integration-failed` stops.
- **Complete successful runs only (n=3): 67%.** The three phases that ran end to end.

Both are above 0%. **The 0% does not survive.** Whether the true rate is nearer 40% or 67% is
not determinable at n=3-5.

### 2.2 §3's second sanity gate is confounded and needs fixing

Quiescent, the script reports **12 deduped runs against 11 workflow directories**. That is not
drift. The `astro-mapper` spawned by `/astro-adopt` is a plain `Agent` call: it emits a
task-notification with `<duration_ms>` and `<task-id>` but has **no workflow directory**. It is
classified `other` (`{other: 1, plan: 5, exec: 6}`).

**The gate should compare `plan + exec` rows against workflow dirs, not all rows.** Corrected,
it reads 11 == 11 ✓. As written it will mis-fire on any run that uses a bare Agent call — which
includes `/astro-adopt` and every Agent-fallback tier.

(`rem = -1` on all five plan rows is expected, not a parse failure: plan payloads carry no
`remediationCycles`, and the gate is correctly scoped to exec rows.)

### 2.3 Why these numbers cannot carry a strong conclusion

1. **n = 3-5.** Too small for a rate.
2. **The seed is a reconstruction** (§0), authored by the benchmarking agent.
3. **17 of the exec task-executions were wasted work** (§4.2), inflating phases 1-3's durations
   by an unknown but large amount. Phase 1 executed 19 tasks for a 12-task plan.
4. **Two of five runs aborted on defects unrelated to remediation** — a malformed integrator
   report and an API connection loss.
5. **One heal storm was operator-caused** (§4.3) — the operator committed during phase 3.
6. **Discussion was agent-driven** (§6), so the CONTEXT.md inputs are more uniform and more
   explicit than a human's would be.

## 3. §5 feature checks

### 5.1 Parallel path — ENGAGED ✓

All four phases: `strategy: "parallel"`, tasks 12 / 10 / 9 / 11, all above `seqBudget` 8.
Wave shapes 7+1+1+2+1, 5+2+2+1, 3+4+1+1, 5+3+1+2. Up to **7 concurrent worktrees**, observed
live at `.claude/worktrees/wf_3628c093-49a-2..-8`.

**Phase 4's first plan came back at exactly 8 tasks** — at `seqBudget`, so the cutover
(strictly-greater) would have silently degraded it to sequential. Caught by checking the plan
before executing, as §2 requires, and re-planned to 11 with an explicit instruction to
decompose by filter kind. **Without that pre-execution check the phase would have tested nothing.**

### 5.2 Wave integrator at haiku — PER-BRANCH, not a defect ✓

The defect condition (a per-wave bail) is **not met**. Decisive evidence, phase 2 wave 2:

> *"worktree-wf_4f429cc0-341-15 (t2) is STALE—merge-base a04c130 differs from HEAD b151fca—preserved per ADR-015 for the heal ladder. worktree-wf_4f429cc0-341-16 (t5) was not stale, cherry-picked cleanly (commit 8fbf931), and torn down; it carries an advisory for test/cli.test.js (mirror test, unclaimed by peers)."*

One branch preserved, its clean peer landed, **in the same pass**, with a file-overlap advisory.
Phase 3 repeated it: `t5` and `t6` cherry-picked, `t7` preserved.

When it bailed on a whole wave it was because every branch was genuinely stale, and it said so
per-branch with each `taskId`:

> *"All seven candidate branches are stale (merge-base 00f2a93 ≠ HEAD fb0c94b). Per ADR-015, stale branches are preserved without cherry-pick. The heal ladder will re-run each task against the current HEAD."*

**The integrator's cherry-pick judgement is sound at haiku. Its side effects and its report
schema are not** — see §4.1 and §4.4.

### 5.3 Heal ladder + post-heal test gate — FIRED CORRECTLY ✓

17 heals across phases 1-3. Executors explicitly refused to resurrect stale branches
("Implemented the fourth seam fresh against current `main` tip (no worktree resurrection)").
The post-heal gate **ran the real suite** — not a missing-suite skip, which would have been wrong
here since cgbench has 232+ tests. Final state after every phase: zero `worktree-*` refs.

### 5.4 ADR-032 pipelining — FIRED ON EVERY PHASE ✓

One line, every time, never silent — including both negative branches:

```
pipeline: phase 2 is discussed, pending and unplanned — planning it concurrently
pipeline: phase 3 is discussed, pending and unplanned — planning it concurrently
pipeline: phase 4 is discussed, pending and unplanned — planning it concurrently
pipeline: phase 4 is already planned — nothing to plan ahead
pipeline: no phase after this one
```

This only worked because **all four phases were discussed up front**. Under the naive
`discuss N → plan N → execute N → accept N` order the gate can never pass. The docs now say so
(`astro-execute.md:130`) and that instruction is what made the difference. Phase 2's 15.1min plan
and phase 3's 12.6min plan cost zero wall-clock.

### 5.5 ADR-034 canon pull — WORKS ✓

Provoked deliberately by hand-writing `## ADR-999` into `.astrocode/DECISIONS.md`:

```
✓ pulled DECISIONS.md, CONVENTIONS.md from astro-registry
⚠ kept 1 local-only decision(s) the registry has never seen: ADR-999 — re-add them via
  `ac decision add` so they reach the team (DECISIONS.md is never bulk-pushed).
```

Preserved, reported by id, and given a repair path. ADR count 5 before, 5 after. **The silent
destruction from run #1 is properly fixed.**

### 5.6 ADR-033 acceptance provenance — WORKS ✓

`ac phase accept <n> --agent "FORGEMASTER"` on all four phases. Terminal:

```
✓ phase 1 "..." accepted by FORGEMASTER (AGENT — machine-signed, not human UAT) → complete
```

`roadmap.json`: `"accepted_by": "FORGEMASTER"`, `"accepted_kind": "agent"`, `"accepted_at": ...`.

### 5.7 Stale worktrees — the bug is REAL and WORSE than hypothesised

Zero stale `worktree-*` refs survived any phase. But the *fork base* is broken, and it is not
specific to feature branches. See §4.2 — this subsumes the §5.7 hypothesis: on a feature branch
`origin/main` is never the tip, so every branch would come back stale. Same root cause, worse
presentation. **The controlled experiment on a feature branch was not needed** — the bug
reproduces on `main`.

## 4. Bugs

### 4.1 The wave integrator ran `git stash -u` and silently destroyed a completed plan — CRITICAL

`wf_4f429cc0-341 / agent-a86f07f412533da90`,
`{"agentType":"astro-executor","spawnDepth":1,"model":"haiku"}`, carrying `staleBranches`,
`cherry-pick` and `integrated` markers — i.e. the **wave integrator** (spawned as
`astro-executor` at the `models.integrator` tier; `models.executor` is `sonnet`, so `model:haiku`
identifies it unambiguously).

It ran a bare **`git stash -u`** in the shared main working tree at 13:05:18 and **never popped
it**. `-u` includes untracked files, so it swept away phase 3's completed plan artifacts.

Filtering on *actual tool invocations* rather than prompt mentions, only three agents ever ran
`git stash` in the entire benchmark — and the contrast is the finding:

| agent | model | command | scoped | popped |
|---|---|---|---|---|
| executor | sonnet | `git stash push -- src/index.js && …` | ✅ | ✅ |
| executor | sonnet | `git stash push -- src/render/json.js && … ; git stash pop` | ✅ | ✅ |
| **integrator** | **haiku** | **`git stash -u`** | ❌ | ❌ |

The correct discipline exists and the sonnet executors follow it. The integrator alone violates
it — in the one role that operates in the shared working tree by design.

**The full chain, four steps, each reporting success:**

1. Integrator stashes, and returns a correct-looking per-branch report (`integrated:false` + note).
2. Phase 3's `PLAN.md` (388 lines), `CRITERIA.md` (149) and `ACCEPTANCE.md` leave the working tree.
3. `git add -A && git commit` legitimately finds nothing — commit `c03fdae` contains no phase-3 files.
4. `execute-phase` for phase 3 finds no plan → **`tasks: 0, waves: 0, executed: 0,
   strategy: "sequential", stoppedReason: "single-pass", integrationFailed: null`** — every field
   benign, indistinguishable from a small sequential phase.

**Only the verifier caught it**, precisely because `CRITERIA.md` was gone too: `criteriaFound:
false`, self-derived 7 criteria, all FAIL, *"the phase was never executed."* Honest failure
surfaced by the one component designed to be adversarial.

Recovered intact via `git checkout 'stash@{0}^3' -- <phase dir>`.

**Two fixes needed:** (a) the integrator must never run an unscoped stash in the shared tree —
if it needs one it must be `git stash push -- <path>` with a guaranteed pop; (b) **`tasks: 0`
must be a hard error**, not a silent sequential no-op.

### 4.2 Parallel worktrees fork from `origin/main`, not local `HEAD` — HIGH

`execute-phase.mjs:738` tells the integrator the branches "forked from the current HEAD". They
do not.

| run | wave | fork base | vs local HEAD | outcome |
|---|---|---|---|---|
| p01 | W1 (7) | `00f2a93` = `origin/main` | 2 behind | all 7 STALE → healed |
| p01 | W4 (2) | integrated tip | current | cherry-picked ✓ |
| p02 | W1 (5) | `a04c130` = `origin/main` | 1 behind | all 5 STALE → healed |
| p02 | W2 (2) | mixed | — | `t2` stale, `t5` clean |
| p03 | W1 (3) | `16c6732` = `origin/main` = HEAD | current | (see §4.3) |
| p04 | W1 (5) | `origin/main` = HEAD | current | **healed: [] ✓** |

Phase 2 was controlled to one-commit precision: `origin/main = a04c130`, local `HEAD = e87b61f`,
ahead by exactly 1 — and both worktrees were created **at `a04c130`**.

In all 15 wave-1 worktrees whose base was inspected directly, the base was exactly `origin/main`.
It is not universal — phase 2's wave-2 branch `-16` was not stale while its wave-mate was — so
the mechanism is not fully characterised, and it is the **harness's** `isolation: "worktree"`
that chooses the base, not astro-code.

**Cost: 17 task-executions thrown away.** Phase 1 executed 19 tasks for a 12-task plan; phase 2,
16 for 10; phase 3, 13 for 9. Full executor cost, twice, for zero benefit — and the run still
reports PASS. Nothing in the human-facing verdict says half a wave was discarded; only
`executed` vs `tasks` records it, and it is not in the summary text.

**Workaround, confirmed:** keep `origin/main == HEAD` at launch **and make no commits during the
run**. Phase 4 did exactly that and healed **zero** of 11 tasks.

### 4.3 Operator contamination — recorded so the phase-3 numbers are not misread

Phase 3's wave-1 heal was **not** a framework fault. The operator committed three times during
the run, moving `HEAD` out from under worktrees that were born current:

> *"All three executor branches are stale relative to current HEAD (09b6488). Forked from merge-base 16c6732, which is 3 commits behind."*

`16c6732` was `HEAD` at launch. Phase 4 is the clean, uncontaminated re-test.

### 4.4 The integrator's report schema is wrong, aborting a phase whose work was fine — HIGH

Phase 4 wave 1, the integrator returned:

```json
{"integrated": true, "branches": ["main"], "tornDown": ["...-2","...-3","...-4","...-5","...-6"]}
```

`branches` is meant to list the **source** branches cleanly cherry-picked; it filled it with the
**target** branch it picked onto. The script's data check (`tornDown` must be a subset of
branches cleanly picked this run) found zero confirmations for five deletions and aborted:

> *"integrator reported tornDown=[…] without confirming a clean pick this run — the delete already happened agent-side (the script runs no git, ADR-008); the ref may still be recoverable via `git reflog`"*

**Ground truth: the work had integrated correctly.** All five wave-1 commits were on `main`
(`7dc04fb`, `08910d8`, `53be5d9`, `8425917`, `05dcc29`) and `node --test` was 513/513 green.

**The guard is right and should stay** — it refused to trust an unverifiable teardown and
pointed at recovery. But a whole phase died on a reporting-schema error at the haiku tier. This
is the second haiku-integrator defect, after §4.1.

### 4.5 Executors silently dropped the ADR-017 commit stamp — MEDIUM

Of phase 4 wave 1's five commits, only one carries `(phase 04 t2)`:

```
STAMPED    08910d8  feat(filter): add src/filter.js with author predicate + compose core (phase 04 t2)
UNSTAMPED  7dc04fb  feat(isotime): add clock-free ISO-8601 parsing engine for date bounds
UNSTAMPED  53be5d9  test(git): pin logRange's pathspec seam as a load-bearing contract
UNSTAMPED  8425917  Parse repeatable --path/--author and scalar --since/--until flags
UNSTAMPED  05dcc29  Add filtered: {examined, kept} to the JSON envelope
```

Two are not even conventional-commit shaped, violating the project canon the executors were
handed. **Stamp-mapping is how the integrator matches a branch to a task**, so this directly
feeds §4.4. Nothing detected it.

### 4.6 A remediation commit claimed more than it delivered — MEDIUM (generated code, not framework)

Phase 1's remediation commit `d636f83` is titled *"fix: recurse validateConfig into types
entries so malformed section/bump values fail loudly"*. It validates **`section` only**. Its own
rationale comment asserts:

> *"`bump` is left unchecked past `types` being an object — an unrecognised bump value already fails loudly and separately via `applyBump`."*

**That is false.** `inferBump` never selects an unranked value, so `applyBump` never sees it.
Probe at HEAD: `{"types":{"feat":{"section":"S","bump":"huge"}}}` with `--current-version 1.0.0`
→ **exit 0**, `# Changelog 1.0.1`. An unknown nested key is likewise ignored silently.

**Credit where due: the opus verifier caught this unprompted** and reported it as an explicit
caveat rather than burying it, correctly marking it non-blocking as it fell outside the
pre-registered criteria. The framework's honesty layer worked; the code it generated overstated
itself in both its commit message and its comment.

### 4.7 `.claude/` is not gitignored — LOW

`git add -A` during a parallel phase commits live agent worktrees as embedded git repos
(reproduced by the operator; fixed with `git rm -r --cached .claude/worktrees` + a `.gitignore`
entry). astro-code scaffolds no `.gitignore` entry for `.claude/`. Given §4.1 makes committing
plan artifacts promptly the correct defence, users *will* run `git add -A` mid-phase.

### 4.8 Plan artifacts are left untracked — LOW, but it is what made §4.1 destructive

`plan-phase.mjs` writes `PLAN.md`, `CRITERIA.md` and `ACCEPTANCE.md` and leaves them untracked.
Any `git clean`, `git stash -u`, or worktree tidy destroys a completed plan. Either commit them
at the end of `plan-phase`, or have `execute-phase` refuse to start when the plan is untracked.

## 5. Provenance gap: `/astro-discuss` has no `--agent`

`ac phase context N` printed `ready` for all four phases on the strength of the marker alone.
Every CONTEXT.md here was authored by the agent, not a human — disclosed in each file's own
header, but the framework cannot tell the difference. **This is precisely the gap ADR-033 just
closed for acceptance**, still open one step upstream: a plan-blind bar derived from an
agent-written brief is less independent than one derived from a human's.

Phase 4's signature carries a further caveat, recorded in its commit: its workflow verifier
**never ran** (both runs aborted at integration), so the verification behind that `--agent`
signature is the operator's independent probing of all 11 pre-registered criteria, not the
framework's opus verifier.

## 6. Forge knowledge graph — §6 SKIPPED, phase-15 UAT still never run

`ToolSearch("select:mcp__forge__forge_knowledge,mcp__forge__forge_knowledge_list,mcp__forge__forge_capture_knowledge")`
→ no matching tools. A keyword sweep for forge/knowledge/capture returns only `WebSearch`.

**The reported root-cause fix did not restore the tools in this session.** No astro-code capture
has still ever reached the queue.

The degradation path itself is correct and worth recording as a pass: `/astro-discuss` and
`/astro-plan` both call for a scoped `forge_knowledge` query and both skipped **silently**, as
`templates/forge-knowledge.md` specifies, with no error and no spurious output.

## 7. What was built

`cgbench` went from the 232-test seed to **552 tests, 23 modules, 1,874 lines of `src/`**, 51
phase commits, zero dependencies, still fully offline and deterministic.

- **Phase 1** — config file layer: a fourth injectable `fsio` seam mirroring `exec.js`,
  upward discovery, strict validation, `mergeLayers` precedence, `--config` / `--no-config`.
  Also fixed a real pre-existing bug the mapper found (`groupCommits` silently dropped commits
  under `--all-sections`).
- **Phase 2** — renderer registry as the single format authority, a byte-stable `json` envelope,
  three named presets, `--list-formats` / `--list-presets`, and the hardcoded CLI version
  replaced by a read through the phase-1 seam.
- **Phase 3** — repeatable `--range` with per-commit attribution, hash dedupe (first range wins),
  `--group-by section|range`, union-wide bump, and `EXIT_EMPTY = 3` behind `--check`.
- **Phase 4** — `--path` through `logRange`'s previously-dead `{paths}` option, in-process
  `--author`, clock-free ISO `--since`/`--until`, AND-across / OR-within composition, and
  `filtered: {examined, kept}` in the JSON envelope.

Verified independently at HEAD: 552/552 green, no clock/env/`fs`/`child_process` outside their
seams, zero `worktree-*` refs, clean tree.

## 8. Recommended next actions

1. **Forbid unscoped `git stash` in the integrator prompt** (§4.1) — the single highest-value fix.
   The sonnet executors already model the correct `git stash push -- <path> … pop` form.
2. **Make `tasks: 0` a hard failure** in `execute-phase.mjs` (§4.1). A plan that yields no tasks
   is never a legitimate sequential run.
3. **Fix the worktree fork base** (§4.2) — harness-side. Until then, document the workaround:
   push before executing, and do not commit during a phase. Worth 17 wasted executions here.
4. **Commit plan artifacts at the end of `plan-phase`** (§4.8), and ship a `.gitignore` entry for
   `.claude/` (§4.7).
5. **Tighten the integrator's report contract** (§4.4) — `branches` means sources; consider
   validating the shape before the teardown check, so a schema slip does not read as data loss.
6. **Enforce the ADR-017 stamp** (§4.5) — reject an executor commit whose subject lacks
   `(phase NN tK)`, since the integrator depends on it.
7. **Add `--agent` to `/astro-discuss`** (§5) to close the provenance gap one step upstream.
8. **Re-run this benchmark once the worktree base is fixed.** The remediation question deserves
   an answer that is not confounded by 17 wasted executions; with the fork bug fixed and n≈10,
   the rate would mean something.

## 9. Answer to the open question

**Does the 0% survive when phases are large, waves are parallel, and the code already exists?**

**No.** Remediation reappeared at 40% (n=5) or 67% (n=3) against run #1's 0%. ADR-031 helped the
easy case — small, sequential, greenfield phases — and the harder case still needs remediation.
That is a real and reportable result.

**But it does not follow that ADR-031 failed, and the numbers here cannot support a stronger
claim than the direction.** Both remediations were single-cycle and both resolved
(`stoppedReason: "passed"`); OCP's 64% included runs that exhausted `max-cycles` and failed
outright, which never happened here. On that axis the mechanism looks better even where the rate
matches. With n=3-5, a reconstructed seed, 17 wasted executions inflating three of the runs, one
operator-contaminated phase and two runs aborted on unrelated defects, **the honest conclusion is
that the mechanism works and the theory remains unproven** — the same verdict run #1 reached, for
different reasons.
