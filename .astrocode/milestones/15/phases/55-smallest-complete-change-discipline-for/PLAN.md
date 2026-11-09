# Phase 55 — Plan: smallest-complete-change discipline, `ac debt harvest`, `--stale` file-gone, one-off benchmark

Aim: every criterion in `CRITERIA.md` (C1–C15). Canon: CONVENTIONS.md (named exports, `node:` only,
no semicolons in `workflows/*.mjs`, a test in `tests/<area>.test.mjs` for every `lib/` change, dense
"why" comments, bounded human reporting slots), ADR-017 stamps, ADR-018, ADR-020, ADR-021, ADR-045/047.
Principles brief: none in scope (stack: node).

## Plan-level choices (read before executing)

- **Test cadence.** Every `lib/` task is test-first INSIDE the task: write the failing test, then
  the impl, one stamped commit. No RED test is split from its impl across a wave, so no wave
  boundary carries a red test. New tests should still reach new exports through
  `const { fn } = await import('../lib/x.mjs')` inside async test bodies (ADR-018), so a
  half-done task fails only the new tests and never crashes the file at load time. **t11 is
  test-after by choice**: it pins prompt text that t1–t4 write, and `depends_on` all four.
- **`--stale` keeps its age meaning and adds the file-gone case (union).** The flag already means
  "open 30+ days" (`staleDebt`, `ac status`, `/astro-complete-milestone`, `tests/debt.test.mjs`).
  C8 requires `--stale` to list open debt whose file is gone, and it fails if the flag still means
  "old by age only". The union meets C8, because every C8 item is filed today, so no age hit can
  appear. It also keeps every existing age test and the milestone triage step working. Each row
  says why it is stale.
- **Harvest identity covers closed entries too.** `addDebt` dedupes only against open/paying
  entries, so a paid, dropped or dismissed marker would come back on the next harvest. Harvest
  first skips any entry, in ANY status, with the same `file` and `marker` text. It then writes
  through `addDebt` (the lock-guarded store, no new store). `addDebt` gains two OPTIONAL fields,
  `line` and `marker`, stored only when given. The existing shape is unchanged for every other
  caller.
- **lean-ctx default = on.** On this machine `~/.lean-ctx/config.toml` has no `[solution]`
  table, yet lean-ctx injects into subagents by default (`lean-ctx config` shows
  `enabled = true, inject_in_subagents = true`). The check therefore warns when `~/.lean-ctx/`
  exists and the file does NOT explicitly set `inject_in_subagents = false` (or `enabled = false`)
  under `[solution]`. It reads files only and never spawns lean-ctx. The row is ADVISORY: it prints
  `⚠` but never changes doctor's exit code (C5).
- **Benchmark home.** The benchmark lives in this phase folder (`bench/`), not `scripts/`, so
  nothing ships in the npm package and nothing in `tests/`, hooks, workflows, `ac verify` or CI can
  reach it (C12). Seed test files must NOT match `node --test`'s default globs
  (`*.test.*`, `*-test.*`, `*_test.*`, `test-*.*`, `test.*`, `test/**`). Name them
  `spec/*.spec.mjs` and run them by an explicit path.

## Deferred (named, not planned)

- `ac debt pay <id> --phase <existing>` as a CLI verb. t2 links the folded-in debt through
  `payDebt` directly.
- Harvest updating `line` when a marker moves. C7 allows the update but does not require it.
- Harvest recognising lean-ctx's own `// lean-ctx:` markers.
- An ADR recording these plan-level choices.

## Owner flags (CONTEXT decision 9)

- No task adds a step, an agent spawn or a check to every phase. `debt harvest` and the benchmark
  are on demand only. The prompt additions are a few lines each. The `notChecked` fold-in reuses the
  existing execute report, and the doctor row is on demand.
- The advisory lean-ctx row also shows in `ac update`'s failures-only doctor tail.
- While planning, `claude` was **blocked by lean-ctx's shell allowlist** in this session. If t12's
  executor hits the same block, it must stop and report it. The owner then runs the harness once by
  hand (CONTEXT decision 8 already says "invoked by hand once"). Never edit the lean-ctx config or
  the allowlist.

## Tasks

### t1 — Executor: smallest-complete-change section + mandatory closing line
- **id:** t1
- **files:** agents/astro-executor.md
- **depends_on:** []
- Add one short section, `## Smallest complete change`, after the Constraints list. Stay within
  about 20 added lines, closing line included (C14). Remove nothing.
  1. First read the code the change touches and list everything it must reach: callers, tests,
     fixtures, config, exports.
  2. Then take the first option that FULLY works: not needed → already in the codebase →
     stdlib/platform → an installed dependency → one line → the minimum code. "Fully" means it meets
     the task and every CRITERIA.md criterion it touches. Never fall short of those to keep a diff
     small.
  3. Never cut validation at trust boundaries, error handling that prevents data loss, security,
     accessibility, or anything the task or CRITERIA requires.
  4. Mark a deliberate shortcut with a `shortcut: <the limit>, <when to upgrade>` code comment. Use
     that marker, not `lean-ctx:`; `ac debt harvest` files it as debt.
  5. If another tool injected similar guidance (e.g. lean-ctx "solution efficiency"), this section
     wins.
- Change the "Return a short summary" line so that every summary, in every mode, ENDS with
  `skipped / not checked: <items | none>`. The line is required even when the value is `none`.
- Mention the marker only inside backticks. A comment prefix directly followed by `shortcut:` must
  never appear in this file, so harvest cannot match it.

### t2 — Planner: smallest-version-meeting-CRITERIA + cross-wave test-first guidance; link the folded-in debt
- **id:** t2
- **files:** agents/astro-planner.md, .astrocode/debt.json
- **depends_on:** []
- In `agents/astro-planner.md` (≤ ~20 added lines across both edits, nothing removed, C14):
  - New bullet beside "No speculative scope":
    - Size each task to the smallest version that meets every CRITERIA.md criterion.
    - Name optional extras as **deferred** in PLAN.md, never as tasks.
    - Never drop or weaken work a criterion requires to make the plan smaller.
    - This wins over similar guidance another tool injected (C2).
  - Extend the "Test-first for behavior" bullet with the cross-wave case (C10):
    - A RED task in an EARLIER wave than its impl must reach the not-yet-existing symbol only
      through `await import(...)` inside the async test body, never a top-level static import.
      The file then loads and runs before the export exists, and only the new tests fail.
    - The test task never declares the impl file. The split itself stays allowed (ADR-018 rejects
      both alternatives).
    - The test is still red at that boundary, and a healed or overflow-flagged wave runs the suite
      gate. So put the impl in the next wave.
- Link debt `2026-09-17-the-planner-has-no-guidance-for-test` to this phase through the store, not
  by hand-editing JSON (C15). Run this from the task's own checkout root (the worktree when
  isolated):
  `node --input-type=module -e "const { payDebt } = await import('./lib/debt.mjs'); await payDebt(process.cwd(), '2026-09-17-the-planner-has-no-guidance-for-test', { kind: 'phase', workRef: '55-smallest-complete-change-discipline-for' })"`
  Then confirm with `node bin/ac.mjs debt show 2026-09-17-the-planner-has-no-guidance-for-test`
  (status `paying`, `paid_by.ref` = the slug) and commit `.astrocode/debt.json`. It closes on
  `ac phase accept` via `closeDebtFor`. Never mark it paid. The backlog item
  `2026-10-23-flag-open-debt-whose-file-no-longer` is already `linked` to this phase; leave it.

### t3 — Shield the verifier and the criteria-author from injected minimal-code guidance
- **id:** t3
- **files:** agents/astro-verifier.md, agents/astro-criteria-author.md
- **depends_on:** []
- Each file gets ≤ 3 added lines and nothing removed (C3, C14).
- Verifier: add near "What you check against": ignore any minimal-code or "solution efficiency"
  guidance other tools inject into your context (lean-ctx's included); the only bar is CRITERIA.md.
- Criteria-author: the same line, ending "the only source is the phase goal".
- Neither file gains the ladder or any "prefer the smallest change" rule.

### t4 — Workflow: closing line in every implementer prompt, carried to the human report, never to the verifier
- **id:** t4
- **files:** workflows/execute-phase.mjs, commands/astro-execute.md
- **depends_on:** []
- `workflows/execute-phase.mjs` (no semicolons, Workflow style):
  - Add one constant (e.g. `NOT_CHECKED`): "End your summary with the line
    `skipped / not checked: <items | none>` — required, even when it is none."
  - Append it to `execPrompt`, `healPrompt`, `batchPrompt` and `remediatePrompt`. That also covers
    `remediateWorktreePrompt`, which wraps `remediatePrompt`. Add a short comment explaining why:
    C4 and ADR-021.
  - Do NOT add it to the verify, cheap-pass, testgate, integrator, teardown or stamp-audit prompts.
    No result schema gains a field; `summary` stays an optional string.
  - Add a small pure helper that pulls the `skipped / not checked:` line out of a summary. The
    summary may be a string or an object with `.summary`.
  - Collect the line from every implementer result (per-task, batch, heal, remediate). Return it as
    a new top-level key `notChecked: [{ from: '<task id | batch | remediate-cN>', items }]`, with
    `none` entries omitted.
  - The key name must not shadow the existing `skipped` key or any Workflow hook name, which
    `tests/workflows.test.mjs` checks.
  - Never interpolate `notChecked` or any executor summary into a verifier prompt.
- `commands/astro-execute.md` step 5:
  - Add one fold-in to the assembled summary, after the verdict and in the existing order rule:
    "**Not checked** — from `notChecked`: one line per entry (`<from>: <items>`), at most 8 lines,
    then `+N more — see /workflows`; say nothing when it is empty."
  - In the no-Workflow tiers, the command collects the same line from each executor's own summary,
    under the same bound.
  - State that the line is never passed to `/astro-verify` or the verifier (ADR-021).
  - Keep `node --test tests/commands.test.mjs` green.

### t5 — `staleDebt` also flags open debt whose recorded file is gone
- **id:** t5
- **files:** lib/debt.mjs, tests/debt_stale.test.mjs
- **depends_on:** []
- Test first, in `tests/debt_stale.test.mjs`. Use real fs (`mkdtempSync` + `initPlanning`) and reach
  `missingFileDebt` through `await import`. Cover:
  - an entry whose file exists is not stale;
  - an entry whose file never existed is stale;
  - an entry with no `file` is not stale, and neither is an entry whose file exists but is empty;
  - a dropped entry with a missing file is not stale;
  - paths resolve against the project root, never `process.cwd()` (call with cwd set elsewhere);
  - an age-only stale entry with an existing file is still returned;
  - the union returns no duplicates.
- Impl in `lib/debt.mjs`:
  - Export `missingFileDebt(root)`: `openDebt(root)` entries with a non-empty `file` where
    `!existsSync(resolve(root, file))`.
  - `staleDebt(root, {days, now})` becomes the id-deduped, sorted union of the age hits and
    `missingFileDebt`.
  - Update the comment so it says why both meanings live under one flag.
- `tests/debt.test.mjs` must stay green unchanged.

### t6 — `ac doctor`: advisory lean-ctx subagent-injection warning, read-only, silent when absent
- **id:** t6
- **files:** lib/doctor.mjs, bin/ac.mjs, tests/doctor_leanctx.test.mjs
- **depends_on:** []
- Test first, in `tests/doctor_leanctx.test.mjs`. Use a fake `home` via `mkdtempSync` and pass
  `runDoctor({ home, astroHome })`. Spawn the CLI with `HOME=<fake>` and follow the env pattern in
  `tests/doctor_cli.test.mjs`. Cover the three C5 setups:
  - (a) `[solution]` with `inject_in_subagents = true` gives exactly one `⚠` line. It names lean-ctx's
    solution guidance being injected into subagents, and its fix names how to turn it off.
  - (a′) A `config.toml` with no `[solution]` table also warns, because the default is on.
  - (b) `inject_in_subagents = false` gives no lean-ctx line.
  - (c) With no `.lean-ctx` there is no lean-ctx row at all and no throw.
  - The file's bytes and mtime are unchanged after every run.
  - The CLI exit code for (a) equals the code for (b) and (c).
- Impl in `lib/doctor.mjs`:
  - Add `'lean-ctx'` to `DOCTOR_CHECKS`.
  - Add `checkLeanCtx(ctx, emit)`. It reads `join(ctx.home, '.lean-ctx', 'config.toml')` with a
    small line-based `[solution]` reader (no TOML dep) and emits NOTHING when `~/.lean-ctx` is
    absent.
  - Run it BEFORE the "astro-code is not installed" early return, so it also fires in a home
    without an install.
  - Rows from this check carry `advisory: true`.
  - `renderDoctor` prints advisory failures as `⚠ … → fix` lines. It still prints the `✓ install
    consistent` line when every non-advisory row is ok and `failuresOnly` is not set.
  - Fix text: "set `inject_in_subagents = false` under `[solution]` in ~/.lean-ctx/config.toml
    (astro-code never edits it)".
- `bin/ac.mjs`: only the `case 'doctor'` exit line changes, to
  `rows.some((r) => !r.ok && !r.advisory)`.
- Keep every existing `tests/doctor*.test.mjs` green. Their fake homes have no `.lean-ctx`, so no
  row is added.

### t7 — `harvestDebt`: comment-anchored `shortcut:` markers in tracked files → debt, idempotently
- **id:** t7
- **files:** lib/debt.mjs, tests/debt_harvest.test.mjs
- **depends_on:** [t5]
- Test first, in `tests/debt_harvest.test.mjs`. Use a real temp git repo plus `initPlanning`, and
  reach `scanShortcuts`/`harvestDebt` via `await import`. BUILD every marker string so that no
  source line of the test itself has a comment prefix directly before `shortcut:`, e.g.
  `const M = 'short' + 'cut:'`. Cover:
  - each prefix `//`, `#`, `/*` (trailing `*/` stripped), `--` and `;` matches only at line start or
    after whitespace;
  - prose (`We took a shortcut: none needed here.`), `http://x`, `a--b` and a backtick-quoted
    marker do NOT match;
  - an untracked file and a gitignored file are never scanned;
  - binary (NUL byte) files, files over 1 MB and tracked-but-deleted files are skipped silently;
  - `linear scan, upgrade when n exceeds 1000` gives title `linear scan`, why
    `upgrade when n exceeds 1000`, `file`, and `line` (1-based);
  - a marker with no comma-separated trigger is ADDED with a why that says no upgrade trigger was
    given, and it is reported as no-trigger;
  - a second run adds nothing;
  - inserting lines above a marker adds nothing (identity is `file` + marker text, never the line);
  - a marker whose entry was dropped or dismissed is NOT re-filed;
  - one new marker beside old ones adds exactly one entry;
  - running `scanShortcuts` over the source text of `lib/debt.mjs`, `agents/astro-executor.md` and
    the test file itself finds nothing.
- Impl in `lib/debt.mjs`:
  - `scanShortcuts(text)` is pure and returns `[{ line, marker, title, trigger }]`. The regex is
    anchored on the comment prefix, roughly `(?:^|\s)(?:\/\/|#|\/\*|--|;)\s*shortcut:\s*(.+)$`.
    The trigger is split on the first `, `. Comment why the prefix rule is the whole false-positive
    defence (no tokenizer).
  - `harvestDebt(root, { now })` lists files with `git(['ls-files', '-z'], { cwd: root })` from
    `lib/git.mjs` (tracked only, so .gitignore is respected). Outside a git repo it throws a clear
    error.
  - For each marker it skips if ANY register entry has the same `file` and `marker`. Otherwise it
    calls `addDebt(root, { title, why, file, line, marker, now })` sequentially, passing no
    `phase`.
  - It returns `{ added: [entries], already: n, noTrigger: [ids] }`.
  - `addDebt` gains optional `line` (positive integer) and `marker` (string). Each is stored only
    when given; nothing else about its shape or dedupe changes.

### t8 — CLI: `ac debt harvest`, `--stale` rows, `ac status` file-gone count, help and docs
- **id:** t8
- **files:** bin/ac.mjs, MANUAL.md, commands/astro-debt.md, tests/debt_cli.test.mjs
- **depends_on:** [t5, t6, t7]
- Test first, in `tests/debt_cli.test.mjs`. Use `spawnSync` of `bin/ac.mjs` in a scratch
  `git init` + `ac init` project, never this repo.
  - C6 setup: tracked `lib/a.mjs`, `run.sh` and `NOTES.md`, plus an untracked `scratch.mjs`.
    - Exactly two entries are added and both are open in `debt list --json`.
    - The human output lists them, and the `run.sh` one shows a no-trigger `⚠`.
    - `--json` is valid JSON naming the added entries.
  - C7: re-run, a three-blank-line shift and one new marker give 0, 0 and 1 additions.
  - C8: `kept`/`gone`/`nofile`/`closed`. `debt list --stale --json` returns exactly `gone`, both
    from the root and from `sub/`, and the plain `--stale` output names it.
  - C9: `status` mentions 1 file-gone item and points to `ac debt list --stale`. After
    `debt drop` it says nothing about it.
  - An unknown `debt harvest` flag dies.
- Impl in `bin/ac.mjs`:
  - Add a `case` for `harvest` in the `debt` switch, BEFORE the `findDebt` fall-through.
  - Add `'debt harvest': ['json']` to the ADR-029 allowlist and call `checkFlags`.
  - Human output: `✓ debt <id>  <file>:<line>  <title>`, plus `⚠ no upgrade trigger` where it
    applies. Then one line, `• N already filed`, or `• nothing new to harvest`.
  - `--json` prints `json(result)`.
  - `debt list` rows print `⚠ file gone — <file>` for missing-file entries.
  - `ac status` keeps the age count and adds `K file gone` (from `missingFileDebt`) pointing to
    `ac debt list --stale`, silent at zero.
  - Add a help line for harvest. The `--stale` help reads "30+ days old or its file is gone".
  - Add the matching `MANUAL.md` lines (~1542).
  - In `commands/astro-debt.md`, add one mention: `--stale` now includes file-gone items, and
    `ac debt harvest` files `shortcut:` comments. Triage stays here; add no new reporting slot.
- Nothing in execute/verify/accept, hooks or workflows calls `debt harvest` (C12).

### t9 — Benchmark fixtures: ~8 fixed small coding tasks with criteria written BEFORE any run
- **id:** t9
- **files:** .astrocode/phases/55-smallest-complete-change-discipline-for/bench/tasks/
- **depends_on:** []
- Create 8 tasks in `bench/tasks/<NN-slug>/`, each with three parts:
  - `TASK.md`: the one-paragraph instruction the executor gets.
  - `CRITERIA.md`: C-ids with **Observe** / **Fails if**, in this repo's CRITERIA shape.
  - `seed/`: a tiny dependency-free Node project with `package.json` (`"test": "node --test spec/"`)
    and its tests in `spec/*.spec.mjs`. No file may match `node --test`'s default globs.
- Mix tasks that reward a small diff with tasks that touch a never-cut area, so the run shows
  whether the section cuts them. Suggested: input validation at a parse boundary; an atomic write
  that prevents data loss; an off-by-one fix; a new CLI flag; dedupe; pagination; an accessible
  label on an HTML form; a config default.
- No seed line may carry a comment prefix directly followed by `shortcut:`.
- Verify that `npm test` in this repo runs no seed spec: compare the test count before and after.
  Commit alone, so `git log` proves the criteria predate t12's records (C11).

### t10 — Benchmark harness (one-off, hand-run, never wired anywhere)
- **id:** t10
- **files:** .astrocode/phases/55-smallest-complete-change-discipline-for/bench/run.mjs
- **depends_on:** []
- A plain `node:`-only `.mjs`. Its header comment says it is a one-off for phase 55's acceptance and
  must never be wired into tests, hooks, workflows, `ac verify` or CI (CONTEXT 8 and 9).
- Flags: `--dry-run` (print the run plan and the resolved arm sha, run nothing), `--budget-usd N`
  (stop before a run once spent ≥ N), `--report` (rebuild the totals from the records only).
- Arms:
  - **with** = `agents/astro-executor.md` at HEAD.
  - **without** = the same file at the parent of the commit stamped `(phase 55 t1)`, found with
    `git log --grep`.
  - Record both shas.
- Per run (8 tasks × 2 arms × 3 reps = 48):
  - Copy `seed/` into `mkdtempSync`, then `git init` and commit it.
  - Run the executor headless (`claude -p`, `--output-format json`, a pinned model), with the arm's
    agent body as its system prompt and TASK.md as the prompt.
  - Then run the REAL `agents/astro-verifier.md` headless (pinned model) against that task's
    CRITERIA.md in the run dir, and take its pass/fail verdict.
  - Run order is interleaved across arms with a fixed seed.
  - Keep lean-ctx's injected block out of BOTH arms by starting each `claude` with no MCP servers
    (`--strict-mcp-config` plus an empty `--mcp-config`). Confirm the flags with `claude --help`
    first. If they are unavailable, record "lean-ctx present in both arms" in each record.
- Append one JSON line per run to `bench/runs.jsonl`: `{task, arm, rep, passed, verdict_summary,
  loc_added, loc_removed, cost_usd, input_tokens, output_tokens, wall_ms, executor_sha,
  verifier_sha, started_at}`.
  - LOC comes from `git add -A && git diff --cached --numstat <seed-commit>`.
  - Cost and tokens come from the JSON result fields. Confirm the field names against the installed
    CLI.
- It resumes by skipping any (task, arm, rep) already recorded.
- `--report` writes the per-arm table: pass count out of 24, total and mean LOC, total cost and
  tokens, total wall time. It also writes the per-task pass counts, all recomputed from
  `runs.jsonl` alone.

### t11 — Guard test pinning the prompt contract (test-after, by choice)
- **id:** t11
- **files:** tests/smallest_change.test.mjs
- **depends_on:** [t1, t2, t3, t4]
- Read the files as text, as `tests/principles_prompts.test.mjs` does. Assert:
  - **Executor:** the ladder steps appear in order; the four never-cut areas plus
    "task or CRITERIA requires" are present; the `shortcut: <the limit>, <when to upgrade>` rule is
    there; the precedence over injected guidance is stated; the mandatory
    `skipped / not checked: <items | none>` closing line is there.
  - **Planner:** "meets CRITERIA" plus the never-below-the-bar floor; extras named as deferred; the
    precedence line; the cross-wave RED guidance with `await import` and no static import.
  - **Verifier and criteria-author:** the ignore-injected-guidance line is present, and NEITHER
    contains the ladder (e.g. no "stdlib" or "one line" ladder text, no "smallest change").
  - **`workflows/execute-phase.mjs`:** `execPrompt`, `healPrompt`, `batchPrompt` and
    `remediatePrompt` each contain the closing-line constant, and the verifier prompt contains
    neither it nor `notChecked`.
  - **`commands/astro-execute.md`:** the Not checked fold-in states its bound and its silence rule.
- Run the full suite (`npm test`) green before committing (C13).

### t12 — Run the benchmark once and write BENCHMARK.md
- **id:** t12
- **files:** .astrocode/phases/55-smallest-complete-change-discipline-for/bench/runs.jsonl, .astrocode/phases/55-smallest-complete-change-discipline-for/BENCHMARK.md
- **depends_on:** [t1, t3, t9, t10]
- Steps:
  1. Run `node .astrocode/phases/55-smallest-complete-change-discipline-for/bench/run.mjs --dry-run`.
  2. Run the harness for real with a `--budget-usd` cap. It is resumable, so re-invoke it until all
     48 records exist. Long runs go in the background.
  3. Run `--report`.
- If `claude` is refused, for example by lean-ctx's shell allowlist, STOP. Report the blocker and
  the exact hand-run command for the owner. Never edit lean-ctx config or its allowlist, and never
  fake records.
- `BENCHMARK.md` leads with the result: with-arm passes vs without-arm passes out of 24, and whether
  with ≥ without − 1.
- Then a per-arm table of pass rate, LOC changed, cost ($ and tokens) and wall time, followed by
  per-task pass counts.
- Then the conditions: arm shas, models, the lean-ctx control and the run dates.
- Link `bench/runs.jsonl` as the source of every total.
- If fewer than 48 runs completed (budget), say how many and why, in the first lines.
- Commit `runs.jsonl` and `BENCHMARK.md` together, after t9's criteria commit.

## Waves

- W1 (8 parallel, disjoint files): t1, t2, t3, t4, t5, t6, t9, t10
- W2: t7 (after t5, `lib/debt.mjs`), t11 (after t1–t4), t12 (after t1, t3, t9, t10)
- W3: t8 (after t5, t6, t7 — `bin/ac.mjs` serialized behind t6)

Rule check: no RED test is split from its impl (the lib tasks are test-first inside the task, and t11
is test-after). Same-file pairs are serialized: `lib/debt.mjs` t5→t7, `bin/ac.mjs` t6→t8. No task
deletes or renames a symbol (`staleDebt` keeps its name and signature, and `addDebt` only gains
optional fields), so every wave boundary compiles. Every task declares its files, and every task
lands a stamped commit.
