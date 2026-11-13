# Plan: phase 57, fast phase verify, full check at milestone close

This plan follows `.astrocode/CONVENTIONS.md`:
- Node ≥22 ESM `.mjs`, zero dependencies, `node:` builtins only, git through `lib/git.mjs`.
- Named function exports only. `bin/ac.mjs` stays a thin dispatcher. Use `die()` for fatal errors, the `✓ • ⚠ ⊡` glyphs, and `json()`. Every new verb gets a `checkFlags` entry (ADR-029).
- Module headers say *why* and name the bug each rule prevents. New `lib/` modules are lowercase single words (`targeted.mjs`, `fullcheck.mjs`, `repair.mjs`).
- Workflow scripts use no semicolons, and their args stay small JSON scalars.
- Every `lib/` change gets a `node:test` test on a real filesystem and real git (`mkdtempSync` + `git init`, or `ac init` for CLI tests), with no mocks. A test may inject a `spawn` where the module takes one.
- Every new reporting slot states its bound (`tests/commands.test.mjs`): one line, or nothing when there is nothing to report.

It follows `DECISIONS.in-force.md`:
- **ADR-094** (amends ADR-079/089/091/093) is already recorded: 2026-11-13, at 2897187. CONTEXT's ADR item is therefore done, and **no task claims an ADR**. The pins below are implementation readings of ADR-094 and change none of its terms.
- **ADR-079/089/091/093 stay exactly as they are in `phase` mode.** Every fast-mode branch is keyed on `verifyFullSuite(root) === 'milestone'`, or on a verdict that was recorded in fast mode. A `phase`-mode project runs the same code paths as today.
- **ADR-090:** a suite criterion is still never deferrable. In fast mode it is not deferred. It is *carried to the milestone full check* (P4), which is ADR-094's own rule.
- **ADR-021:** the verifier stays plan-blind. The mode, the targeted set and the suite command all come from `ac`, never from the verifier's judgement.
- **ADR-017:** "the phase" means its stamped commits (`phaseStampedShas`). Attribution of suite failures reads the same stamps.
- **ADR-007:** the milestone tip is HEAD of the branch the check runs on (the `feature/m<N>` branch under gitflow). Repair commits land there.
- **ADR-018:** RED tests reach new symbols only through `await import()` inside async test bodies.
- **ADR-020:** every task leaves the suite green on its own. t4 pins the existing per-phase tests to `verify.full_suite: phase` BEFORE the default flips (t9, t10). A task that changes behaviour an existing test pins also updates that test.

Principles: `ac principles brief --stage plan --by planner` returned "no principles in scope" (stack: node).

**Test style:** every task writes its tests first, in the same task, with dynamic imports. No task is serialized test-after.

The plan aims at every criterion, C1 to C16. No task edits CRITERIA.md.

## Decisions this plan pins

**P1. The settings (C1, C6, C11, C15).** These live in `lib/config.mjs`, beside `slowSuiteMinutes`, with the same posture: a bad value falls back to the default and pushes one warning, and is never fatal.
- `verify.full_suite`: `milestone` (the default, which is fast mode) or `phase` (today's full suite on every phase PASS). Reader: `verifyFullSuite(root, warnings)`. Any other value gives the warning `verify.full_suite "<raw>" is not milestone or phase — using milestone`.
- `verify.repair_attempts`: an integer ≥ 1, default 2. Reader: `repairAttempts(root, warnings)`.
- `verify.targeted_command`: a string containing `{files}`, default `node --test {files}`. Reader: `targetedCommandTemplate(root, warnings)`. A value without `{files}` falls back with a warning.
- `verify.suite_command`: a string, with no default. Reader: `suiteCommandSetting(root, warnings)` returns the trimmed string or null.
- `ac config set verify.<key> <value>` already stores any value. No CLI change is needed for it.

**P2. The targeted set, in code (C3, C4).** It lives in a new module, `lib/targeted.mjs`.
- **Changed files:** `phaseStampedPaths(root, slug).files`, kept only when the file is tracked at HEAD (`trackedFiles`) and lies outside `.astrocode/`.
- **Test file:** `TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/`, the same rule as the mutate table's `testFiles`.
- **Linking.** Every changed test file is in the set. A tracked test file T is linked to a changed non-test file F when at least one of these holds:
  - (a) an `import … from '<spec>'`, `import('<spec>')` or `require('<spec>')` specifier in T resolves (posix `join(dirname(T), spec)`, normalised) to F;
  - (b) T contains a quoted string literal (`'…'`, `"…"` or `` `…` ``) equal to F's repo-relative path, ending in `/<F's path>`, or equal to F's basename;
  - (c) name rule: T's stem minus `.test`/`.spec` equals F's stem (`lib/config.mjs` → `tests/config.test.mjs`).
- **Output:** `{ tests, changed, unmapped, reason, limits }`.
  - `tests` is deduplicated and sorted with a plain `<` compare, never `localeCompare`, so two runs on one tree give the same order.
  - `unmapped` holds the changed non-test files that no test links to.
  - `reason` is `'no linked tests'` when `tests` is empty, else null.
  - `limits` is the constant `TARGETED_LIMITS`, one line: selection by stamped commits, by test-file name, by import specifiers and by quoted path or file-name literals, one hop only. It cannot see a test that reaches a changed file through another module, a spawned CLI or a computed path, and only `*.test|spec.[cm]?[jt]sx?` files are selected.
- **No fallback, ever, to the full suite.** An empty set runs nothing.
- **`subjectsOf(root, testFile, tracked)`:** the tracked non-test files that T links to by (a) to (c). It is the same rule read backwards, and t11 uses it for attribution.
- **`targetedCommand(template, files)`:** replaces `{files}` with the files, each one single-quoted for the shell (`'` escaped as `'\''`) and joined by spaces.

**P3. A targeted run is a suite receipt with a narrower command (C5).** `lib/receipts.mjs` gains `runTargeted(root, files, template, { spawn })` and `targetedEvidence(root, files, template)`. There is no second receipt format.
- **`runTargeted`:**
  - It first checks `reusableReceipt(root, cmd)`. When that is ok, the result is passed with `reused: true`.
  - Otherwise it calls `runSuite(root, cmd, { json: true, spawn })`.
  - On a non-zero exit, it runs each file alone (`targetedCommand(template, [f])`, one receipt each). `failing` is the files that fail alone. When every file passes alone, `failing` is the whole set and `note` reads `the set failed together; each file passed alone`.
  - It returns `{ command, files, passed, reused, receipt: { key, commit, exit }, failing, note? }`.
- **`targetedEvidence`** is read-only and runs nothing. It looks up the set's receipt and the per-file receipts at HEAD's commit and tree, and returns `{ command, ok, reason, receipt|null, failing }`. The reasons:
  - `targeted tests were not run on <sha7> — run \`ac verdict cheap <n>\``, when there is no receipt at HEAD;
  - `targeted tests failed on <sha7>: <files>`, when the set exited non-zero;
  - the receipt's own refusal (dirty tree, other node, and so on) otherwise.
- **`runSuite(root, cmd, { capture: true })`** pipes stdout and stderr instead of inheriting them. It returns the receipt plus a non-persisted `output` (the last 20 000 chars). The receipt written to disk is unchanged. t11 uses this.

**P4. The fast verdict (C1, C4, C5, C6, C14).** The changes go in `lib/verdict.mjs`.
- **Mode:** `const fast = verifyFullSuite(root) === 'milestone'`, read once per call.
- **Suite criteria in fast mode.** A suite criterion is in `suiteIds(text)`, carries the sticky suite mark, or is declared `suite: true`. When it is unreported (or reported `{ id, full_check: true, suite: true }`, which `validateResult` now accepts), the engine writes `{ id, status: 'carried', evidence: 'carried', last: 'unobserved', full_check: 'milestone', suite: true }`, the same shape as ADR-093's `held`.
  - It is never failing and never deferrable.
  - It is met in `recordVerdict`'s `passed` and in `verifiedGate` only when the verdict is fast AND the project is still in fast mode.
  - A suite criterion the verifier reported `passed: false` stays failed.
- **Fast evidence.** `verdict.fast = { mode: 'milestone', tests, command, receipt?, reason?, refused? }`.
  - **No linked tests:** `tests: []` and `reason: 'no linked tests'`. A PASS needs no test evidence (C4).
  - **Linked tests, inside the lock, for a non-cheap result:** `targetedEvidence` must be ok, with `receipt.commit === commit` (the graded commit) and exit 0.
  - **Otherwise** `fast.refused` holds the reason (which names the files), `passed` is false, `out.fast_refused` carries the reason, and the history line gets `fast_refused`.
  - `recordVerdict` NEVER runs tests itself. A new commit without a new `ac verdict cheap` is refused, which is the C5 "stale" case.
- **The base.** A fast PASS records `base: { run, commit, fast: true }`. In `phase` mode, `gatherScope`/`chooseMode` treats a `fast: true` base as no base, so the run plans `full`. A fast PASS is never a carry base for a per-phase verify. In fast mode, a fast base is a valid one-hop base.
- **`verifiedGate`.** On a verdict carrying `fast`:
  - It refuses when the project is now in `phase` mode (`recorded in fast mode; verify.full_suite is phase — re-verify`).
  - It refuses when `fast.refused` is set.
  - It refuses when `tests` is non-empty and `receipt.commit !== verdict.commit`, or `receipt.exit !== 0`, or the targeted set recomputed now differs from `fast.tests`.
  - A verdict WITHOUT `fast` passes the gate as today in either mode, so phases verified before this change still verify (C14).
- **Fast mode skips the suite throughout.** `planReverify` leaves suite ids out of `floor` and `order.last`, and adds `fast: { mode, tests, reason, limits, unmapped }`. No suite receipt is ever demanded, and nothing is held back.
- **`fastVerdictOf(root, slug)`** returns the latest verdict's `fast` object, or null. It is the one reader for the pending marker.

**P5. The cheap pass in fast mode (C1, C3, C4).** The changes go in `lib/cheappass.mjs`.
- Suite criteria are NOT run. There is no `reusableReceipt`, no `suiteSpeed`, no `runSuite` and no `held`. They are listed in `fast.milestone`, meaning carried to the milestone full check.
- A `Cheap:` command that is exactly a `SUITE_COMMANDS` entry is also skipped into `fast.milestone`, so a phase never pays for the suite through its own Cheap line.
- Every other `Cheap:` command runs as today.
- The targeted set is run with `runTargeted` and reported as `fast: { mode: 'milestone', tests, command, passed, failing, reused, reason, limits, unmapped, milestone }`.
- A red set makes the pass unclean (`clean: false`, exit 1) without adding a pseudo-id to `unmet`. Only criteria failures are recorded as the narrowed cheap verdict.
- With no linked tests, nothing runs and `fast.reason` is `'no linked tests'`.

**P6. The milestone full check (C8, C9, C10, C14).** It lives in a new module, `lib/fullcheck.mjs`. The result is **local**, stored at `.astrocode/.local/full-checks/<tip>.json`.
- **Why local:** a committed result would move HEAD, which invalidates the tip check it records. A tip-keyed file gives "a new commit needs a new check" for free. The cost: another clone needs its own check. This is the receipts posture of ADR-089.
- **Phases:** the phases of the closing milestone are `belongsToMilestone` + `plannedMilestones`, the same set `completeMilestone` uses.
- **Suite command,** in this order:
  1. `verify.suite_command`;
  2. the first command a `[suite]` criterion of those phases names (`suiteCommandsFor` result `!== SUITE_COMMANDS`);
  3. `npm test`, when package.json has `scripts.test`;
  4. otherwise the check fails with `no suite command — set verify.suite_command`.
- **`runFullCheck(root, { spawn, now })`:**
  1. Refuses on a dirty tree (`treeState`), since a dirty result could never pass the gate.
  2. Runs the suite once, through `reusableReceipt` first, else `runSuite(..., { capture: true })`.
  3. Runs every phase's `Cheap:` commands at HEAD. Phases are in number order and criteria in id order. Suite-command Cheap lines are skipped because the suite covers them. Every failure is collected (never the first only), with `CHEAP_TIMEOUT_MS` each.
  4. **On a suite failure:**
     - Candidates are the tracked test files whose path appears in the captured output. With none found, every tracked test file is a candidate.
     - Each candidate is re-run alone with `targetedCommand`, and the ones that fail alone are the failing tests.
     - A candidate that passes alone opens no fix and is listed under `flaky`.
     - When no test is identified, the result is one milestone-level failure carrying the output tail.
  5. Writes the result `{ version: 1, milestone, tip, tree, clean, passed, at, suite: { command, exit, key }, cheap: [{ phase, id, command, passed }], failures: [...], flaky, fixes: [ids] }`.
  6. Opens fixes (P7), then commits `.astrocode/fixes.json` path-limited, as `chore(fullcheck): milestone <m> — <n> fix(es) opened`, unstamped. This is the `lib/defer.mjs` pattern: `addFix` is never called inside the lock.
  7. Never starts a verifier.
- **Attribution:**
  - A criterion failure is tied to its phase.
  - A failing test T is tied to the phase of the newest commit in `git log --format=%H%x09%s -- <subjectsOf(T)>` whose subject carries a stamp of a phase in this milestone (`stampedPhase(subject)`, a new export of `lib/fixtures.mjs` beside `stampPatterns`, one rule). With no such commit or no subjects, it is tied to the milestone (`phase: null`).
- **`fullCheckCovers(root, commit)`:** a stored result with `passed && clean` whose `tip` has `commit` as an ancestor (or equal) and is itself an ancestor of HEAD.
- **`pendingPhases(root, phases)`:** the phases with status `verified` or `complete` whose `fastVerdictOf` is set and whose verdict commit `fullCheckCovers` does not cover. A verdict without `fast` is never pending (C14). In `phase` mode no fast verdicts are written, so nothing is pending (C6).
- **`fullCheckGate(root, { milestone, phases })`** returns `{ ok, required, reason }`.
  - `required` is false, and the gate is ok, when no phase in `phases` has a fast verdict (C6, C14, in-flight milestones).
  - Otherwise the gate needs three things:
    - the result for HEAD exists, `passed`, with `tree` equal to HEAD's tree;
    - the tree is clean now;
    - no check-created fix of this milestone has a status other than `verified` or `accepted`.
  - The refusal names the command (`ac milestone verify`, or `/astro-verify-milestone`), the tip of the last check (or none), and each open fix id.

**P7. Fixes the check opens (C9).** The changes go in `lib/fixes.mjs`.
- `addFix(root, { …, fullcheckFrom })` stores `fullcheck_from: { milestone, phase|null, criterion|null, test|null, command, tip }`. `command` is the exact command that re-checks it: the criterion's Cheap command, `targetedCommand(template, [T])`, or the suite command.
- It is a separate link from `deferred_from`, so `deferredFixes`, the "Deferred:" line and ADR-090's close gate are untouched.
- `fullCheckFixes(root, { milestone })` returns the non-accepted fixes with `fullcheck_from` (optionally of one milestone), sorted by id.
- **Dedup key:** `(milestone, phase, criterion, test)`. An open fix that already matches gets no duplicate. A matching `verified` fix whose failure is back is moved to `open`. Titles:
  - `full check: phase <n> <Cid> — <claim>`;
  - `full check: <test file> fails`;
  - `full check: milestone <m> suite fails`.
- `repro` is the failing command and output (redacted and capped by `addFix`).

**P8. Repair, bounded (C11).** It lives in a new module, `lib/repair.mjs`.
- **`repairFix(root, ref, { spawn })`** works only on a check-created fix.
  - When `repair_attempts >= repairAttempts(root)`, it returns `{ exhausted: true }` and runs nothing.
  - Otherwise it re-runs `fullcheck_from.command` through the shell at HEAD and increments `repair_attempts`.
  - On exit 0 the fix moves to `verified` (lifecycle: the reproduction passes); otherwise its status is kept. `last_repair: { attempt, commit, passed, at }` is recorded either way.
  - It commits `fixes.json` path-limited (`chore(fullcheck): repair <id> attempt <k> — fixed|still failing`) so the tree stays clean for the re-check.
  - It returns `{ id, attempt, limit, passed, exhausted }`.
- **`repairReport(root, { milestone })`** returns `{ fixed: [verified check fixes], open: [the rest, with attempts used] }`.
- The agent part lives only in `commands/astro-verify-milestone.md` (t17), with Agent and inline tiers:
  - per open fix, at most `limit` attempts;
  - each attempt is one `astro-executor` spawn scoped to that fix's repro, ending in a commit whose subject ends `(fix <id> a<k>)`, followed by `ac milestone repair <id>`;
  - then a fresh `ac milestone verify` when any repair commit landed (the old result is stale);
  - then the morning report from `ac milestone repair`.
- Scheduling the run is out of scope.

**P9. The surfaces (C7, C12, C13).** The marker text is `fast-verified, full check pending`. It is derived at render time from P6's `pendingPhases` and is never stored.
- **`ac status`:** the pending phase's line gets ` · fast-verified, full check pending`.
- **`statusJson`:** each pending phase gets `full_check_pending: true`, and there is a top-level `full_check_pending: [numbers]`. The key is absent when the list is empty. The band reads it and draws one `FULL CHECK pending 57 58` row, or no row.
- **`ac phase show`:** gets `full_check_pending: true`, present only when pending.
- **`ac phase accept`:** prints `• phase <n> is fast-verified — full check pending (runs on the milestone tip before close)` when the phase is pending. When no non-complete phase of the closing milestone is left AND `fullCheckGate(...).required && !ok`, it prints exactly one more line: `• last phase of milestone <m> accepted — run the milestone full check: \`ac milestone verify\` (/astro-verify-milestone)`. It never starts the check. A non-last accept prints no proposal.
- **`ac flow release`:** the PR body and the returned `notes` get `Full check pending (fast-verified, ADR-094): phase <n> <name>`, one line per pending phase, or nothing. `ac flow tag` appends the same lines to the annotated tag message. The CLI prints the pending lines (bounded: one per phase, else nothing).

## Tasks

### t1 — Settings: verify mode, repair attempts, targeted command, suite command (P1; C1, C6, C11)
- **files:** lib/config.mjs, tests/verify_mode_config.test.mjs
- **depends_on:** —
- Write `tests/verify_mode_config.test.mjs` first, on a scratch dir with `.astrocode/config.json`. Cases:
  - unset → `milestone`; `phase` → `phase`; `"Phase"`, `"fast"` and `1` → `milestone` plus one warning each;
  - `repair_attempts` unset → 2, `3` → 3, and `0`, `-1`, `"x"`, `1.5` → 2 plus a warning;
  - `targeted_command` unset → `node --test {files}`, `"node scripts/test.mjs {files}"` kept, `"npm test"` (no `{files}`) → default plus a warning;
  - `suite_command` unset → null, `"  npm test "` → `npm test`.
- Implement the four readers beside `slowSuiteMinutes`, with a header comment naming ADR-094 and why a typo never silently picks a mode.

### t2 — Targeted test selection in code (P2; C3, C4)
- **files:** lib/targeted.mjs, tests/targeted.test.mjs
- **depends_on:** —
- Write `tests/targeted.test.mjs` first, on a real scratch git repo with stamped commits `(phase 07 t1)`. Cases:
  - **C3 layout:** `src/a.mjs`, `src/b.mjs`, `tests/a.test.mjs` imports `../src/a.mjs`, `tests/b.test.mjs` imports `../src/b.mjs`, `tests/c.test.mjs` imports neither. The phase changes `src/a.mjs` and adds `tests/d.test.mjs`. The set is exactly `['tests/a.test.mjs','tests/d.test.mjs']`, identical on two calls.
  - An unstamped commit and a `(phase 08 t1)` commit changing `src/b.mjs` do not add `tests/b.test.mjs`.
  - Dynamic `await import('../src/a.mjs')` links. A quoted `'commands/x.md'` literal links. The name rule links `lib/config.mjs` → `tests/config.test.mjs`.
  - **Docs-only phase** (`README.md`, `commands/x.md`, named by no test): `tests: []`, `reason: 'no linked tests'`, and `unmapped` lists both.
  - A deleted file and `.astrocode/` paths never enter.
  - `subjectsOf` returns `['src/a.mjs']` for `tests/a.test.mjs`.
  - `targetedCommand('node --test {files}', ["a b.mjs", "it's.mjs"])` quotes both safely.
  - `TARGETED_LIMITS` is one line and says `one hop`.
- Implement `TEST_FILE`, `TARGETED_LIMITS`, `linkedTests`, `targetedTests(root, slug)`, `subjectsOf` and `targetedCommand`. Reuse `phaseStampedPaths` and `trackedFiles`. The module imports nothing from verdict.mjs or receipts.mjs, so no import cycle is possible.

### t3 — Fixes the full check opens: provenance link, reader, dedup (P7; C9)
- **files:** lib/fixes.mjs, tests/fixes_fullcheck.test.mjs
- **depends_on:** —
- Write `tests/fixes_fullcheck.test.mjs` first:
  - `addFix` with `fullcheckFrom` stores `fullcheck_from` and leaves `deferred_from` absent;
  - `deferredFixes` does not list it;
  - `fullCheckFixes(root, { milestone: 3 })` lists only milestone 3's non-accepted ones;
  - `findFullCheckFix(root, key)` finds the open match for `(milestone, phase, criterion, test)` and ignores accepted ones.
- Implement the `fullcheckFrom` option, `fullCheckFixes` and `findFullCheckFix`. Extend the module header's "link field" section with the second link and why it is separate from `deferred_from`.

### t4 — Pin the existing per-phase verify tests to `verify.full_suite: phase` before the default flips (ADR-020)
- **files:** tests/cheappass.test.mjs, tests/defer.test.mjs, tests/defer_cli.test.mjs, tests/fleet.test.mjs, tests/mutate.test.mjs, tests/mutate_cli.test.mjs, tests/mutate_survivors.test.mjs, tests/mutate_triage.test.mjs, tests/slow_suite_cli.test.mjs, tests/verdict.test.mjs, tests/verdict_broad.test.mjs, tests/verdict_cheap_cli.test.mjs, tests/verdict_cli.test.mjs, tests/verdict_held.test.mjs, tests/verdict_history.test.mjs, tests/verdict_history_cli.test.mjs, tests/verdict_targeted.test.mjs, tests/verdict_targeted_cli.test.mjs, tests/verdict_targeted_e2e.test.mjs, tests/verdict_targeted_record.test.mjs
- **depends_on:** —
- These tests pin ADR-079/089/091/093, which are per-phase behaviour. Each scratch project they build gets `"verify": { "full_suite": "phase" }` in `.astrocode/config.json`. Use the file's own fixture helper, or `ac config set verify.full_suite phase` in CLI tests. Merge into any config the test already writes; never overwrite one.
- The key is ignored by today's code, so the suite stays green at this boundary. After t9 and t10 it keeps these tests on today's path.
- Never change an assertion. Add a one-line comment per file: `// ADR-094: this file pins per-phase verify; fast mode is covered by verify_fast*.test.mjs`.
- Run `node scripts/test.mjs` on the listed files before committing.

### t5 — Workflow tier: fast mode in the verifier and remediation prompts (P4, P5; C1, C2)
- **files:** workflows/execute-phase.mjs, tests/verify_fast_workflow.test.mjs
- **depends_on:** —
- Write `tests/verify_fast_workflow.test.mjs` first, reusing the `tests/verify_loop.test.mjs` AsyncFunction harness (stub queues, recorded `calls`). Cases:
  - **(a) Fast mode, clean set.** The cheap stub returns `fast: { mode: 'milestone', tests: ['tests/a.test.mjs'], command: "node --test 'tests/a.test.mjs'", passed: true, milestone: ['C9'] }`. The verifier prompt says not to run the full test suite in fast mode, and names the targeted command and `tests/a.test.mjs`. It says suite criterion C9 is left out because ac carries it to the milestone full check. It contains neither `Run the full test suite` nor `ac suite run`/`ac suite receipt`.
  - **(b) No linked tests.** `fast.tests: []` and `reason: 'no linked tests'`. The prompt says `no linked tests` and that no tests are run.
  - **(c) Red set.** `fast.passed: false` and `failing: ['tests/a.test.mjs']`, with no unmet ids. No verifier is spawned. The summary starts `FAIL — targeted tests red (tests/a.test.mjs)`. The remediation prompt lists the failing files and the command, and tells the executor to run only the targeted tests, never the full suite.
  - **(d) C2 remediation.** A fast-mode FAIL on C2 sends a remediation prompt that says to run the targeted tests (the command) and not the full suite.
  - **(e) C6.** With no `fast` in the cheap result (phase mode, or cheap unavailable), every prompt is byte-identical to today's. The existing verify_loop, verify_slow_suite and verify_overlap tests stay green unchanged.
- Implement:
  - `CHEAP_SCHEMA.fast` (`additionalProperties: true`), with `runCheapStage` asking for it;
  - a `fastInfo` set from the cheap result;
  - `structuralChecks`, the targeted/narrowed step text and `heldParagraph` choose fast or phase wording from `fastInfo`;
  - `remediatePrompt` names the targeted command in fast mode;
  - a red set ends the round as P5 says, with one remediation item `{ id: 'targeted-tests', command, output: 'failing: …' }`. It never enters `lastSeen` or the recorded criteria.
- `runTestSuite` (the healed-wave gate) and `execPrompt`/`healPrompt` are execute-time and are not touched. No semicolons.

### t6 — Contract text, both tiers: fast mode never runs the full suite (P4, P5; C1, C2)
- **files:** commands/astro-verify.md, agents/astro-verifier.md, commands/astro-execute.md, tests/verify_contract.test.mjs
- **depends_on:** —
- First, extend `tests/verify_contract.test.mjs` `SAYS` (the contract block, the agent text and astro-verify.md each). The new phrases:
  - `/in fast mode[^.]*never run the full (?:test )?suite/i`;
  - `/the targeted tests `ac verdict cheap` ran \(`fast\.tests`\)/`;
  - `/no linked tests/`;
  - `/carried to the milestone full check/i`;
  - `/with `verify\.full_suite: phase`[^.]*run the full suite/i`.
- Add one test that `commands/astro-execute.md` says a remediation executor in fast mode runs only the targeted tests, never the full suite. The existing SAYS (slow suite last, held) stay, since they apply in phase mode. The LEAK_RE test stays green.
- Rewrite:
  - the "run the full suite" clause of the contract block to the fast/phase pair;
  - step 2 of `astro-verify.md`: the cheap pass reports `fast` (the mode, the targeted set or `no linked tests`, and the limits line), and a red targeted set is a FAIL like an unmet id;
  - the structural "run the full suite" step and step 4 of the targeted section in `astro-verifier.md` (suite receipts only in phase mode);
  - the remediation step of `astro-execute.md`.
- Every new report slot states its bound: one line for the targeted set, one line for `no linked tests`, and nothing otherwise.

### t7 — Targeted runs on the receipt machinery, plus captured suite output (P3; C5, C9)
- **files:** lib/receipts.mjs, tests/targeted_run.test.mjs
- **depends_on:** t2
- Write `tests/targeted_run.test.mjs` first, on a scratch repo with two test files whose command appends to a marker outside the repo. Cases:
  - a green set writes one receipt; a second call at the same clean HEAD is `reused` and the marker is unchanged;
  - a red set runs each file alone and `failing` names exactly the red one;
  - `targetedEvidence` returns `not run on <sha7>` before any run, `failed on <sha7>: tests/b.test.mjs` after a red run, and ok after a green run; after a new commit it returns `not run`;
  - a dirty tree is refused through the receipt's own reason;
  - `runSuite(..., { capture: true })` returns `output` and writes a receipt without it.
- Implement `runTargeted`, `targetedEvidence` and the `capture` option. Extend the header with "a targeted run is a receipt with a narrower command (ADR-094)".

### t8 — Bounded repair of check-created fixes, in code (P8; C11)
- **files:** lib/repair.mjs, tests/repair.test.mjs
- **depends_on:** t1, t3
- Write `tests/repair.test.mjs` first, on a scratch repo with two check-created fixes. Each fix's `command` reads a flag file outside the repo.
  - Fix A's flag is set to pass after "attempt 1": `repairFix` → `passed: true`, the status becomes `verified`, and `attempt` is 1.
  - Fix B never passes. Attempts 1 and 2 report `passed: false`; a third call returns `exhausted: true` and runs nothing (marker unchanged).
  - `verify.repair_attempts: 3` allows a third attempt.
  - A deferred fix or a plain fix is refused.
  - Each attempt leaves the tree clean (`fixes.json` committed).
  - `repairReport` returns A under `fixed` and B under `open`, with `attempts: 2`.
- Implement it per P8.

### t9 — Verdict engine: fast evidence, suite criteria carried to the milestone check, the gate, the base rule (P4; C1, C4, C5, C6, C14)
- **files:** lib/verdict.mjs, tests/verify_fast.test.mjs
- **depends_on:** t1, t2, t4, t7
- Write `tests/verify_fast.test.mjs` first: a scratch repo with no verify setting, the C3 layout, and CRITERIA.md with C1, C2 and C3 `[suite]`. Drive `recordVerdict`, `verifiedGate` and `planReverify` through dynamic imports. Cases:
  - **C5 red:** a red `runTargeted` at HEAD, then record `{mode:'full', criteria:[C1 passed, C2 passed]}`. `passed` is false, `fast_refused` names `tests/a.test.mjs`, and `verifiedGate` refuses with that file.
  - **C5 green:** fix the test, commit, `runTargeted` green, record. `passed` is true, and C3 is `carried`/`full_check: 'milestone'`. `verifiedGate` is ok with no suite receipt anywhere.
  - **C5 stale:** a new commit changing `src/a.mjs`, then record PASS. Refused as `not run on <sha7>`.
  - **C4:** a docs-only phase records a PASS with `fast.reason: 'no linked tests'` and no receipt, and the gate is ok.
  - **C6:** with `verify.full_suite: phase`, the same PASS JSON without C3 records C3 failed (today's rule). With a fast verdict on file, `verifiedGate` refuses `recorded in fast mode`. A fast `base` does not make the phase-mode plan targeted.
  - **C14:** a verdict without `fast`, all passed, is gate-ok in fast mode, and `fastVerdictOf` is null.
  - `planReverify` in fast mode has `fast.tests` and no suite id in `floor` or `order.last`.
- Implement per P4. `validateResult` accepts `full_check: true` (with `suite: true`). `readVerdict` accepts the new fields. Extend the module header with an ADR-094 paragraph.

### t10 — The cheap pass in fast mode: targeted set, no suite, no linked tests (P5; C1, C3, C4)
- **files:** lib/cheappass.mjs, tests/cheappass_fast.test.mjs
- **depends_on:** t1, t2, t4, t7
- Write `tests/cheappass_fast.test.mjs` first, with no verify setting. The suite command appends `SUITE` to a log outside the repo, and each test file appends its own name.
  - **C1:** a `[suite]` criterion plus a criterion whose Cheap command exits 0. `runCheapPass` leaves the log without `SUITE`, has the covering test file run, and returns `fast.mode === 'milestone'`, `fast.tests` and `fast.milestone` containing the suite id. `held` is empty.
  - A `Cheap:` line `npm test` goes to `fast.milestone` and is not run.
  - **C4:** a docs-only phase runs no test, gives `fast.reason === 'no linked tests'`, and is clean.
  - A red set gives `clean: false`, `fast.failing`, `unmet` without pseudo-ids, and records no cheap verdict when no criterion failed.
  - **C6:** with `verify.full_suite: phase`, the existing suite/held path is unchanged (one `SUITE` line, or held when slow).
- Implement per P5. Extend the header: in fast mode the ADR-093 hold never applies, because the suite is skipped, not deferred.

### t11 — The milestone full check: run, attribution, fixes, local result, pending, close gate (P6, P7; C8, C9, C10, C14)
- **files:** lib/fullcheck.mjs, lib/fixtures.mjs, tests/fullcheck.test.mjs
- **depends_on:** t1, t2, t3, t7, t9
- Write `tests/fullcheck.test.mjs` first, using the CRITERIA C8 layout: a milestone with P1 (two Cheap lines), P2 (one) and P3 (none). Each Cheap line appends `<phase>:<id>:$(git rev-parse HEAD)` to a log, and the suite (`verify.suite_command`) appends `SUITE:<sha>`. Drive the module through dynamic imports with the real shell. Cases:
  - **C8:** one `SUITE:<tip>` line and exactly three Cheap lines, all at the tip. P3 adds nothing. `passed`, and the result file is at `.local/full-checks/<tip>.json`.
  - **C9:** P2's Cheap line is made to fail. A test whose subject was last changed by P1's stamped commit is broken, and so is a test whose subject only an unstamped commit changed. The check opens one fix tied to P2 (with the command and output in `repro`), one tied to P1 (`test` set) and one with `phase: null`. `fixes.json` is committed. A second run opens no duplicate. A flaky candidate (it passes alone) opens nothing and is listed in `flaky`.
  - **C10 gate:**
    - (a) no result → not ok, naming `ac milestone verify`;
    - (b) a failing result with open fixes → not ok, naming them;
    - (c) fixes `verified` plus a passing result at HEAD → ok;
    - (d) one more commit → not ok (`not the current tip`).
  - **C6/C14:** a milestone whose phases have no fast verdict → `required: false`, ok.
  - **Pending:** a fast-verified phase is pending, not pending after a passing check whose tip contains its verdict commit, and a verdict without `fast` is never pending.
  - **Suite command resolution order:** setting, then `[suite]` criterion, then `npm test` from package.json, then the `no suite command` failure.
  - A dirty tree is refused.
- Implement per P6 and P7. Add `stampedPhase(subject)` to `lib/fixtures.mjs`, built on `stampPatterns`' rule (one place for the stamp rule, 9173), with a case in this task's test.

### t12 — `ac milestone complete` refuses without a passing full check on the tip (P6; C10)
- **files:** lib/milestone.mjs, tests/milestone_fullcheck_gate.test.mjs
- **depends_on:** t11
- Write `tests/milestone_fullcheck_gate.test.mjs` first, modelled on `tests/milestone_deferred.test.mjs`:
  - `completeMilestone` throws with the gate's reason and changes nothing (no archive dir, roadmap unchanged) for (a), (b) and (d);
  - it succeeds for (c);
  - a milestone with no fast verdicts closes as before (C6).
- Implement: `const { fullCheckGate } = await import('./fullcheck.mjs')` BEFORE `withLock`, which avoids the milestone↔fullcheck import cycle. Call it beside the `deferredFixes` block and throw on `!ok`. Add the comment `--force does not bypass this`, the ADR-090 posture.

### t13 — The band and `ac status --json`: full check pending (P9; C7)
- **files:** lib/nextstep.mjs, mods/astro-mods/hooks/lib/band.js, tests/full_check_pending_band.test.mjs
- **depends_on:** t11
- Write `tests/full_check_pending_band.test.mjs` first:
  - `statusJson` on a scratch project with one fast-verified phase has `full_check_pending: [n]` and the phase entry `full_check_pending: true`;
  - after a passing check, both keys are absent;
  - `bandView` draws one `FULL CHECK pending <n>` row when the key is present and none when it is absent or empty.
- Implement it with the same key-absent-when-empty posture as `deferred_fixes`.

### t14 — Release notes mark fast-verified phases (P9; C13)
- **files:** lib/flow.mjs, tests/flow_full_check_pending.test.mjs
- **depends_on:** t11
- Write `tests/flow_full_check_pending.test.mjs` first, with a local bare remote. `flowRelease` returns `notes` containing `Full check pending (fast-verified, ADR-094): phase <n> <name>`, and the PR body equals the notes. After a passing check on the tip, there is no such line. The `flowTag` annotated message carries the same lines (`git tag -n99`).
- Implement a `pendingNotes(root)` helper in flow.mjs that calls `pendingPhases` over the roadmap's phases.

### t15 — CLI part A: fast mode in `verdict cheap|plan|record`, `phase verify|show|accept` and `status` (P4, P5, P9; C1, C3, C4, C5, C6, C7, C12 accept, C14)
- **files:** bin/ac.mjs, tests/verify_fast_cli.test.mjs
- **depends_on:** t9, t10, t11
- Write `tests/verify_fast_cli.test.mjs` first, against the real `node bin/ac.mjs` in an `ac init` scratch project with no verify setting (the CRITERIA layouts). Cover:
  - **C1/C3:** `verdict cheap --json` twice gives the same `fast.tests` (`tests/a.test.mjs`, `tests/d.test.mjs`), no `SUITE` in the log, and the limits line. The text output has one `• fast mode: …` line and one `• limits: …` line. `verdict plan --json` has `fast`.
  - **C4:** a docs-only phase prints `no linked tests`, runs no test, and `verdict record` PASS + `phase verify` succeed.
  - **C5:** red → `verdict record` exits 1 with `⚠ fast PASS refused: … tests/a.test.mjs`, and `phase verify` dies naming it. Green after `verdict cheap` → accepted. A new commit → refused.
  - **C6:** with `ac config set verify.full_suite phase`, `verdict cheap` runs the suite (or holds it) and a PASS without the suite criterion is refused. After verify + accept, `status` has no marker.
  - **C7:** after a fast verify, `status`, `phase show --json` and `phase accept --agent test` each show `full check pending`.
  - **C12 (accept):** accepting a non-last phase prints no proposal. Accepting the last prints exactly one `ac milestone verify` line and starts nothing (no new result file).
  - **C14:** a verdict without `fast` shows no marker.
- Implement the output per P4, P5 and P9. Update the help descriptions of `verdict cheap` and `phase verify` to say fast mode.

### t16 — CLI part B: `ac milestone verify|repair`, the close refusal, release notes output (P6, P8, P9; C8, C9, C10, C11, C12 close, C13)
- **files:** bin/ac.mjs, tests/milestone_fullcheck_cli.test.mjs
- **depends_on:** t8, t12, t14, t15
- Write `tests/milestone_fullcheck_cli.test.mjs` first, against `node bin/ac.mjs` with the C8 layout. Cover:
  - **C8:** `milestone verify --json` exits 0, gives one `SUITE:<tip>` and three Cheap lines, and the text report leads with `✓ milestone <m> full check PASS on <sha7>`.
  - **C9:** a failing check exits 1. `fix list --json` shows fixes whose `fullcheck_from.phase` is P2, P1 and null. A re-run adds none.
  - **C10:** `milestone complete` exits non-zero in (a) naming `ac milestone verify`, in (b) naming the open fixes, and in (d) after a new commit. It succeeds in (c), checked on a copy of the repo.
  - **C11:** `milestone repair <id> --json` drives P8. `milestone repair` (no id) prints the report: one `✓ fixed <id>` line or one `• still open <id> (2/2 attempts)` line per fix, and nothing when there are no check fixes.
  - **C12 (close):** the refusal is one line plus the command.
  - **C13:** `flow release` against a local bare remote prints the pending line, and prints none after a passing check.
  - `ac help` lists `ac milestone verify [--json]` and `ac milestone repair [<fix>] [--json]`.
- Implement the `'verify'` and `'repair'` branches of `case 'milestone'`, the `checkFlags` entries (`'milestone verify': ['json']`, `'milestone repair': ['json']`), the help lines, and the pending lines in `flow release`/`flow tag` output.

### t17 — Docs and the `/astro-verify-milestone` command; full suite green (P1, P8, P9; C11, C12, C15, C16)
- **files:** commands/astro-verify-milestone.md, commands/astro-accept.md, commands/astro-complete-milestone.md, commands/astro-config.md, MANUAL.md, CHANGELOG.md, tests/fullcheck_docs.test.mjs
- **depends_on:** t16
- Write `tests/fullcheck_docs.test.mjs` first:
  - MANUAL.md and astro-config.md name `verify.full_suite` with both values and the default `milestone`, plus `verify.repair_attempts` (default 2), `verify.targeted_command` and `verify.suite_command`. They describe what a phase verify runs in each mode, including `no linked tests` and the limits, plus the full check, failures becoming fixes, repair, and that close needs a passing check on the current tip.
  - Every `ac milestone <verb>` named in those docs and in the new command appears in `node bin/ac.mjs help`.
  - `astro-verify-milestone.md` states the per-fix attempt bound from `verify.repair_attempts`, the re-check after each attempt, the fresh `ac milestone verify` after repairs, and the fixed/still-open report, one line per fix.
  - `astro-accept.md` and `astro-complete-milestone.md` propose the full check in one line with the command, and say nothing otherwise.
- Write `commands/astro-verify-milestone.md`: frontmatter plus short numbered steps, in the Agent tier then the inline tier, per P8.
- Add the one-line proposal step to `astro-accept.md` (only when `ac phase accept` printed it) and `astro-complete-milestone.md` (when `ac milestone complete` refuses for the full check).
- Update `astro-config.md`, `MANUAL.md` (beside `verify.slow_suite_minutes`) and a `CHANGELOG.md` entry in the existing style.
- `tests/commands.test.mjs` and `tests/contracts.test.mjs` stay green. **C16:** run `node scripts/test.mjs` green before this commit.

## Waves
- **Wave 1 (parallel):** t1, t2, t3, t4, t5, t6. Their files are disjoint.
- **Wave 2:** t7 (needs t2) and t8 (needs t1 and t3).
- **Wave 3:** t9 and t10 (each needs t1, t2, t4 and t7). Their files are disjoint.
- **Wave 4:** t11 (needs t9).
- **Wave 5:** t12, t13, t14 and t15 (each needs t11; t15 also needs t9 and t10). Their files are disjoint.
- **Wave 6:** t16 (needs t15, the same file; and t8, t12 and t14).
- **Wave 7:** t17, which closes C15 and C16.

## Deferred (not tasks)
- A workflow script for the repair loop (`workflows/`). The command's Agent tier, plus the deterministic `ac milestone repair` verb, meets C11.
- Test-file patterns and default commands for other stacks (pytest, go). `verify.targeted_command` plus the stated limits cover a custom runner for now.
- Fast mode for the execute-time healed-wave gate (`runTestSuite`) and for `/astro-fix`'s "run the full suite". These are not phase verify.
- Splitting criteria across parallel verifiers (CONTEXT: out of scope).
- Speeding up the slow test files (CONTEXT: a backlog candidate).
- Re-measuring calibration (`/astro-calibrate`) under fast mode.
- Refusing a bad `verify.*` value at `ac config set`. The fallback plus the warning is enough.
