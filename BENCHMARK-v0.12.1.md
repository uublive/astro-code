# astro-code benchmark run #3 — v0.12.1 (ledgerforge)

Report: https://claude.ai/code/artifact/d3382ae1-8fed-4bd3-a4ad-e519d3381c47
Project built: /Users/buu/Development/ledgerforge (8 phases, 203 commits, 2161 tests)
Date: 2026-08-25/26. Written by FORGEMASTER.

## Headline
```
REMEDIATION RATE   13% (n=8 real exec runs; 1 remediation, single-cycle, resolved)
                   no max-cycles, no exhausted budget, in any run
plan mean          14.1 min (n=8)
exec mean          71.6 min (n=8 real; NOT comparable to prior runs — phases were 9-39 tasks)
origin==HEAD       10/10 launches verified
WASTED EXECS       36 by the §3 formula; 48 heal re-runs actually observed
parse failures     0        sanity gate  plan+exec 18 == 18 workflow dirs
ADR-017 stamps     128/178 (72%); 84% excluding the batched phase
```

## Per-run ledger

| # | phase | launch base | HEAD==origin? | strategy | tasks | executed | wasted | healed | remCycles | stop | min | verdict |
|---|-------|-------------|---------------|----------|-------|----------|--------|--------|-----------|------|-----|---------|
| 1 | 01 money | d3b8aee | YES | parallel | 9 | 10 | 1 | t7 | 0 | passed | 22.6 | PASS |

## Run 1 notes
- §0.2 HELD: HEAD == origin/main == d3b8aee at launch, tree clean, `ac preflight` silent.
- Parallel path ENGAGED (9 tasks > seqBudget 8). Waves t1 | t2,t3 | t4 | t5,t6,t7,t8 | t9.
- 1 wasted exec = the t7 heal re-run, NOT a mass-staleness event. See STALE-BASE finding below.
- Verifier PASS on all 9 pre-registered criteria, with independent fuzzing beyond the criteria
  (200k allocate cases, 40k BigInt-reference rounding cases, 20k format/parse round-trips) and
  a poisoned-Intl hostile-locale harness confirming ADR-005 holds. 226 tests, 0 fail.
- Stamps: 6 stamped / 3 unstamped (t1, t3, t8).

## STALE-BASE finding (run 1) — §0.2 held and a branch STILL forked stale
Wave 4 was t5, t6, t7, t8. The integrator reported:
  t5/t6/t8 -> non-stale, merge-base == current HEAD (ce85c3b, the t4 commit)
  t7       -> STALE, merge-base d3b8aee "predates HEAD (ce85c3b)"
d3b8aee is the run's LAUNCH base, which is also exactly what origin/main sat at for the whole
phase (no pushes during a phase, per §0.2). So within ONE wave, three peers forked from local
HEAD and one forked from the launch/remote base.
This matters for the run's central question: §0.2 compliance reduces staleness but did NOT
eliminate it. Run #2's 17 wasted execs came from HEAD being AHEAD of origin; here they were
equal at launch and one branch still forked stale mid-run, because local HEAD advances during
the phase while the remote does not. ADR-036's preflight cannot detect this — it checks the
launch instant only, and at that instant everything was in sync.
Cost here was bounded and correct: 1 branch, 1 heal, 1 wasted exec, phase still PASSed.
| 2 | 02 chart | e281537 | YES | parallel | 12 | 16 | 4 | t8,t9,t10,t11 | 0 | passed | 41.7 | PASS |

## Run 2 notes
- §0.2 HELD (HEAD == origin/main == e281537, clean tree, preflight silent). Still 4 wasted execs.
- Wave 5 (t8-t11) went stale WHOLESALE. Integrator: "All 4 candidate worktree branches share
  merge-base e281537 ... but current HEAD is 7e28ac3 — six commits ahead". e281537 IS the launch
  base and is exactly where origin/main sat all phase.
- Not a per-wave-bail defect: all four were genuinely stale, so preserving all four is CORRECT
  per-branch behaviour. Per-branch bail is proven by run 1 (3 landed, 1 preserved, same pass).
- Verifier ran real mutation testing: neutering the validator -> 31 failures; swapping the
  comparator to localeCompare -> 5 failures. The suite is load-bearing, not decorative.
- Stamps: 9 stamped / 3 unstamped. Integrator had to FALL BACK to heuristic mapping twice:
  "ec8e632, no stamp — mapped via fallback: file/message match to t4", same for 2e8c5a6/t5.
- 0 destructive git invocations of 340 Bash calls. Untracked plans for phases 03/04/05 survived.

## Run 3 (phase 03) — HARNESS INTERRUPTION, timing unusable
The Claude Code process restarted mid-workflow. astro-code did not fail: all 18 task commits
landed, the tree stayed clean, no stray worktrees, no orphaned stash, and `node --test` at the
resulting HEAD reports 625 pass / 0 fail. What was lost is the COMPLETION RECORD — the run
emitted no <task-notification>, so it contributes zero rows to the measurement script.
Recovery: relaunched with resumeFromRunId wf_28ec122c-670 (the documented path); completed
agents replay from cache, so the resumed run's duration_ms covers mostly cache replay + the
verifier and MUST NOT be read as this phase's execution time.
DISPOSITION: run 3's remediation/heal/strategy fields are usable; its DURATION is excluded
from all timing means, and this is stated wherever run 3's numbers appear.

### B6 confirmed a third time, and it worsens with wave depth (from the interrupted run's journal)
  wave A: picked 5, stale []
  wave B: picked 1, stale [t11, t12, t13]
  wave C: picked 1, stale [t14, t16]
  wave D: picked 1, stale [t15, t17]
7 stale branches across three consecutive waves; each of those integrators landed exactly ONE
of its candidates and preserved the rest. This is the deepest wave stack in the run (7 waves)
and it produced the most staleness, consistent with B6's mechanism: the fork base is frozen at
the launch commit while local HEAD advances with every wave that lands, so the gap — and the
number of branches that fall behind it — grows monotonically as the phase proceeds.
Note this is still CORRECT per-branch bail (§5.2): stale branches were preserved, not
destroyed, and the clean one landed in the same pass.

### Run 3 resume — MEASUREMENT ARTIFACT, must be quarantined
The resumed workflow returned:
  strategy "sequential", waves 0, tasks 18, executed 0, skipped [t1..t18], healed [], rem 0, passed
It correctly detected all 18 tasks already committed and skipped straight to verification. But
it EMITS A NOTIFICATION, so the measurement script records it as an exec row reading
`sequential(18t/0x)`.
That row is NOT a real execution:
 - its "sequential" strategy is an artifact of there being nothing left to dispatch, and must
   NOT be counted against §5.1's "was the parallel path engaged" question;
 - its duration (7.7min) is cache-replay + verifier only, not phase-03 execution time;
 - the REAL run 3 was parallel, 18 tasks, 7 stale branches, and emitted no row at all.
DISPOSITION: exec rows are reported BOTH raw and adjusted. Adjusted excludes this row from
timing means and from the strategy tally, and phase 03 is reported as parallel-with-no-usable-
timing. Stating both so the raw script output can still be reproduced from the transcript.

### Product defect surfaced by the phase-3 verifier (non-blocking, deferred to phase 8)
src/journal/entry.mjs: makeEntry passes a caller-supplied `reverses` through unvalidated
(`content.reverses ?? null`), so makeEntry(chart,{...valid..., reverses: 42}) returns ok:true,
while appendEntry then rejects the very same object with NotAnEntryError (isEntry requires
reverses to be null-or-string). A boundary that blesses a value the next layer refuses.
This is exactly the cross-layer inconsistency phase 8 exists to find; carried there.
| 4 | 04 ledger | 580b71e | YES | parallel | 17 | 24 | 7 | t5,t10,t11,t12,t13,t14,t17 | 0 | passed | 70.4 | PASS |
| 5 | 05 report | 61b6cd6 | YES | SEQUENTIAL(bug B7) | 24 | 24 | 0 | none | **1** | passed | 67.6 | PASS |

## Run 5 notes — the run's ONLY remediation, and it resolved
- FIRST remediationCycles > 0 of the whole run. The verify->remediate loop (ADR-031) fired once:
  verifier FAIL -> astro-executor scoped to the unmet criterion -> re-verify PASS.
  Agent roster confirms it: 1 discover, 2 astro-executor (batched + remediation), 2 astro-verifier.
  stoppedReason "passed", NOT max-cycles. This is the good shape §4 asks us to distinguish from
  OCP's budget-exhausting remediations.
- Remediation target was C5 (the double-close guard); the fix commit is
  5599e9b "fix(report): closePeriod succeeds as a no-op on a genuinely empty range".
- strategy sequential is BUG B7, not a property of the phase — 24 tasks with a 4-wide first wave
  should have gone parallel. Counted as sequential in the raw tally with the cause annotated.
- healed [] and executed == tasks: with no worktrees there are no stale branches, so B6 cost
  nothing here. The two bugs interact: B7 accidentally immunises a phase against B6.
- §5.9 STAMPS: 0 of 25 commits stamped. See B8.
| 6 | 06 store | 9962b1b | YES | parallel | 27 | 39 | 12 | 12 branches | 0 | passed | 134.5 | PASS |
| 7 | 07 cli | 0744e19 | YES | parallel | 39 | 32 | 0* | t20,t23,t27 | 0 | **integration-failed** | 55.2 | **FAIL** |
   *executed(32) < tasks(39): the phase ABORTED at wave 4, so waves 5-6 never dispatched.
    max(0, executed-tasks) therefore reads 0 — the §3 WASTED EXECS formula cannot see waste in
    an aborted run, and undercounts here. The 3 heals (t20,t23,t27) were real re-runs.

## Run 7 — the run's only FAILURE, and the post-heal gate behaved correctly
stoppedReason "integration-failed", verdict.passed false, criteriaFound false (never reached
verification). ADR-028's post-heal test gate ran the real suite (1710 tests) after healing wave 4,
found exactly ONE failure, and BLOCKED integration rather than proceeding:
    test/report/criteria-purity.test.mjs:189
    "no render-*.mjs imports ../ledger/, ../journal/ or ../accounts/"
    render-accounts.mjs must not import ../accounts/
This is the correct ADR-028 outcome for a project WITH a runnable suite — it neither skipped
(the missing-suite path, which would have been wrong here) nor waved the failure through.
State on abort was clean and recoverable: main left at 13bd43a, three worktree branches
PRESERVED not destroyed, plan artifacts untouched, no stash.

### Root cause: a genuine cross-phase architectural conflict (the coupling the brief asked for)
Phase 5 D1 pinned "renderers compute nothing" and shipped a purity test enforcing that no
`render-*.mjs` imports the domain layers. Phase 7's plan then ruled that the missing renderers be
added to `src/report/` (t6-t9), and t8's `render-accounts.mjs` called `normalSideOf(account.type)`
— a derivation inside a renderer, importing `../accounts/`. Two phases' constraints met and one
had to give. Neither agent was wrong in isolation; the conflict is only visible where they join.

### OPERATOR INTERVENTION — disclosed, and excluded from astro-code's credit
I resolved it myself rather than looping the machinery, because a re-run would have re-discovered
t8 as already-stamped/complete and hit the same gate again. Fix respects both constraints: the
derivation moved UP into the shell (`src/cli/commands/account.mjs`, which may legitimately import
`accounts/`), and the renderer now reads `account.normalSide` off its input. Three files touched:
render-accounts.mjs (drop import), account.mjs (derive before rendering), plus the two test files
whose expectations encoded the old contract. Suite back to 1710 pass / 0 fail.
This is operator work, not an astro-code success. Run 7 stays recorded as FAIL.
| 8 | 07 cli (retry) | fc05581 | YES | parallel | 39 | 19 | 0* | t31-t39 (9) | 0 | passed | 72.8 | PASS |
   *executed(19) < tasks(39) because 29 tasks were correctly SKIPPED as already-stamped.

## Run 8 notes — ADR-017 stamp resumability demonstrated end-to-end
skipped: [t1..t29] — the re-run grepped commit stamps on main, pre-seeded them into
buildWaves' `preCompleted`, and re-executed only the 10 unfinished tasks. This is exactly the
mechanism B8 endangers: a fully unstamped phase (like phase 05) could not be resumed this way,
and every task would re-run. Here it saved 29 re-executions.
Verifier re-flagged the three stale worktree branches from run 7 (B10), confirmed each was a
superseded duplicate whose task HEAD already carries, and recommended deletion. Deleted after
independent confirmation.
| — | 08 PROVOCATION (§5.3) | d371106 | YES | n/a | 0 | 0 | 0 | none | 0 | **no-tasks** | 0.3 | **FAIL (correct)** |
   Deliberate test, NOT a real exec run. Excluded from every mean and from the remediation rate.

## §5.3 tasks:0 provocation — PASS on all four prescribed conditions
Moved phase 08's PLAN.md aside, ran /astro-execute 8, restored it after.
  stoppedReason "no-tasks"                          -> as prescribed
  verdict.passed false                              -> as prescribed
  summary names the likely cause                    -> "the plan is missing, unreadable, or was
     destroyed after planning (check `git stash list` and `git status`; plan artifacts are
     untracked, so a stash/clean in the shared tree can remove them)"
  no executor or verifier spawn                     -> agent_count 1 (discover only), 17.4s
Closing line: "Refusing to report a benign no-op over work that may have been lost."
The previously-benign no-op is genuinely fixed, and the error text points straight at the run-#2
mechanism (an untracked plan destroyed by a stash/clean) rather than giving a generic message.
| 9 | 08 hardening | 12513cc | YES | parallel | 31 | 43 | 12 | 12 branches | 0 | passed | 108.0 | PASS |

## Bugs

## B1 — MEDIUM — /astro-config still steers the integrator back to haiku (ADR-035 revert incomplete)
`commands/astro-config.md` (installed AND repo) still carries the ADR-027 carve-out as LIVE
agent-facing instruction text, not a comment:
  L19/L22: profile listings state `integrator haiku`
  L31-32: "For `integrator`, offer `opus`, `sonnet`, `haiku` (default — same as leaving it unset)"
  L53: "the one haiku-tier role (ADR-027)"
The actual values in lib/models.mjs are `sonnet` for all three profiles, and `ac init` writes
sonnet — so the RUNTIME is correct. But any user running `/astro-config` is explicitly offered
haiku for the integrator and told it is the unset default. That is a documented, one-command
path straight back to the defect ADR-035 exists to prevent (bare `git stash -u` in the shared
tree that destroyed a completed plan in run #2).
Class: contradicts a shipped fix while looking fixed.

## B2 — LOW — stale comments in lib/models.mjs contradict the code beneath them
L47: "`integrator` is the sole haiku-tier role (ADR-027) — mechanical git bookkeeping, not
judgement." — directly above `balanced: { ... integrator: 'sonnet' }`.
L61: "`integrator` stays haiku (ADR-027) — a profile switch cannot leave it unset." — directly
above `fast: { ... integrator: 'sonnet' }`.
The file header correctly documents the ADR-035 revert; these two mid-file comments were missed.
Cosmetic, but they are the comments a future maintainer would trust when re-tuning profiles.

## B3 — INFO — installed version is 0.12.1, brief specifies 0.12.0
`cat ~/.astro/code/version` -> 0.12.1; repo HEAD aa89bca is 0.12.1 (ADR-036 preflight warning
landed after the brief was written). Installed == repo, so this is newer-not-stale. Test suite
reads 457 pass / 0 fail vs the brief's expected 453 (+4 from ADR-036). Recorded as a deviation
from the brief's stated preconditions, not a defect.

## B4 — HIGH — ADR-034's canon-pull rescue keeps only the ADR *heading* and silently destroys its body
`ac canon pull` reports success and reports the rescue, but the rescued decision is truncated
to its first line. Reproduced twice, controlled:

  before pull: heading=1 body=1 rejected=1
  ✓ pulled DECISIONS.md, CONVENTIONS.md from astro-registry
  ⚠ kept 1 local-only decision(s) the registry has never seen: ADR-998 — re-add them ...
  after  pull: heading=1 body=0 rejected=0

The `_date_`, `**Why:**` and `**Rejected:**` content — the entire substance of an ADR — is gone.
What remains is an orphan `## ADR-998 — ...` heading with no reasoning under it.

ROOT CAUSE — lib/canon.mjs:113
    localText.match(new RegExp(`^##\\s+${id}\\b[\\s\\S]*?(?=\\n##\\s+ADR-|$)`, 'm'))
The `m` flag makes `$` match end-of-LINE, not end-of-input. Combined with the lazy
`[\s\S]*?`, the match terminates at the earliest satisfying position — the end of the heading
line itself. The comment directly above it states the intent ("to just before the next heading
(or EOF)"), so the flag defeats the documented behaviour. It only works by accident when the
local-only ADR is followed by another `## ADR-` heading; a local-only ADR at EOF — the common
case, since DECISIONS.md is append-only — always loses its body.

Proof:
  CURRENT (m flag):   "## ADR-998 — canary"
  FIXED  (anchored):  "## ADR-998 — canary\n_2026-08-25_\n\n**Why:** UNIQUEBODYMARKER\n\n**Rejected:** ..."
Fix: anchor the alternative to true EOF, e.g. `(?=\n##\s+ADR-|$(?![\s\S]))`.

WHY THIS MATTERS: ADR-034 exists *specifically* to stop canon pull destroying local-only ADRs.
It converts total loss into partial loss while printing a message that claims a full rescue,
and a verifier grepping for the ADR id — the obvious check, and the one §5.7 literally
prescribes ("confirm it survives") — passes. The §5.7 check as written cannot detect this.
Class: contradicts a shipped fix while looking fixed / silently did nothing and looked like success.

## B5 — HIGH — ADR-035's agent-provenance CONTEXT marker fails the discuss gate; no test covers it
`/astro-discuss` instructs the agent, verbatim, to write
    <!-- astro-discuss: captured by agent: <name> -->
"when an agent answered the questions on the operator's behalf", and states explicitly:
    "Same gate either way; the provenance is recorded, not hidden (ADR-035, mirroring ADR-033)."

That claim is false. lib/planning.mjs:19 has exactly one marker regex:
    const CONTEXT_MARKER_RE = /<!--\s*astro-discuss:\s*captured\s*-->/i;
`captured` must be followed immediately by `-->`, so the agent form cannot match. Measured:
    human form -> ready
    agent form -> STUB   <-- ADR-035 form REJECTED
`grep -rn "astro-discuss:" lib/ commands/ agents/ workflows/` confirms this is the ONLY marker
handling in the system — there is no second path that accepts the agent form.

Consequence: a phase genuinely discussed by an agent is reported by `ac phase context <n>` as
`stub` — indistinguishable from never having been discussed. `/astro-plan` then treats the
phase as undiscussed, and ADR-032's pipeline gate (which requires phase N+1 discussed before
phase N executes) can never be satisfied by an agent-authored discussion. The feature is
inert in exactly the configuration ADR-035 added it for.

NO TEST COVERS IT: `grep -rn "captured by agent" tests/` returns nothing. The suite is
457 pass / 0 fail while this feature does not work at all. Green tests, dead feature.

Fix: `/<!--\s*astro-discuss:\s*captured\b[^>]*-->/i`, plus a test asserting BOTH forms gate to
`ready` and that the agent form's name is extractable.

WORKAROUND USED IN THIS RUN (deviation from brief §5.8, disclosed): every CONTEXT.md carries
the canonical marker on line 1 so the gate passes, immediately followed by an explicit
provenance line:
    <!-- astro-discuss: captured -->
    <!-- provenance: captured by agent: FORGEMASTER (ADR-035; canonical marker required
         because the agent form fails the gate — see B5) -->
Provenance is still recorded and visible; it simply cannot live in the field ADR-035 intended.
Class: shipped feature that silently does nothing and looks like success.

## B6 — HIGH — parallel worktrees fork from the frozen remote, so every wave after the first goes stale BY CONSTRUCTION
This is the run's headline finding and it reframes run #2's conclusion.

Run #2 attributed its 17 wasted executions to operator error: local HEAD being AHEAD of
origin/main at launch. §0.2 was written to fix that. This run honoured §0.2 perfectly on every
single launch — verified `HEAD == origin/main`, clean tree, `ac preflight` silent — and the
same failure still occurred.

MEASURED (run 2, phase 02):
  wave 1: "All 4 candidate branches were fresh (merge-base == HEAD)"      -> 0 wasted
  wave 5: "All 4 candidate worktree branches (t8,t9,t10,t11) share merge-base e281537
           ... but current HEAD is 7e28ac3 — six commits ahead"           -> 4 wasted
`e281537` is the launch commit, and is precisely where `origin/main` sat for the whole phase.

MECHANISM: the harness forks executor worktrees from the remote/launch base. `origin/main` is
frozen for the duration of a phase — necessarily, because §0.2 forbids commits and pushes
during a phase. Meanwhile local HEAD advances every time a wave's integrator lands its commits.
So wave 1 is fresh only because HEAD and origin coincide at launch, and each later wave forks
from a base that is N commits behind, where N grows with every wave that lands.

CONSEQUENCE: §0.2 bounds the damage to WITHIN-RUN drift; it cannot eliminate it. The two rules
are in direct tension — "origin must equal HEAD at launch" and "never commit during a phase"
together guarantee that origin falls behind HEAD as soon as wave 1 lands. A multi-wave phase
therefore cannot avoid stale waves under the documented protocol.

ADR-036's `ac preflight` CANNOT detect this: it samples the launch instant, when everything is
genuinely in sync. It is measuring the right quantity at the only time it is guaranteed correct.

NOT UNIFORM, which is itself a finding: run 1 wave 4 had three branches fork from current HEAD
(ce85c3b) and one from the launch base (d3b8aee), in the SAME wave. So the fork base is not
consistently the remote either; peers within one wave can disagree. I could not determine the
selection rule from outside the harness and am not going to guess at it.

COST SO FAR: run 1 = 1 wasted exec, run 2 = 4. Both phases still PASSed — the heal ladder
absorbed it correctly — but wall-clock and token cost are inflated, and `WASTED EXECS` is
therefore NOT a clean indicator of operator error the way §3 assumes.
Fix direction: fork worktrees from local HEAD at wave-dispatch time, not from the remote/launch
base; or re-base each wave's worktrees onto current HEAD before dispatch.

## B7 — HIGH — a missing `file` field from Discover silently degrades a whole phase to sequential
Phase 05 had 24 tasks (seqBudget 8) and a legitimately 4-wide first wave, yet ran
`strategy: "sequential"`, `waves: 24`, with zero worktrees and zero parallelism. It PASSED, so
nothing surfaced the loss.

CHAIN OF CAUSATION, each link measured:
1. execute-phase.mjs:161 `claimedFiles(task)` — `const raw = (task.file || '').trim(); if (!raw)
   return new Set(['*'])`. A task with no `file` claims the wildcard.
2. execute-phase.mjs:176 `filesCollide(a,b)` — `a.has('*') || b.has('*') || ...`. The wildcard
   collides with everything, INCLUDING another wildcard.
3. `buildWaves` greedy admission therefore admits only the FIRST ready task per wave and defers
   every peer, yielding 24 singleton waves.
4. execute-phase.mjs:515 strategy rule is
   `!useWorktrees || tasks.length <= SEQ_BUDGET || maxWidth < 2 ? 'sequential' : 'parallel'`.
   With useWorktrees true and 24 > 8, `maxWidth < 2` is the ONLY reachable path to sequential —
   and maxWidth was 1.

THE TRIGGER IS NON-DETERMINISTIC DISCOVER OUTPUT. Measured directly from the two runs' journals:
  phase 04 discover: first task keys = id,title,depends_on,done,file  -> 17 of 17 carry `file` -> parallel
  phase 05 discover: first task keys = id,title,depends_on,done       ->  0 of 24 carry `file` -> sequential
Same plan format (both use `- **depends_on:** \`t1\`` and `### tN — ...`), same models, same
config. Discover simply omitted the field for one phase. Dependencies were parsed CORRECTLY in
both cases (phase 05's t1-t4 all show `depends_on: []`), so this is not a dependency-parsing
failure — it is the file-claim field going missing.

WHY IT MATTERS: the fail-safe itself is defensible (don't parallelise when you cannot know what
a task writes). The defect is that it is SILENT and load-bearing. An operator reading the result
sees `strategy: "sequential"`, `waves: 24`, `passed` — and nothing that says "I degraded this
phase because the discover agent omitted a field". `deferredForFiles` is computed by buildWaves
but does not appear in the returned verdict object, so the one number that would have explained
it never reaches the caller. For a benchmark whose §5.1 question is literally "did the parallel
path engage", a silent downgrade is the worst possible failure mode: run #1's all-sequential
result was attributed to small phases, and this shows a LARGE phase can go sequential too, for a
reason invisible in the output.

Fix directions: (a) surface `deferredForFiles` and the maxWidth/strategy reasoning in the
returned object, not just an internal log; (b) make discover's `file` field required and fail
loudly when absent, the way ADR-035 made `tasks: 0` a hard failure; (c) treat a wildcard claim as
"unknown" and fall back to plan-declared waves rather than collapsing to width 1.

## B8 — MEDIUM — the lean/batched sequential executor emits NO ADR-017 stamps at all
Phase 05 ran sequential+leanExecution (one warm batched astro-executor over all 24 tasks) and
produced 25 commits, of which **0** carry the `(phase 05 tK)` stamp. Every other phase, executed
per-task through the parallel path, stamped most of its commits:
  phase 01  6 stamped / 3 unstamped
  phase 02  9 stamped / 3 unstamped
  phase 03 14 stamped / 4 unstamped
  phase 04 16 stamped / 1 unstamped
  phase 05  0 stamped / 25 unstamped   <-- batched executor
astro-code's own suite contains a PASSING test named
  "ADR-035: the batch prompt makes the ADR-017 stamp non-optional"
That test asserts the PROMPT STRING contains the requirement. It does not assert that the
resulting commits carry stamps, so it stays green while the behaviour is absent — the same
green-test/dead-feature shape as B5.
IMPACT: ADR-017 stamps are how the integrator maps branches to tasks, and how `buildWaves`
pre-seeds `preCompleted` for resumability (execute-phase.mjs "phase-07 resumability" block). A
fully unstamped phase cannot be resumed after a partial failure — every task would re-run. It
did no harm here only because sequential mode has no integrator and the phase completed.

## B9 — HIGH (measurement) — the §3 measurement script is STILL broken; third run in a row
§3's script splits the transcript on `<task-notification>` but never bounds each blob at the
closing `</task-notification>`. Every row therefore absorbs all following transcript text, up to
the next notification. Because this run pipelines (ADR-032) — an exec launch is followed in the
same turn by a plan launch whose tool result contains the string "Research a phase from several
angles in parallel" — the classifier
    kind: /Research a phase/.test(b) ? 'plan' : /Execute a phase/.test(b) ? 'exec' : 'other'
tests `/Research a phase/` FIRST and matches text belonging to the NEXT workflow. Exec runs get
relabelled as plan runs.

MEASURED, same transcripts, both scripts:
    §3 as written : plan runs=8  exec runs=3   REMEDIATION RATE 33%   WASTED EXECS 7
    corrected     : plan runs=6  exec runs=5   REMEDIATION RATE 20%   WASTED EXECS 12
Ground truth is 6 plan launches and 5 exec launches, which I can enumerate from my own tool
calls; the corrected script matches, §3's does not. Both agree plan+exec = 11 = the workflow
directory count, so §3's OWN SANITY GATE PASSES WHILE THE SPLIT IS WRONG — the gate only checks
the total, never the plan/exec division, so a misclassification is invisible to it.

The headline metric was wrong by 13 percentage points (33% vs 20%) and WASTED EXECS by 5.

FIX (one line): bound the blob before parsing —
    const raw = rawFull.split('</task-notification>')[0]
and, defensively, test `/Execute a phase/` before `/Research a phase/`.

This is the third consecutive broken measurement script: run #1's failed on JSON escaping, run
#2's was fixed for escaping and shipped this unbounded-blob bug, and run #3 inherited it. Every
number in this report comes from the corrected script; §3's raw output is quoted alongside so
the discrepancy is auditable.

## B10 — MEDIUM — a worktree and its branch survived teardown on `main` (confirms run #2's "known-but-unconfirmed" stale-worktree bug)
After phase 06 completed and reported PASS with `integrationFailed: null`, the repository still had:
    git worktree list -> /Users/buu/Development/ledgerforge/.claude/worktrees/wf_1d8aa245-dec-38
    refs/heads/worktree-wf_1d8aa245-dec-38  (2 commits not reachable from HEAD)
This is on `main`, with `use_worktrees: true` and no feature branch involved — the configuration
run #2's brief predicted should keep stale worktrees at ZERO.

The leak is benign in content but not in state. The two orphaned commits (t23, t26) were
superseded by heal re-runs that landed richer versions on main; verified by diff, HEAD is a
strict superset (branch is MISSING 8 test files entirely, and its export-round-trip suite is 123
lines against HEAD's 165). So no work was lost — but a mounted worktree and a branch ref persist
after a run that declared clean teardown.
Why it is easy to miss: `.gitignore` (correctly) ignores `.claude/worktrees/`, so `git status`
stays clean and nothing surfaces it. It was found only because the phase-06 VERIFIER volunteered
it as a non-blocking flag — no astro-code check reported it.
Consequence if unnoticed: refs accumulate across phases, and `buildWaves`/integrator stamp-mapping
both scan branch state.
Cleaned manually after confirming HEAD supersedes the branch.

## B11 — product defect (ledgerforge, not astro-code) — quadratic journal load
Surfaced by the phase-06 verifier as a non-blocking flag: phase-3 `appendEntry` is O(n) per call,
so `readJournalFile`/`parseJournalText` folding over it is O(n^2). Measured: 10k entries = 15.4s;
a 200k-record file did not finish in 8 minutes. `verifyJournalFile` is linear on the same file
(1.2s), and no phase-06 criterion reads at that scale, so the phase bar was correctly unaffected.
Carried to phase 08, whose D7 asserts complexity by counting operations rather than timing —
this is exactly the defect that test exists to catch.

## B12 — product defect (ledgerforge) — empty statement section crashes on currency lookup
Found by the phase-07 verifier by driving the real CLI: src/report/sections.mjs:81 reads
`chart.index[codes[0]].currency` without guarding an empty section, so `report balance-sheet` on
a chart with no liability accounts throws
`TypeError: Cannot read properties of undefined (reading 'currency')` and exits 1.
Reproduced both through the CLI and through a direct `balanceSheet()` call, so it is a phase-5
layer bug, not CLI wiring. The CLI classified the throw correctly (exit 1, one formatted line, no
stack trace) so no phase-07 criterion failed. Carried into phase 08.

## B13 — LOW/MEDIUM — an executor ran an UNSCOPED `git stash -u` (in its own worktree; popped cleanly)
Run 9, agent `astro-executor`, one invocation:
    git stash -u -m "wip t16 envelope code field" && git rebase main && git stash pop
Outcome, from the transcript: "Saved working directory and index state On
worktree-wf_4dd57fb4-83e-21 ... Successfully rebased ... On branch worktree-wf_4dd57fb4-83e-21
Changes not staged for commit: modified: src/cli/envelope.mjs". It popped. `git stash list` is
empty at end of run and no artifact was lost.

NOT the run-#2 critical regression, and §5.2 PASSES: that criterion names an unscoped stash or
`git clean`/`reset --hard`/`checkout .` run BY THE INTEGRATOR IN THE MAIN TREE. This was an
executor inside its own isolated worktree, on its own branch.

Why it is still worth reporting: git stash refs are REPOSITORY-wide (`refs/stash`), not
per-worktree. The three commands are chained with `&&`, so a rebase conflict would have skipped
the `pop` and left an unscoped stash — including untracked files — sitting on the shared stash
stack, exactly where run #2's destroyed plan went. It worked here because the rebase happened to
be clean. The safe form is the one the OTHER hit in this same run used:
`git stash push -- <pathspec>`, which is scoped and was correctly used elsewhere.
Only 2 destructive invocations across 1335 Bash calls in this run; 2 across ~5,500 for the run.

## B14 — LOW — a leftover `main-sync` branch survived the run
`git for-each-ref refs/heads/` shows `main-sync` alongside `main`, pointing at a phase-06 commit
(13ee7c1) with `git rev-list HEAD..main-sync` = 0, so it holds nothing HEAD lacks. Created by an
agent mid-run and never cleaned. Same family as B10 — ref hygiene after a run is not guaranteed.

## Forge (§6)

Tools PRESENT. ToolSearch probe resolved all three:
mcp__forge__forge_knowledge, mcp__forge__forge_knowledge_list, mcp__forge__forge_capture_knowledge.

## Real calls made (verify with: grep '"name":"mcp__forge__' — never the bare id)
1. `/astro-new-project` step 3 -> **forge_knowledge_list** (type=Preference, recency, limit 25).
   BROWSE, not search — which is what the command prescribes at that seam ("this is the one
   caller where browse may beat search"). Returned 10 Preference nodes. Correct behaviour.
   Used, not dropped: `just-in-time-roadmap-seeding` conflicted with the benchmark's mandated
   6-8 upfront phases and was stated as an override rather than silently ignored;
   `keyboard-first-ux` and `plain-sober-wording` were folded into the CLI conventions.
2. `/astro-discuss 1` step 1 -> **forge_knowledge** (scoped query built from the phase goal:
   money representation / integer minor units / rounding / allocation). Returned relevant
   generators (`simple-systems-overperform`, `sig-adr-001-raw-sqlite`) that reinforced ADR-003,
   plus `defer-multicurrency-outside-ledger`, which inverts here — it defers multi-currency
   *because the CRM is not the ledger*, and this IS the ledger. Stated in the discussion.

## Capture staged — FIRST EVER from astro-code
`/astro-decision` step 5 -> **forge_capture_knowledge** returned:
    capture queued for review (id: eed23166-e6be-4a5b-962f-04e8010352e4)
Node: Principle `avoid-locale-dependent-apis-when-output-must-be-reproducible`
Signal: `sig-adr-005-no-intl-byte-reproducible-ledger`
The ADR lifted cleanly into an honest project-agnostic generator (locale/ICU-dependent
formatting APIs vs byte-reproducible output) with no project nouns surviving, so it was
captured rather than skipped.
Per §6 this is a genuine milestone: no astro-code capture had ever reached the queue.
