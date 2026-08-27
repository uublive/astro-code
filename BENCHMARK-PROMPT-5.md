# astro-code benchmark #5 — small, fast, and watchable

**Hard budget: ~3 hours, 4 phases, and a project a person can look at.** Run #4 took a
whole day (12 phases, 188 commits, 19.6M tokens) to answer a question that was already
answered by phase 6. Do not repeat that. If you find yourself at phase 5, stop and report.

This run has exactly two jobs:

1. **Does ADR-040 remove the wasted executions?** Run #4 burned **74 of 227 executions
   (33%)** re-running work discarded for a stale fork base. v0.13.0 makes each parallel
   executor fast-forward its worktree onto the working branch before it starts. If it
   works, `WASTED EXECS` collapses toward 0 and throughput improves for the first time in
   the series.
2. **Does ADR-041 catch a dropped task?** Run #4's worst finding was integration tasks
   silently producing no commit while the phase reported PASS. There is now a stamp audit
   between execution and verify. Prove it fires.

Everything else is secondary. Do not chase it.

---

## 0. Preconditions

```bash
cd /Users/buu/Development/astro-code
cat ~/.astro/code/version          # MUST read 0.13.0
node --test 2>&1 | tail -5          # expect 477 pass / 0 fail
```

Project must live under `/Users/buu/Development/<name>` (container home does not persist).
Stay on `main`. `git push` before each `/astro-execute` and make no commits during a phase —
`ac preflight` will tell you if you forget.

---

## 1. What to build — a web app, and one you can watch

Build **a small browser app with a visible test runner**, because the operator wants to
open a browser tab and *see* the tests executing rather than read a pass count.

Suggested: a **kanban / task board** or a **unit-conversion calculator** — small, visual,
genuinely interactive, no backend, no network, no auth.

Non-negotiables:

- **Plain HTML + CSS + vanilla ES modules.** No React, no build step, no bundler, no npm
  install. It must open by double-clicking `index.html` or via `python3 -m http.server`.
- **A browser-visible test page: `tests.html`.** Opening it runs the suite *in the page* and
  renders each test as a row that goes green or red as it executes, with a running
  pass/fail tally. This is the thing the operator will watch — it is a deliverable, not a
  nicety. Make it legible: test name, status, duration, and the assertion message on failure.
- The same tests must also run headless under `node --test` so astro-code's verifier and the
  post-heal gate can gate on them. One source of truth for the test bodies; two runners.
- Deterministic: no clock, no random, no network. Inject anything that would be.

**Use the in-browser testing capability** to drive `tests.html` yourself during verification
— open it, watch the suite run, and screenshot or describe what actually rendered. A phase
whose criteria claim "tests pass" but which nobody opened in a browser has not been checked
the way this run cares about.

Sizing: **4 phases, 9–12 tasks each.** Above `seqBudget` 8 so the parallel path engages;
small enough to finish. Check the task count in `PLAN.md` before executing — a plan at
exactly 8 silently runs sequential.

---

## 2. Measurement

Use the corrected extractor from `BENCHMARK-PROMPT-4.md` §3 verbatim — it bounds each blob
at `</task-notification>`, unescapes the payload, and dedups by task-id. Do not rewrite it.
Three of five briefs shipped a broken script; this one is known good.

**One denominator for every rate: execute runs carrying at least one planned task.** Run #4's
figures below were recomputed on that rule, so they differ slightly from earlier reports
(remediation read 6% and min/task 2.89 under looser denominators). Use the same rule or the
comparison is meaningless.

Report, in this order:

| metric | run #1 | run #2 | run #3 | run #4 | run #5 | pass condition |
|---|---|---|---|---|---|---|
| `WASTED EXECS` | 0 | 17 | 36 | **74** | ? | **the headline** — should collapse toward 0 |
| first-pass task rate | 100% | 68% | 78% | **67%** | ? | should climb well above 67% |
| `min/task` | 2.26 | 2.88 | 2.69 | **2.84** | ? | should drop below 2.69, ideally toward 2.26 |
| remediation rate | 0% | 40% | 11% | **7%** | ? | should stay ≤ 10%; not the question this time |
| `healed` total | 0 | — | 48 | **75** | ? | falls with WASTED EXECS |
| tokens / task | — | — | — | **87k** | ? | cost, which time does not capture |

**First-pass task rate** = tasks landing with no heal and no remediation, ÷ total tasks. It
is the sharpest signal here and it is *not* the remediation rate: run #4 had the best
remediation rate of the series (7%) and its **worst** first-pass rate (67%). A third of
individual tasks needed re-running while only 7% of runs got rejected — those measure
different things, and only one has been improving.

**Throughput has never moved in four runs** (2.26 → 2.88 → 2.69 → 2.84) while remediation
fell ninefold. The stale-fork tax ate every gain. ADR-040 is the first change aimed at it,
so run #5 is the first run where min/task *should* fall. If waste collapses and min/task
still does not move, say so plainly — that means the bottleneck is somewhere nobody has
looked yet, which is a more valuable finding than a confirmation.

Also record, cheaply, two things nobody has ever tracked:

- **Ceremony tax** — for one phase, the elapsed minutes from `/astro-discuss` starting to
  its first task commit landing. Everything before the first commit is overhead.
- **Defect escapes** — any defect found during phase N that an *earlier* phase's verifier
  should have caught. One line each. This is the only measure of whether verification
  actually works, and it cannot be reconstructed afterwards.

---

## 3. Prove ADR-041 fires

After a phase completes cleanly, provoke it deliberately:

1. Note a task id whose commit exists, e.g. `t3`.
2. `git commit --amend` that commit to strip `(phase NN t3)` from its subject — the work
   stays, only the stamp goes.
3. Re-run `/astro-execute <n>`.

Expect: `integrationFailed` naming `t3`, a note that says the task either produced no commit
or committed unstamped, **no verify spawn**, and the phase not marked verified. Restore the
stamp afterwards.

If it does not fire, that is the most important sentence in your report.

---

## 4. Report — keep it short

One page. The table from §2 against run #4, the §3 result, and anything that **silently did
nothing while looking like success** — ten instances so far, and it remains the highest-yield
thing you can return.

Do not write a 450-line report. Run #4's was excellent and nobody needs another one that
size to answer two questions.

Sign every acceptance with `ac phase accept <n> --agent "FORGEMASTER"`, and use the agent
form of the discuss marker: `<!-- astro-discuss: captured by agent: FORGEMASTER -->` (the
gate accepts it as of v0.12.2).
