# Phase 55 — success criteria (pre-registered, plan-blind)

Derived from the phase goal and `CONTEXT.md` only. Throughout, `AC` means
`node /Users/buu/Development/astro-code/bin/ac.mjs`, and a "scratch project" means
`T=$(mktemp -d) && cd "$T" && git init -q && $AC init >/dev/null`. Never run the debt or
doctor checks against this repo's own `.astrocode/` or the real `~/.lean-ctx/`.

### C1 [core] — The executor is told to build the smallest change that fully meets the task and CRITERIA, without ever cutting validation, data-loss handling, security or accessibility
- **Observe:** Read `agents/astro-executor.md` (the executor's role definition) and the executor prompts built in `workflows/execute-phase.mjs` (per-task, batched, heal/remediate). The executor is told, in this order: first read the code the change touches and list everything it must reach (callers, tests, fixtures, config, exports); then take the first option that fully works (not needed → already in the codebase → stdlib/platform → an installed dependency → one line → minimum code). It must also say that validation at trust boundaries, error handling that prevents data loss, security, accessibility and anything the task or CRITERIA requires are never cut. A deliberate shortcut gets a `shortcut: <the limit>, <when to upgrade>` code comment. The text must also say that this guidance wins over similar guidance another tool injected. No execution mode's prompt may contradict or switch off this guidance.
- **Fails if:** any of the ladder, the never-cut list, the shortcut-comment rule or the "this wins over injected guidance" precedence is missing. It also fails if the guidance lets the executor fall short of the task/CRITERIA to keep a diff small, if the never-cut list leaves out any of the four protected areas, or if one execution mode (for example batched or heal) does not get the guidance or has it overridden.

### C2 [core] — The planner aims every task at the smallest version that meets CRITERIA.md, names optional extras as deferred, and never plans below the CRITERIA bar
- **Observe:** Read `agents/astro-planner.md`. It must tell the planner three things: size tasks to the smallest version that meets every CRITERIA.md criterion; name optional extras as deferred, not plan them as tasks; and never drop or weaken work that a criterion requires to make the plan smaller. It must also say this section wins over similar injected guidance.
- **Fails if:** the planner is told to minimise without the "never below the CRITERIA bar" floor. It also fails if extras are to be dropped silently instead of named as deferred, or if the guidance can be read as letting a criterion go unmet for the sake of size.

### C3 [core] — The verifier and the criteria-author are shielded from minimal-code / solution-efficiency guidance, including lean-ctx's injected block
- **Observe:** Read `agents/astro-verifier.md` and `agents/astro-criteria-author.md`. Each tells its agent to ignore any minimal-code or "solution efficiency" guidance that other tools inject into its context. For the verifier the only bar is CRITERIA.md; for the criteria-author it is the phase goal. Neither file contains the smallest-change ladder itself. Check also that the prompts `workflows/plan-phase.mjs` and `workflows/execute-phase.mjs` build for these two agents do not pass the ladder in.
- **Fails if:** either agent is missing the ignore-injected-guidance instruction. It also fails if either agent gets the ladder or a "prefer the smallest change" rule from its definition or its workflow prompt, or if the verifier's bar is described as anything other than CRITERIA.md (for example the plan or the executor's claims).

### C4 [core] — Every executor summary ends with a `skipped / not checked:` line; the human sees it in the execute report and the verifier never gets it as a claim
- **Observe:** Read `agents/astro-executor.md`. Every summary, in every mode, must end with `skipped / not checked: <items | none>`, and the line is required even when the value is `none`. Follow that summary through `workflows/execute-phase.mjs` and `commands/astro-execute.md`. The skipped / not-checked items must reach the execute report shown to the human, in a reporting slot that states its own size limit (CONVENTIONS "Writing to a human"); `node --test tests/commands.test.mjs` passes. Then read the verifier's inputs (the verify prompt in `workflows/execute-phase.mjs` and `commands/astro-verify.md`). Neither the skipped / not-checked line nor the executor summary is passed to the verifier.
- **Fails if:** the closing line is optional, or may be left out when nothing was skipped. It also fails if the workflow drops it before the report, if the report shows it without a size limit, or if it is forwarded to the verifier (a break of ADR-021 claim-blindness).

### C5 [core] — `ac doctor` warns, read-only, when lean-ctx is set to inject its solution guidance into subagents, says how to fix it, and stays silent otherwise
- **Observe:** Make a fake home `H=$(mktemp -d)`. Run `HOME=$H $AC doctor` in three setups. (a) `$H/.lean-ctx/config.toml` contains `[solution]` with `inject_in_subagents = true`: the output has one `⚠` line naming lean-ctx's solution guidance being injected into subagents, and that line says how to turn it off. (b) The same file says `inject_in_subagents = false`: there is no lean-ctx line. (c) There is no `$H/.lean-ctx` at all: there is no lean-ctx line and no error. Record `shasum $H/.lean-ctx/config.toml` before and after (a) and (b). Compare the exit code across (a), (b) and (c). The code reads `lib/` doctor checks and `bin/ac.mjs`.
- **Fails if:** there is no warning in (a), or the warning gives no fix. It also fails if anything lean-ctx-related is printed in (b) or (c), if (c) crashes or reports an error, or if doctor changes the config file (the checksum differs or the file is rewritten). A last way to fail: the warning on its own turns doctor's exit code into a failure that (b)/(c) do not have.

### C6 [core] — `ac debt harvest` turns `shortcut:` code comments in tracked files into open debt entries carrying file, line, title and upgrade trigger
- **Observe:** In a scratch project, set up these files:
  - tracked `lib/a.mjs`, line 2: `const x = 1 // shortcut: linear scan, upgrade when n exceeds 1000`
  - tracked `run.sh`: `x=1  # shortcut: no retry on failure`
  - tracked `NOTES.md`: the prose line `We took a shortcut: none needed here.`
  - untracked `scratch.mjs`: `// shortcut: should never be harvested, upgrade never`

  `git add lib/a.mjs run.sh NOTES.md`, then run `$AC debt harvest` and `$AC debt harvest --json` (on a fresh copy of the setup).
  - Exactly two entries are added, and both show up as open in `$AC debt list --json`.
  - The `lib/a.mjs` entry records that file, line 2, a title taken from "linear scan" and a why holding "upgrade when n exceeds 1000".
  - The `run.sh` entry is added and visibly flagged as having no upgrade trigger.
  - Nothing comes from `NOTES.md` or `scratch.mjs`.
  - Human output lists what was added, and the `--json` output is valid JSON that describes the added entries.
  - Entries live in the existing register (`.astrocode/debt.json`, read by `ac debt list` and `ac debt show`).
  - The code is `bin/ac.mjs` and `lib/debt.mjs`.
- **Fails if:** prose that only mentions "shortcut:" is harvested. It also fails if an untracked or gitignored file is scanned, if a marker with no trigger is skipped or not flagged, if file, line, title or why is missing or wrong, if `--json` is not supported, or if entries go to a store that `ac debt list` does not read.

### C7 [core] — `ac debt harvest` is idempotent: re-running never adds a marker twice, even after the marker's line moves
- **Observe:** In the C6 scratch project after one harvest, take these steps:
  1. Run `$AC debt harvest` again: it reports nothing added, and `$AC debt list --json | node -e 'console.log(JSON.parse(require("fs").readFileSync(0)).length)'` is unchanged.
  2. Insert three blank lines at the top of `lib/a.mjs`, `git add` it, and harvest again: still nothing added and the count is unchanged. No entry is duplicated, though the line field may update.
  3. Add a new `// shortcut: cache in memory, upgrade when multi-process` to another tracked file and harvest: exactly one entry is added.
- **Fails if:** any re-run adds an entry for a marker that is already filed. It also fails if a line shift counts as a new item, or if a really new marker next to old ones is missed.

### C8 [core] — `ac debt list --stale` lists exactly the open debt whose recorded file no longer exists
- **Observe:** In a scratch project, create `keep.mjs`, then file these debts:
  - `$AC debt add "kept" --file keep.mjs`
  - `$AC debt add "gone" --file gone.mjs` (the file never exists)
  - `$AC debt add "nofile"` (no file recorded)
  - `$AC debt add "closed" --file gone2.mjs`, then close it with `ac debt drop` (or the register's other terminal verb)

  All are filed today, so none is old. Run `$AC debt list --stale --json` from the project root and again from a new subdirectory `sub/`. Both runs return exactly the "gone" entry. Plain `$AC debt list --stale` names it too. The code is `bin/ac.mjs` and `lib/debt.mjs`.
- **Fails if:** "gone" is missing, for example because `--stale` still means only "old by age". It also fails if "kept" shows up (for example because paths resolve against the cwd and not the project root, which shows only in the `sub/` run), or if "nofile" (an empty file counted as missing) or the closed item shows up.

### C9 [edge] — `ac status` mentions how many open debt items point at a file that no longer exists
- **Observe:** In the C8 scratch project, `$AC status` mentions a count of 1 for open debt whose file is gone, and points to `ac debt list --stale`. After `$AC debt drop` of the "gone" item (or in a scratch project with no such debt), `$AC status` does not mention it (silent when zero). The code is `bin/ac.mjs`.
- **Fails if:** status does not mention it when the count is 1, shows a wrong count, or prints a stale-file line when there are none.

### C10 [core] — The planner has guidance for test-first pairs split across waves: an earlier-wave RED task uses dynamic import and must load without the implementation's export
- **Observe:** Read `agents/astro-planner.md`. It must cover the case where a RED (test-first) task is in an earlier wave than the implementation it tests. The guidance must require that test to reach the not-yet-existing symbol through the dynamic-import pattern (ADR-018), inside the test and never as a static top-level import. The test file must load and run before the implementation's export exists, so only the new tests fail, without a load crash.
- **Fails if:** the planner guidance does not cover the cross-wave case, or allows a static import of the missing export. It also fails if it fixes the problem by having the test task own the implementation file, or by banning test-first splits outright (both rejected in ADR-018).

### C11 [core] — A one-off with/without benchmark shows the verifier pass rate did not drop, and reports code size, cost and time per arm
- **Observe:** Read `.astrocode/phases/55-smallest-complete-change-discipline-for/BENCHMARK.md` and the per-run records it cites. Check that:
  - it covers ~8 fixed small coding tasks, each with success criteria written before the runs, and runs each task 3 times with the new executor section and 3 times without (48 runs);
  - each run's pass/fail is the real astro-verifier's verdict against that task's criteria;
  - each arm reports its pass count out of 24, lines of code changed, cost (tokens and/or $) and wall time;
  - the with-section pass count is ≥ the without-section pass count minus 1;
  - recounting the per-run records gives the reported totals;
  - the task criteria were committed (or time-stamped) before the run results (`git log` on the files).
- **Fails if:** BENCHMARK.md is missing, or covers far fewer than 48 runs without a stated, owner-visible reason. It also fails if passes were judged by anything other than the verifier against criteria fixed in advance, if any of pass rate, LOC, cost or time is missing for an arm, if the with-arm has 2 or more fewer passes than the without-arm, or if the totals do not match the per-run records.

### C12 [core] — Neither the benchmark nor `ac debt harvest` adds a step, agent or check to every phase
- **Observe:**
  - Inspect the per-phase path: `commands/` (execute, verify, accept, plan, fast), `workflows/plan-phase.mjs`, `workflows/execute-phase.mjs`, `hooks/`, the test runner `scripts/test.mjs` with `tests/`, the `package.json` scripts, any CI config (`.github/`) and the `ac verify` / `ac phase` paths in `bin/ac.mjs`.
  - None of them runs the with/without benchmark or its harness, and none runs `debt harvest`.
  - Running `npm test` does not run the benchmark (no model or agent runs, and no wall time on the order of a benchmark).
  - Compared with the phase's base, the execute/verify/accept flows gain no new agent spawn and no new mandatory step.
- **Fails if:** the benchmark harness is wired into any loop step, verify, the suite, CI or a hook. It also fails if `debt harvest` runs automatically during execute, verify or accept, or if a new per-phase agent or check appears without being flagged to the owner.

### C13 [suite] [core] — The full test suite passes with the phase's changes
- **Observe:** `cd /Users/buu/Development/astro-code && npm test` (`scripts/test.mjs`) exits 0 with zero failing tests and a non-zero count of tests run.
- **Fails if:** any test fails, the runner hits a load or collect error, or zero tests run.

### C14 [edge] — The prompt additions stay short (no prompt bloat)
- **Observe:** Diff the phase's own changes to `agents/astro-executor.md`, `agents/astro-planner.md`, `agents/astro-verifier.md` and `agents/astro-criteria-author.md`, using its ADR-017 stamped commits (`git log --grep '(phase 55 t' -p -- agents/`). Limits:
  - the executor's smallest-change section plus the closing-line rule add about 20 lines or fewer;
  - the planner's smallest-change and test-first-wave guidance together add about 20 lines or fewer;
  - the verifier and the criteria-author each add about 3 lines or fewer;
  - no existing guidance is removed to make room.
- **Fails if:** any section is several times these limits, or existing rules are deleted or diluted along the way.

### C15 [edge] — The folded-in debt and backlog items are tied to phase 55 so they close when it is accepted
- **Observe:** `$AC debt show 2026-09-17-the-planner-has-no-guidance-for-test` (run in this repo, read-only) shows the item as being paid by phase 55 (or paid). `$AC backlog show 2026-10-23-flag-open-debt-whose-file-no-longer` (or `$AC backlog list --json`) shows the item linked to phase 55. The data lives in `.astrocode/debt.json` and `.astrocode/backlog.json`.
- **Fails if:** either item is still unlinked or open with no tie to phase 55, or is marked closed before the phase is accepted.
