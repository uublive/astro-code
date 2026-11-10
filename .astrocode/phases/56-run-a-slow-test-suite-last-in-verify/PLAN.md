# Plan: phase 56, run a slow test suite last in verify

This plan follows `.astrocode/CONVENTIONS.md`:
- Node ≥22 ESM `.mjs`, zero dependencies, `node:` builtins only, git through `lib/git.mjs`.
- Named function exports only. `bin/ac.mjs` stays a thin dispatcher. Use `die()` for fatal errors, the `✓ • ⚠ ⊡` glyphs, and `json()`.
- Module headers say *why* and name the bug each rule prevents.
- Workflow scripts use no semicolons.
- Every `lib/` change gets a `node:test` test on a real filesystem and real git (`mkdtempSync` + `git init`), with no mocks. A test may inject a `spawn` where the module already takes one.
- Every new reporting slot states its bound (`tests/commands.test.mjs`).

It follows `DECISIONS.in-force.md`:
- **ADR-093** (amends ADR-091) is already recorded: 2026-11-09, at 6928236. CONTEXT decision 6 is therefore done, and **no task claims an ADR**. P1 below refines how "last recorded run" is read. It is an implementation reading of ADR-093 and changes none of its terms.
- **ADR-079/089/091 and `verifiedGate` are unchanged in substance.** A held-back suite is stored as the existing `carried` + `last: 'unobserved'` entry, which every gate already refuses. No new verdict status is added.
- **ADR-090:** a suite criterion is never deferrable. A held-back one is never `failed`, so it is never offered in `deferrable:`.
- **ADR-021:** the verifier stays plan-blind. The slow-or-fast decision comes from `ac`, never from the verifier's estimate.
- **ADR-018:** a new symbol is reached only by `await import()` inside async test bodies.
- **ADR-020:** every task leaves the suite green on its own. A task that changes behaviour an existing test pins also updates that test.
- **ADR-029:** any new flag gets a `checkFlags` entry. This plan adds none.

Principles: `ac principles brief --stage plan --by planner` returned "no principles in scope" (stack: node).

**Test style:** each task writes its tests first, in the same task, with dynamic imports. No task is serialized test-after.

The plan aims at every criterion, C1 to C14 (C15, the band counters, was removed by the owner: shipped in PR #198). No task edits CRITERIA.md.

## Decisions this plan pins

**P1. What "the most recent recorded run" means (C2, C3, C6).**
- `lastSuiteTiming(root, command)` scans every receipt in `receiptDir(root)`.
  - It skips unreadable and non-hex files, as `readReceipt` does.
  - It keeps only receipts whose `rc.command === command`, compared as exact strings and never normalised.
  - It returns the newest by `at` (falling back to `started_at`) as `{ seconds, at, exit, commit }`, or `null`.
- A clean or dirty tree does not matter, and neither does the commit. A receipt for HEAD only is never required.
- **A failing run is a lower bound, not a timing.**
  - The newest receipt with `exit === 0` gives the timing.
  - A newer failing run makes the suite slow only when it already ran longer than the threshold.
  - Otherwise a failing run is ignored. The bug this prevents: a 50-minute suite that died after 20 s on a compile error would read as fast, and the next cheap pass would run it in full.
  - A command that has only ever failed fast has no timing yet, so it is slow (decision 2).
- **Boundary:** a suite is slow when `seconds > minutes * 60`, strictly greater. So 590 s runs, 600 s runs, and 610 s is held back.

**P2. The threshold setting (C5, C7).**
- The setting is `verify.slow_suite_minutes`, default 10, set with `ac config set verify.slow_suite_minutes 30`.
- `slowSuiteMinutes(root, warnings = [])` lives in `lib/config.mjs`.
- A value that is not a finite number > 0 is ignored with the warning `verify.slow_suite_minutes "<raw>" is not a positive number — using 10`. This copies `mutationSettings`. NaN, 0 and negative values never become a threshold.
- The unit is converted once, at the read site.
- `ac config set` keeps storing any value. The fallback plus the warning is enough for C7.

**P3. One speed answer: `suiteSpeed(root, command, warnings)` in `lib/receipts.mjs`.**
- It returns `{ slow, seconds, at, threshold_seconds, reason }`, where `reason` is one of:
  - `no recorded run of this command on this machine`
  - `last run 900s > 600s threshold`
  - `last run 30s ≤ 600s threshold`
- The cheap pass and `ac suite receipt` both call it, so both tiers act on one answer (C13).

**P4. The held-back contract (C1, C8, C9, C10).**
- **Cheap pass JSON:** `held: [{ id, command, seconds, threshold_seconds, reason }]` sits beside `unchecked`.
  - A held suite is never in `ran` or `unmet`.
  - `clean` still means "nothing unmet".
  - `ac verdict cheap` exits 1 only on unmet.
  - The JSON also gets `warnings: [..]`.
- **Verifier result item:** `{ "id": "C14", "held": true, "suite": true }`.
  - `recordVerdict` stores it, in any mode, as `{ status: 'carried', evidence: 'carried', last: 'unobserved', held: 'slow suite', suite: true }`.
  - A `held` item on a criterion that is not a suite criterion is refused. It is saved `failed` with `refused: 'only a suite criterion can be held back'`.
  - `out.held` lists the held ids, and the history line gets `held: [ids]`. They are never in `failing`, `unmet`, `deferrable` or `flapping`.
- **`ac verdict plan --json`** adds `order: { first, last }`, in every mode:
  - `first` is the saved verdict's failing ids that are not suite criteria;
  - `last` is every suite criterion. It is observed only after every other criterion passes, and a PASS still needs it.
  - `first`, `floor` and the narrowing rules are untouched.

**P5. The workflow order (C10, C11, C12).**
- The loop handles a held suite this way:
  - it is kept out of `lastSeen`, so it is never unmet, never remediated and never "absence of evidence";
  - it travels to the record clerk as `held: true`;
  - it is named in the summary.
- **Summary:** a non-PASS round with held ids gets a summary that starts, in code, with `FAIL — <n> unmet (<ids>); held back: slow suite (<ids>), not run this round`. The cheap-stage FAIL summary gets the same `held back:` clause.
- **Nothing unmet but a held suite:** the existing C12 zero-unmet branch handles it.
  - No remediation runs.
  - One forced full verify runs, whose prompt says every non-suite criterion passed last round and the held suite MUST now be run through `ac suite run`.
  - That verify spends a cycle, so the loop stays bounded.
- **Overlap:** when the cheap pass held a suite back, the verify is not split into overlapped groups. A parallel group would run the suite regardless of the other half.

## Tasks

### t1 — Slow-suite measurement: the threshold setting, the latest timing, one speed answer (P1, P2, P3; C2, C5, C6, C7)
- **files:** lib/config.mjs, lib/receipts.mjs, tests/slow_suite.test.mjs
- **depends_on:** []
- Write `tests/slow_suite.test.mjs` first. Use a scratch git repo. Write receipts directly into `receiptDir` (reuse `receiptKey`) or through `runSuite` with an injected `spawn`; never sleep. Cases:
  - **Defaults and boundary:** with no setting, 590 s and 600 s are fast and 610 s is slow; a project setting of 1 makes 120 s slow; 30 makes 610 s fast.
  - **Bad settings:** `"abc"`, `-5`, `0` and `null` fall back to 10 and push one warning each. A 900 s timing stays slow.
  - **Most recent wins (C6):** a 900 s run then a later 30 s run is fast; the reverse order is slow. A 900 s receipt for a different command string does not leak in. Timings at an older commit count.
  - **No timing:** no receipt at all is slow, with reason `no recorded run…`. Corrupt or non-hex files in the directory are skipped without throwing.
  - **Failing runs (P1):** a newer exit-1 run of 20 s after a passing 900 s run stays slow. A newer exit-1 run of 900 s after a passing 30 s run is slow. A command with only a fast exit-1 run is slow.
- Implement `slowSuiteMinutes` (config.mjs), and `lastSuiteTiming` and `suiteSpeed` (receipts.mjs). receipts.mjs may import `loadConfig` and `slowSuiteMinutes` from config.mjs (config.mjs imports nothing from receipts). Extend the receipts.mjs header with the P1 rule and why.

### t2 — Verdict engine: the held-back entry and the plan's order (P4; C8, C9, C10)
- **files:** lib/verdict.mjs, tests/verdict_held.test.mjs
- **depends_on:** []
- Write `tests/verdict_held.test.mjs` first. Use a scratch repo whose CRITERIA.md has C1 `[suite]` plus C2–C4, and drive `recordVerdict`, `verifiedGate` and `planReverify` through dynamic imports. Cases:
  - **(a) C8:** a full result has C2 and C3 failed, C4 passed and C1 `{held:true, suite:true}`. It records passed=false. `failing` is `['C2','C3']`. `out.held` is `['C1']`. The saved C1 is carried/unobserved/`held:'slow suite'`. The history line has `unmet:['C2','C3']` and `held:['C1']`. `deferrable` and `flapping` do not include C1. Seed an earlier history line where C1 passed, to prove it does not flap. `verifiedGate` refuses.
  - **(b) C9:** every non-suite criterion passed and C1 is held. The result is not a PASS and the gate refuses. Recording C1 passed at the same commit then gives a PASS, and the gate is ok.
  - **(c)** a `held` item on C2 (not a suite criterion) is saved failed, with the refusal reason.
  - **(d)** a targeted result holding C1 never passes.
  - **(e) C10:** after (a), `planReverify(...).order` is `{ first: ['C2','C3'], last: ['C1'] }`. `first`, `floor` and `mode` are as before this change.
- Implement:
  - `validateResult` accepts `held: true`;
  - `recordVerdict` maps it per P4 (the suite test is `suiteIds(text)`, the sticky mark or `c.suite === true`);
  - `out.held` and the history `held` key;
  - `order` in `planFields`.
- Leave `STATUSES`, `failingOf` and `verifiedGate` logic untouched. The existing unobserved rules already refuse a PASS.

### t3 — The cheap first pass holds a slow suite back (P4; C1, C2, C3, C4, C6)
- **files:** lib/cheappass.mjs, tests/cheappass.test.mjs
- **depends_on:** [t1, t2]
- First, extend `tests/cheappass.test.mjs`. Count suite runs with an injected `spawn`, or with the suite command's marker file outside the repo. Cases:
  - **(a)** No timing: the suite is held, there is no `runSuite` call, and `held[0].id` is the suite id. `unmet` is exactly the failing cheap ids. The recorded cheap verdict marks the suite `held` and not failed.
  - **(b)** A 30 s timing at an older commit runs the suite: the marker gets +1, and a fresh receipt exists at HEAD. When it exits 1, the suite is in `unmet`.
  - **(c)** A 900 s timing is held.
  - **(d)** A reusable receipt at HEAD whose `seconds` is 900 is reported met through the receipt. The suite does not run and is not held (C4).
  - **(e)** A clean pass with only a held suite has `clean: true` and records nothing.
  - **(f)** A bad `verify.slow_suite_minutes` lands in `warnings`.
  - **Existing tests:** update every test that assumed an untimed `[suite]` criterion runs. Seed a fast timing, or expect `held`.
- Implement this in the receipt-miss branch: call `suiteSpeed(root, cmds[0], warnings)`. When it is slow, cache `{ held }` for the command and push to `held` without calling `runSuite`; otherwise run the suite as today. Extra outputs:
  - return `held` and `warnings`;
  - when something is unmet, add `{ id, held: true, suite: true }` items to the cheap record.
- Update the module header: a slow suite is never run here (ADR-093).

### t4 — CLI: held back in `verdict cheap|show|history|plan`, and the slow decision in `suite receipt` (C1–C9, C13 driven end to end)
- **files:** bin/ac.mjs, tests/slow_suite_cli.test.mjs
- **depends_on:** [t1, t2, t3]
- First, write `tests/slow_suite_cli.test.mjs` against the real `node bin/ac.mjs`. Use the CRITERIA.md shared fixture: an `ac init` scratch repo; a `[suite]` criterion whose command appends to a marker file outside the repo; a criterion whose cheap command exits 1; one whose cheap command exits 0. Seed timings exactly as CRITERIA.md describes (`ac suite run`, edit `seconds`, commit). Cover:
  - **C1:** both the JSON and text output of `verdict cheap` have the suite held, with marker +0, exit 1, and `history`/`show` not listing it unmet; with the failing criterion fixed, there is no marker line and `phase verify` refuses.
  - **C2:** a fresh fixture holds the suite; after one `ac suite run` and a commit, it runs (marker +1).
  - **C3:** a 30 s timing makes the suite run, and its failure is listed in unmet.
  - **C4:** a reusable 900 s receipt reads as met and the suite does not run.
  - **C5:** 590/610 with no setting; then `config set verify.slow_suite_minutes 1` and `30`.
  - **C6:** most-recent order, plus a different command string.
  - **C7:** `config set … abc` and `… -5` keep 900 s held back and print `⚠`.
  - **C8:** `verdict record` with the held item and two failures; `show --json` has `held` and `unmet` holds both; `phase verify` refuses.
  - **C9:** held plus all non-suite passed gives no PASS; then `suite run` plus the suite passed gives a PASS and `phase verify` succeeds. A receipt from an earlier commit is refused as carried evidence.
  - **C13:** `suite receipt --command … --json` reports `slow.slow` true at 900 s and false at 30 s, and the text output says `held back` or `run`.
- Implement these outputs. Each new line is one line and bounded, at most the held ids or one reason:
  - `verdict cheap` (text): one `• <id> suite: held back — <reason>; not run this round` line per held id. The summary says `(n held back)`. Warnings print as `⚠` on stderr.
  - `verdict show`: a `held` key in the JSON view and a `held back: <ids> (slow suite, not run)` line.
  - `verdict history`: `held: <ids>` per run.
  - `verdict plan` (text): a `• slow suite last: <ids>` line.
  - `suite receipt`: adds a `slow` object (JSON) and one text line: `• slow suite (<reason>) — held back: run it last, through ac suite run, only after every other criterion passes`, or `• fast suite (<reason>) — run it in order`.
  - Help text: the `verdict cheap` and `suite receipt` lines mention held back.

### t5 — Workflow: slow suite last in every round, held back never unmet, never remediated (P5; C10, C11, C12, C13 workflow tier)
- **files:** workflows/execute-phase.mjs, tests/verify_slow_suite.test.mjs, tests/verify_loop.test.mjs
- **depends_on:** []
- First, write `tests/verify_slow_suite.test.mjs`, reusing the `tests/verify_loop.test.mjs` AsyncFunction harness: stub queues for verifiers, records, plans and cheaps, with recording `calls`. Cases:
  - **(a) Held at the cheap stage:** the cheap stage returns `held: [{id:'C1',…}]` and `unmet: ['C2']`. The summary starts `FAIL — cheap first pass` and contains `held back: slow suite (C1)`. No verifier runs.
  - **(b) C10:** the cheap pass is clean with C1 held. The verifier prompt tells it to observe every non-suite criterion first and to run C1 only through `ac suite run` after they all pass. It also tells it to report C1 `held: true` otherwise, and the run is not split into groups even with ≥4 ids. The verifier returns C2 and C3 failed and C1 held. Expected results:
    - the record payload carries `{id:'C1', held:true, suite:true}`;
    - `verdict.summary` starts with `FAIL — 2 unmet (C2, C3); held back: slow suite (C1), not run this round`, and contains neither `ok` nor `C1 failed`;
    - the `remediate:` prompt lists C2 and C3 and not C1;
    - the next verify is ordered the same way.
  - **(c) C11:** the verifier returns every non-suite criterion passed and C1 held. No `remediate:` spawn happens. One forced-full verify follows, whose prompt says the held suite must now be run. With C1 passed it ends verified. If it is held again, it ends a FAIL within budget and never passes.
  - **(d) C12 regression,** in `tests/verify_loop.test.mjs`: a narrowed, withdrawn round with zero unmet. Its summary leads `FAIL — verify PASS withdrawn:` with the `carried, not re-checked` line appended, and never `ok`. The existing C12 tests stay as they are.
- Implement P5:
  - `CHEAP_SCHEMA`: add `held`. `runCheapStage` returns it.
  - `VERIFY_SCHEMA`: items accept `held`.
  - `runVerify`: add a held-suite paragraph, used when held ids exist. The narrowed and targeted step text says the slow suite comes last. `STRUCTURAL_CHECKS` says a held suite runs last.
  - Overlap: off when held.
  - `lastSeen` and the absence-of-evidence fill skip held ids.
  - The record payload and the summary prefix follow P5.
  - The zero-unmet branch passes a held note to its forced verify.
- C12 is already fixed (commit e3f5713, phase 54 t1). This task only guards it; it does not re-implement it.

### t6 — Contract text: both tiers give the same order, and the setting is documented (C13; docs for C5)
- **files:** agents/astro-verifier.md, commands/astro-verify.md, commands/astro-execute.md, commands/astro-config.md, MANUAL.md, tests/verify_contract.test.mjs
- **depends_on:** []
- First, extend `tests/verify_contract.test.mjs` `SAYS` with checks that the contract block (`verifierContract()`), `agents/astro-verifier.md` and `commands/astro-verify.md` each say:
  - observe every non-suite criterion first;
  - a slow suite runs only after all of them pass, and only through `ac suite run`;
  - the decision comes from `ac suite receipt` (its `slow` line) or `ac verdict cheap` (`held`);
  - otherwise report it `held: true` (held back, not run), never passed or failed.
- Add one assertion that `commands/astro-execute.md` states the same order for the Agent-tool tier, and one that no file tells the verifier to read PLAN.md.
- Edit the text to match:
  - `astro-verify.md`: step 2 (the cheap pass prints `held`) and the marked `<!-- verifier-contract -->` block, keeping it ONE block.
  - `astro-verifier.md`: the suite section and the result shape, with `{"id":"C1","held":true,"suite":true}`.
  - `astro-execute.md`: the verify loop: held back is not unmet, and is never handed to remediation.
  - `astro-config.md` and `MANUAL.md`: `verify.slow_suite_minutes` (default 10, minutes, bad values fall back with a warning); the P1 timing rule (machine-local, the first round on a new machine holds the suite back once); the held-back report.
- Every `ac verdict cheap` invocation quoted in MANUAL.md must still pass `tests/verify_speed_docs.test.mjs`. `tests/commands.test.mjs` stays green: any new report slot states its bound.



## Waves

- **Wave 1 (parallel):** t1, t2, t5, t6. Their files are disjoint.
- **Wave 2:** t3, which needs t1 and t2.
- **Wave 3:** t4, which needs t1, t2 and t3. This is the end-to-end CLI test of C1–C9 and C13. It also closes C14: run `node scripts/test.mjs` green before its commit.

## On accept

The folded-in debt `2026-10-15-after-a-withdrawn-carried-pass-the-loop` is settled by the human at accept: it was fixed in phase 54 t1 and t5 regression-guards it. No task writes `debt.json`.

## Deferred (not tasks)

- Refusing a bad `verify.slow_suite_minutes` at `ac config set`. The fallback plus the warning meets C7.
- An overlapped split that runs the non-suite halves in parallel and the slow suite in a third stage. For now, holding a suite back turns the split off.
- A `timings.json` index instead of the directory scan. Receipts are never pruned, so the scan stays correct.
- A per-id slow verdict in `ac verdict plan`, counts in the human `ac status` output.
