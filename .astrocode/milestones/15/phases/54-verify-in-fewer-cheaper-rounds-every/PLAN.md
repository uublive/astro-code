# Plan: phase 54, verify in fewer, cheaper rounds

This plan follows `.astrocode/CONVENTIONS.md`:
- Node ≥22 ESM `.mjs`, zero dependencies, `node:` builtins only, git through `lib/git.mjs`.
- Named function exports only. `bin/ac.mjs` stays a thin dispatcher. `die()` for fatal errors, `✓ • ⚠ ⊡` glyphs, `json()`.
- State writes go through `withLock` + `atomicWriteJSON`/`atomicWriteText`.
- Module headers say *why*, naming the bug each rule prevents.
- Workflow scripts use no semicolons and pass small scalar args.
- Every `lib/` change gets a `node:test` test on a real filesystem and real git (`mkdtempSync` + `git init`).
- Every new reporting slot in a command states its bound (§Voice, checked by `tests/commands.test.mjs`).

It follows `DECISIONS.in-force.md`. The decisions that matter here:
- **ADR-079 and ADR-089 are amended, not replaced.**
  - The narrowed decision and targeted verify keep every rule, except D5 (every observed unmet id is listed) and D6 (a broad claim is checked in code).
  - Deferral changes what `verified` means for edge criteria only. The new ADR says so (t6).
- **ADR-021/031:** a PASS never rests on cheap-stage evidence or on a carry the code did not re-check. ADR-006: `verified` stays the AI gate, and only `ac phase accept` completes a phase.
- **ADR-005/019/040:** D7 reuses `integrateWave`, honours `use_worktrees`, keeps the adaptive sequential downgrade, and keeps SYNC FIRST.
- **ADR-074/033:** deferral is a human act. `ac verdict defer` refuses `--agent`, and no workflow or agent ever calls it.
- **ADR-087:** ADR numbers are claimed only by `ac decision add`.
- **ADR-018:** a new symbol is reached by `await import()` inside async test bodies. **ADR-020:** every task leaves the suite green on its own.
- **ADR-029:** every new verb or flag gets a `checkFlags` allowlist entry.

It follows CONTEXT.md D1 to D9 plus the folded backlog and debt, and aims at every criterion C1 to C15 in CRITERIA.md. This phase's own CRITERIA.md is untagged, so all of it is core. **No task edits it.**

Principles applied (`ac principles brief --stage plan --by planner`):
- **333f / ce7b:** code holds every refusal: deferrability, the cheap-evidence bar, broad-claim support, cache reuse and milestone close. Prose only describes them.
- **9173:** one rule per place:
  - one tag reader (`edgeIds`) and one `canDefer`, shared by record, gate and defer;
  - one `broadClaim`, shared by plan and record;
  - one `deferredFixes`, shared by status, phase show, band and milestone close;
  - one history module.
- **b940:** every refusal, cache miss and downgrade prints its reason.
- **1a0d / 5116:** automation only proposes, by listing what is deferrable. Nothing prompts. An unattended FAIL stays a FAIL.
- **e618:** one-line report slots. The open-deferred list is one JSON key or one line, and absent when empty.
- **2310 (deliberately not applied):** there is no new slash command. Deferral is typed as `ac verdict defer`, and `/astro-verify`, `/astro-execute` and `/astro-accept` present it. Canon (CONVENTIONS §File layout) wins on conflict.

## Decisions this plan pins (CONTEXT "Open / for the planner")

**P1. The core/edge tag syntax (D2, C13).**
- **Where the tag goes:** in the heading's bracket-tag run, right after the id. The core/edge tag comes last in that run: `### C7 [edge] — …`, `### C4 [mutation] [edge] — …`, or `### C3 [core] — …`.
- **The reader:** `edgeIds(text)` in `lib/impact.mjs`, next to `suiteIds`. It reads only the run of `[word]` tags directly after `C<n>` on the heading, using spaces and tabs only, never `\s`, and finds `[edge]` there by exact, case-sensitive match.
- **Everything else is core:** untagged, `[Edge]`, `[edge ]`, `edge` written in the claim text, or a tag on the next line.
- **Existing tags stay first:** `[suite]` and `[mutation]` keep their existing matchers, so the contract tells the author to put them first.

**P2. Deferrability is one rule: `canDefer(root, slug, id, text)` in `lib/verdict.mjs`.** It returns `{ ok, reason }`. The checks run in this order, and the first failure is the reason:
1. `id` is in `edgeIds(text)` (untagged or core → "core criterion — never deferrable");
2. `id` is not a suite criterion (`suiteIds(text)` ∪ sticky `suite` marks → "suite criterion — never deferrable");
3. `id` was edge at pre-registration. The reference is the CRITERIA.md blob in the first commit that added the phase's `PLAN.md` (`git log --diff-filter=A --format=%H -- <PLAN.md> | tail -1`, then `git show <sha>:<CRITERIA.md>`). If PLAN.md was never committed, the reference is the committed HEAD blob, and if that does not exist either, the current text. A tag added after planning gives "tagged edge after the plan existed — the bar is fixed at pre-registration (D2)". A git error refuses (fail closed).

Record, gate and defer all call `canDefer`.

**P3. Deferral data model (D1, D3).**
- **The verdict entry:** VERDICT.json gains the entry status `deferred`, with `fix_id` (required) and `deferred_at_run`. `readVerdict` accepts it only together with a string `fix_id`.
- **The verifier cannot defer:** `validateResult` throws on any `deferred`, `status: 'deferred'` or `fix_id` in a verifier result: "a verifier cannot defer — deferral is a human act (ac verdict defer)".
- **Failed entries keep their evidence:** a failed observed entry stores the verifier's `command` and `output`, each redacted (`redactSecrets`) and truncated to 2000 chars.
- **The fix record (`lib/fixes.mjs`):** it gains the additive fields `deferred_from: { phase: slug, criterion, run, commit }` and `repro` (string, ≤ 4000 chars, redacted). `addFix` persists both. The fix title is `deferred: phase <NN> <Cn> — <heading claim>`, which gives a unique dated slug.
- **How a later record treats a deferred entry:**
  - An entry the prior verdict deferred stays `deferred` (same `fix_id`) when the new run does not report it, or reports it failed, as long as `canDefer` still holds and the fix still exists. If either fails, normal handling applies.
  - When the new run reports it passed, the entry becomes `passed`. The fix stays open until a human accepts it.
- **`failingOf` skips `deferred`.**
- **What counts as a pass:**
  - A full record passes when every entry is `passed` or validly `deferred`.
  - `verifiedGate` re-checks every deferred entry fresh: `canDefer` plus the fix existing in `fixes.json` in any status. So a hand-written verdict that defers a core, untagged or suite criterion is refused (C3d).
- **What closing the fix changes:** closing it never edits the verdict.
- **Open deferred fixes:** `deferredFixes(root, { phases })` in `lib/fixes.mjs` returns the fixes that are not `accepted` and have `deferred_from`, optionally filtered to a set of phase slugs. `completeMilestone` refuses, before any write, while `deferredFixes(root, { phases: mine })` is non-empty, naming each fix. `--force` does not bypass this.

**P4. Cheap first pass (D4, C2, C3a).**
- **Declaring it:** a criterion may declare a `- **Cheap:** \`<command>\`` line. The command is the first backticked span on that line, and its exit 0 means met. `cheapCommands(text)` in `lib/impact.mjs` parses these lines like `FILES_LINE`, returning a Map from id to command. A line with no backticked span is ignored, so that criterion is checked in the expensive stage.
  - A `[suite]` criterion's cheap observation is its suite command (`suiteCommandsFor`), checked through `reusableReceipt` first and `runSuite` only on a miss.
- **Running it:** `runCheapPass(root, slug, { spawn })` in the new `lib/cheappass.mjs`.
  - It runs each check with a 10-minute timeout per command.
  - It returns `{ clean, ran: [{id, kind: 'suite'|'cheap', passed, command, output, receipt?}], unmet: [...], unchecked: [ids with no cheap observation], recorded }`.
  - It reports EVERY unmet id. It never bails on the first one.
  - When anything is unmet, it records a verdict via `recordVerdict(root, slug, { mode: 'narrowed', stage: 'cheap', criteria: <unmet only, passed:false, command, output> })`. When everything is clean, it records nothing.
- **How the record treats a cheap stage:**
  - `stage: 'cheap'` (on the result, or on any criterion) forces mode `narrowed`, so it can never pass.
  - A criterion reported passed with `stage: 'cheap'` is **never** recorded as passed. It is handled as unreported.
  - In a narrowed record with no prior entry, an unreported criterion is `{ status: 'carried', last: 'unobserved' }` instead of `failed`, so a first-run cheap FAIL lists only what it saw. `failingOf` ignores `unobserved`, and the targeted gate counts it as unmet.
  - The verdict stores `stage: 'cheap'`. `verifiedGate` refuses any verdict with `stage === 'cheap'`.
- **The CLI:** `ac verdict cheap <phase> [--json]` exits 1 when anything is unmet and 0 otherwise. When nothing is declared it prints `⊡ no cheap observation declared — nothing checked`.
- **The workflow:** it runs this clerk first in every verify round (`label: 'verify:cheap'`). On unmet, the round ends with a FAIL listing every unmet id, and no expensive verifier is spawned. `/astro-verify` runs the same command first.

**P5. Every gap in one pass (D5, C1).** The engine already records every reported failure in a narrowed run. This phase locks that in with tests and closes the prompt-side gap:
- The verifier contract, `agents/astro-verifier.md` and both workflow verify prompts say: never stop at the first failing criterion. Report EVERY criterion observed unmet. On a stop-early narrowed run, any other criterion you saw fail is reported `failed`, never `carried`.
- `recordVerdict`'s `failing` output is the full set, observed plus carried-failed.

**P6. A broad claim must name changed files the criteria map ties to (D6, C7).** `broadClaim(root, slug, files, g)` in `lib/verdict.mjs` returns `{ ok, reason }`. A claim is supported when:
- `files` is a non-empty array;
- at least one named file is in the diff since the saved verdict's commit (for a narrowed plan) or since the base (for a targeted plan), via `diffSince`;
- and that file `touches` some criterion's `criterionPaths`.

Otherwise the claim is refused, with the reason naming which of the three conditions failed.
- **In `recordVerdict`:** the `result.broad === true ? 'full'` shortcut is replaced. A broad claim (`result.broad` with `result.broad_files`) forces full only when the plan was narrowed or targeted and `broadClaim` holds. A refused claim records under the plan's mode (narrowed, so it cannot pass, or targeted under the targeted rules), with `out.broad_refused = reason`, and the reason text says why. A broad claim on a plan that was already full changes nothing.
- **In planning:** `planReverify(root, slug, { broadFiles })` and `ac verdict plan <phase> --broad-files a,b` answer the same question before the verifier runs: the mode is `full` with reason `broad fix: …`, or the plan is unchanged with `broad_refused`.

**P7. Remediation overlaps the verify (D7, C8).**
- **When:** this applies when `useWorktrees` is on, remediation budget remains (`maxCycles > 0`, cycle < max), the verify plan is `full`, and there are ≥ 4 criterion ids.
- **Groups:** the expensive stage then runs as **two** verifier spawns inside one `parallel()`, splitting the ids in file order into halves:
  - group 1 also does the structural checks (commits, `worktree-*` branches, full suite);
  - group 2 is told to skip them;
  - each group reports only its own ids.
- **Overlap:** inside a group's thunk, when its verifier returns with any failed criterion while the other group is still running, and no remediation has started yet, it spawns `runRemediation(unmetOfThatGroup, cycle)` with `isolation: 'worktree'` and the SYNC FIRST (ADR-040) text. The verifier never runs on that worktree.
- **Combining the groups:** the results are merged:
  - `passed` only if both passed;
  - the criteria concatenated;
  - the mode `full` only if both are full;
  - the coverage guard applied to the union.

  The merged result is then recorded once.
- **Landing the fix:** after the record returns, the loop folds the remediation branch through the existing `integrateWave` with a one-task pseudo-wave `{ id: 'remediate-c<k>' }`. The remediation stamp is `(phase NN remediate-cK)`. Only then does the next round verify.
- **Failures:** an integration failure stops the loop with `stoppedReason: 'integration-failed'` and preserves the branch. A null or failed worktree remediation re-runs on-branch after the verdict and latches the overlap off for the rest of the run (ADR-019), logged with `⚠`.
- **Sequential case:** when `use_worktrees` is off, or the other conditions do not hold, the verifier is a single spawn exactly as today, and remediation is spawned only after the verdict.

**P8. Setup cache (D8, C9).**
- **Declaration:** in `.astrocode/config.json`, under `setup.steps.<name> = { command, commit? }` (default commit `HEAD`), with `setup.max_mb` (default 2048). It is set with `ac config set`. The `mutation.files` precedent applies, and JSON keeps the declaration deterministic (333f).
- **Module:** `lib/setupcache.mjs`.
  - **Key:** `sha256(<resolved full sha> NUL <exact command>)`.
  - **Store:** `.astrocode/.local/setup-cache/<key>/`, holding `entry.json` (`{ version, key, name, command, commit, exit, at, seconds, bytes }`) and `out/`. The store is created via `ensureLocalDir`, so it is gitignored.
  - **Miss:** the step runs in a detached `git worktree` of the resolved commit, placed under `os.tmpdir()` and removed afterwards. The env carries `AC_SETUP_COMMIT`, `AC_SETUP_OUT` (the entry's `out/`) and `AC_PROJECT_ROOT`.
  - **Reuse:** only when `entry.json` exists with exit 0, the same command and commit, and `out/` present. A non-zero exit is never stored.
  - **Eviction:** after a store, under `withLock`, entries are evicted oldest-first by `entry.json.at` (creation time, never refreshed) until the total is ≤ the cap. An entry larger than the cap on its own is not kept, and `⚠` says so.
  - **Unknown names:** an undeclared name refuses with the `ac config set setup.steps.<name>` hint. No declaration at all prints `⊡ no setup steps declared`.
- **CLI:** `ac setup run <name> [--commit <ref>] [--json]` (its exit is the step's exit) and `ac setup list [--json]`.

**P9. History and flapping (D9, C10, C11).**
- **Module:** `lib/verdicthistory.mjs` holds `VERDICTS_FILE = 'VERDICTS.jsonl'`, `appendHistory(file, entry)` and `readHistory(file)`. Both mirror `lib/surprises.mjs`: the append is pure, and a damaged line is counted and skipped, never thrown.
- **The line:** `recordVerdict` appends one line per record, inside its `withLock`, **before** writing VERDICT.json, and commits it with VERDICT.json. The line holds `{ run, at, mode, stage?, passed, commit, criteria_sha, reason, unmet, deferred, criteria: [{id, status}], flapping? }`.
- **Receipt reuse:** `VERDICTS.jsonl` joins `VERIFY_WRITES` in `lib/receipts.mjs`, so an append never dirties the tree for suite receipts.
- **Flapping:** `flappingOf({ history, failedIds, text, root })` checks each id observed failed in this run. It flags the id when the most recent earlier history line had it `passed` (from a non-cheap stage). The flag is `{ id, passed_run, passed_commit, files_changed: true|false|null, criteria_changed? }`:
  - `files_changed` is `touches(criterionPaths(id), diffSince(passed_commit))`;
  - it is `null` when git fails, or when the criterion maps no files (reported as "unknown");
  - `criteria_changed: true` is set when `criteria_sha` differs.
- **The flag changes nothing else:** it goes into `out.flapping` and the history line only. Never into VERDICT.json, status, unmet ids or verifiability.

**P10. The folded debt (C12).**
- When `beforeIds` is empty after a withdrawn PASS, the loop spawns **no** remediation. It runs one forced-full verify instead (`runVerdictPlan` gains a `full` option, which maps to `--full`), and that verify counts against the cycle budget.
- A withdrawn round's `summary` leads with `FAIL — verify PASS withdrawn: <reason>`, and the verifier's own pass text is dropped from the summary. It stays in the log.

## Tasks

Test strategy: **test-first inside each task.** Each task's tests are written first and fail. Then the change makes them pass, in the same commit. Tests in an existing test file reach new symbols only by `await import()` inside async test bodies (ADR-018). No task relies on test-after serialization. Every task commits with the `(phase 54 tK)` stamp.

### t1 — Folded debt: no remediation on zero unmet, and a withdrawn round never reads 'ok' (C12)
- **files:** workflows/execute-phase.mjs, tests/verify_loop.test.mjs
- **depends_on:** []
- Create `tests/verify_loop.test.mjs` with the AsyncFunction stub harness of `tests/execute_blocked_dependency.test.mjs`. The stub returns tasks all `done: true`, so the run goes straight to Verify. It needs these cases:
  - (a) The verifier returns `passed:true` with a carried item, so the coverage guard withdraws the PASS, and the record clerk returns `passed:false, failing:[]`. Assert that no `remediate:` spawn happens, that a second verify spawn follows whose plan clerk was asked for `--full`, and that `result.verdict.summary` matches `/PASS withdrawn/` and is not `'ok'`.
  - (b) A withdrawn PASS from `ac verdict record` with `failing: ['C2']` still remediates C2.
- Implement P10 in `verifyOnce`/the loop, and give `runVerdictPlan` its `full` option.

### t2 — The tag and cheap-line readers: `edgeIds`, `cheapCommands` (P1, P4)
- **files:** lib/impact.mjs, tests/impact.test.mjs
- **depends_on:** []
- Tests via `await import('../lib/impact.mjs')`:
  - `edgeIds` returns only `### C2 [edge] — …` and `### C4 [mutation] [edge] — …`;
  - it ignores `[core]`, untagged headings, `[Edge]`, `edge` in the claim text, `[edge]` on the next line and `[edge]` in the body;
  - `cheapCommands` maps `- **Cheap:** \`node a.mjs\`` to the command, ignores a Cheap line with no backticks, and survives CRLF.
- Implement both next to `suiteIds`, with a comment naming the fail-closed rule (D2).

### t3 — Verdict history module plus the receipt exclude (P9)
- **files:** lib/verdicthistory.mjs, tests/verdicthistory.test.mjs, lib/receipts.mjs, tests/receipts.test.mjs
- **depends_on:** []
- Tests:
  - `appendHistory` keeps earlier lines byte-identical across 3 appends;
  - `readHistory` skips and counts a damaged trailing line;
  - `flappingOf` covers four cases in a real git repo: pass then fail with mapped files unchanged gives `files_changed:false`, with a mapped file changed gives `true`, an id that never passed is not flagged, and an unknown commit gives `null`.
  - In `tests/receipts.test.mjs`, a dirty `phases/<x>/VERDICTS.jsonl` leaves `treeState().clean === true`.
- Implement `lib/verdicthistory.mjs` (imports `lib/impact.mjs` only) and add `VERDICTS.jsonl` to `VERIFY_WRITES`.

### t4 — Fix register: persisted repro, `deferred_from`, `deferredFixes` (P3)
- **files:** lib/fixes.mjs, tests/fixes.test.mjs
- **depends_on:** []
- Tests (dynamic import for `deferredFixes`):
  - `addFix(root, { title, report, deferredFrom })` persists `repro` (redacted, truncated to 4000) and `deferred_from` in fixes.json;
  - a plain `addFix` is unchanged;
  - `deferredFixes` lists open deferred fixes only, filters by `phases`, and drops a fix once `acceptFix` runs.
- Update the module header: a link field instead of milestone membership.

### t5 — Setup cache engine (P8)
- **files:** lib/setupcache.mjs, tests/setupcache.test.mjs
- **depends_on:** []
- Tests in a scratch git repo, with a step that appends to a counter file outside the repo and writes `$AC_SETUP_OUT/x`:
  - two runs at the same commit execute once, and the second reports `reused`;
  - one character changed in the command, or a different commit, executes again;
  - a step exiting 1 is not stored and runs again next time;
  - entries live under `.astrocode/.local/setup-cache/` and `git status --porcelain` is empty;
  - with `setup.max_mb` set low, three entries evict oldest-first, the total stays ≤ the cap, and an over-cap single entry is not kept;
  - an undeclared name refuses with the hint.
- Implement `runSetup`, `listSetup`, `setupKey` and `evictSetup`. Reach `ensureLocalDir` via a dynamic `import('./verdict.mjs')` inside the function, so the module cannot form a load cycle.

### t6 — Record the decisions as ADRs (C14)
- **files:** .astrocode/DECISIONS.md, .astrocode/DECISIONS.in-force.md
- **depends_on:** []
- Run `ac decision add` twice. It claims the numbers, so never pick one by hand.
- **ADR A, deferral (amends ADR-079/ADR-089, what verified means):**
  - at a FAIL a human may defer failed `[edge]` criteria;
  - the tag is fixed at pre-registration, and untagged means core;
  - core and suite criteria are never deferrable, checked in code;
  - each deferral opens a fix pre-filled with the failing command and output;
  - the verdict records `deferred` plus the fix id;
  - the phase verifies when every non-deferred criterion passes;
  - open deferred fixes are listed by `/astro-accept`, `ac phase show`, `ac status` and the band, and block `ac milestone complete`.
  - `--rejected`: automatic deferral, verifier deferral, tags editable after planning.
- **ADR B, verify rounds (amends ADR-079/ADR-089):**
  - the cheap first pass (P4), never a pass on cheap evidence;
  - every observed unmet id is listed (P5);
  - a broad claim needs changed files the map ties to criteria (P6);
  - two-group overlap with worktree remediation folded by the integrator after the verdict (P7);
  - setup cache keyed by commit + command in config (P8);
  - append-only VERDICTS.jsonl with a flapping flag that never changes the verdict (P9).
  - `--rejected`: setup declared in RUN-CONTRACT.md, verifier-judged cheap order, LRU eviction.
- Confirm that both ADRs appear in `DECISIONS.in-force.md`, then commit.

### t7 — Status band row for open deferred fixes (C6)
- **files:** mods/astro-mods/hooks/lib/band.js, tests/mods_phase_band.test.mjs
- **depends_on:** []
- Test: `bandView({ ...STATUS, deferred_fixes: [{ id, phase: '54-x', criterion: 'C2', status: 'open' }] })` has a `DEFERRED` row naming the fix id and `54 C2`, and there is no row when the key is absent or empty.
- Implement it in `bandView`. The input shape is `status.deferred_fixes` from `ac status --json` (t14).

### t8 — recordVerdict appends history and reports flapping; lock in the one-pass listing (P5, P9; C1, C10, C11)
- **files:** lib/verdict.mjs, tests/verdict_history.test.mjs
- **depends_on:** [t3]
- Tests in a scratch project with C1 to C5:
  - a full FAIL with C2 and C4 unmet: `out.failing`, the saved VERDICT.json and the history line all name both;
  - a narrowed re-verify reporting C2 and C3 failed records both;
  - three records (FAIL, FAIL, PASS) leave three history lines, the first two unchanged byte for byte, committed alongside VERDICT.json;
  - the flapping cases, both unchanged and changed;
  - the same result recorded with and without prior history gives identical `status`, `failing` and VERDICT.json `criteria`.
- Implement: append before the VERDICT.json write, inside the lock; add `VERDICTS.jsonl` to the committed files; set `out.flapping`.

### t9 — Deferral in the engine plus `deferCriteria` (P2, P3; C3d, C4, C5, C13)
- **files:** lib/verdict.mjs, lib/defer.mjs, tests/defer.test.mjs
- **depends_on:** [t2, t4, t8]
- Tests in a scratch project. CRITERIA.md has C1, a C2 `[edge]`, a C3 `[core]`, an untagged C4 and a `[suite]` C5. PLAN.md is committed after it. Cases:
  - **The deferrable list:** a FAIL with C2 to C5 unmet carrying `command`/`output`. `out.deferrable` is exactly `['C2']`.
  - **A deferral:** `deferCriteria(root, slug, ['C2'], { by })` opens a fix whose `repro` contains the command and output and whose `deferred_from` is `{ phase, criterion: 'C2', … }`. VERDICT.json shows C2 `deferred` with that `fix_id`.
  - **Refusals:** `['C3']`, `['C4']`, `['C5']` and `['C2','C3']` each throw with a reason, and leave VERDICT.json and fixes.json byte-identical. So does a C2 whose `[edge]` tag was added after PLAN.md's commit.
  - **The verifier cannot defer:** a verifier result with `status:'deferred'` or `fix_id` throws, and no deferral happens.
  - **Verifying with a deferral:** after the defer, a full record with C1, C3, C4 and C5 passed gives `passed:true`, and `verifiedGate` is ok. A second fixture with C4 still unmet is refused.
  - **Hand-written verdicts:** a verdict deferring C3, C4 or C5 is refused by `verifiedGate` (C3d).
  - **Carry-forward:** a later narrowed record keeps C2 `deferred`.
- Implement P2 and P3 in `lib/verdict.mjs` (static import of `findFix` from `lib/fixes.mjs`, which does not import verdict).
- Implement `deferCriteria` in the new `lib/defer.mjs`:
  - validate every id first;
  - then call `addFix` per id, never while holding the lock;
  - then rewrite VERDICT.json under `withLock`, after re-checking that its `run` did not move;
  - commit VERDICT.json and fixes.json as `chore(verdict): phase NN defer C2 → <fix id>`, with no task stamp.

### t10 — The broad claim checked in code (P6; C7)
- **files:** lib/verdict.mjs, tests/verdict_broad.test.mjs
- **depends_on:** [t9]
- Tests: a FAIL on file, a fix commit touching `src/a.mjs` (which C2 names), and a re-verify result `{ mode:'full', broad:true, broad_files }` with each of these:
  - (a) no files;
  - (b) only `README.md`, which is unmapped;
  - (c) a file that is mapped but unchanged;
  - (d) `src/a.mjs`.

  (a) to (c) record `narrowed` with `broad_refused` naming the reason, and cannot pass. (d) records `full`. `planReverify(…, { broadFiles })` agrees on every case. A broad claim on an already-full plan is a no-op.
- Implement `broadClaim` and replace the line-516 shortcut and the line-640 reason.

### t11 — Cheap-stage handling in the engine plus `lib/cheappass.mjs` (P4; C2, C3a)
- **files:** lib/verdict.mjs, lib/cheappass.mjs, tests/cheappass.test.mjs
- **depends_on:** [t2, t10]
- Tests in a scratch project with Cheap lines on C1 to C3 (C2's command exits 1) and a `[suite]` C4 whose command is `node -e "process.exit(0)"`. Cases:
  - `runCheapPass` lists every unmet id (C2, plus C3 when it is also made to fail) and records one narrowed `stage:'cheap'` verdict whose `failing` is exactly those ids, with the others `unobserved`.
  - A clean pass records nothing.
  - The suite check reuses a valid receipt: a stub `spawn` counts zero suite runs after `runSuite` wrote one on the same clean tree.
  - A result `{ mode:'full', stage:'cheap', criteria: all passed }` records not passed, and `verifiedGate` refuses it.
  - A full result where one criterion carries `stage:'cheap'` passed is not passed.
- Implement P4's engine rules in `recordVerdict`, `readVerdict` and `verifiedGate`, and `runCheapPass` in `lib/cheappass.mjs`.

### t12 — Criteria-author contract asks for the tag and the Cheap line; round-trip test (C13)
- **files:** agents/astro-criteria-author.md, tests/criteria_tags.test.mjs
- **depends_on:** [t2]
- Test (`await import('../lib/impact.mjs')`): extract the example block that `agents/astro-criteria-author.md` prescribes for core/edge, and feed it through `edgeIds`. Only the edge example is recognised. A copy with the tag moved into the claim text gives `[]`.
- Edit the contract:
  - tag every criterion `[core]` or `[edge]`, last in the tag run, before any plan exists;
  - edge only for a criterion whose failure does not defeat the goal;
  - never tag a suite criterion edge;
  - optionally add `- **Cheap:** \`<command>\``, its fastest signal, which can only fail a run, never pass one.

### t13 — `ac milestone complete` refuses while a deferred fix of the milestone is open (P3; C6)
- **files:** lib/milestone.mjs, tests/milestone_deferred.test.mjs
- **depends_on:** [t4]
- Tests in a scratch project:
  - with an open fix whose `deferred_from.phase` is a phase of the closing milestone, `completeMilestone` throws naming the fix, and nothing was moved or written: no archive dir, phase dirs in place;
  - spawning `node bin/ac.mjs milestone complete --force` exits non-zero naming the fix;
  - once `acceptFix` runs, the close proceeds;
  - a deferred fix of a phase outside `mine` does not block.
- Implement the check at the top of the `withLock` body, before `mkdirSync`.

### t14 — `statusJson` carries `deferred_fixes` (C6)
- **files:** lib/nextstep.mjs, tests/deferred_status.test.mjs
- **depends_on:** [t4]
- Test: in a scratch project with an open deferred fix, `statusJson(root, now).deferred_fixes` is `[{ id, title, status, phase, criterion }]`, and the key is absent when there are none.
- Implement it via `deferredFixes`.

### t15 — CLI: `ac verdict history` and `ac verdict show`, plus flapping lines on record (C1, C10, C11)
- **files:** bin/ac.mjs, tests/verdict_history_cli.test.mjs
- **depends_on:** [t8]
- Tests by spawning `bin/ac.mjs` in a scratch project:
  - `ac verdict history <p>` lists runs oldest-first, one line each, with run, mode, PASS/FAIL, short commit and unmet ids. `--json` gives the parsed lines.
  - `ac verdict show <p> [--json]` names the latest unmet ids, plus deferred ids and flapping flags when present.
  - `ac verdict record` prints one `⚠ C2 passed in run N @ sha, now fails — files unchanged (inconsistent verifier?)` or `files changed (regression?)` line on stderr per flag.
  - Unknown flags die (ADR-029).
- Add the usage and help lines, and the `checkFlags` entries `'verdict history': ['json']` and `'verdict show': ['json']`.

### t16 — CLI: `ac verdict defer`, the deferrable line, and the deferred surfaces in `phase show`, `status` and `fix list` (C4, C5, C6)
- **files:** bin/ac.mjs, tests/defer_cli.test.mjs
- **depends_on:** [t9, t14, t15]
- Tests in the t9 fixture via the CLI:
  - **The deferrable line:** `ac verdict record` prints `• deferrable: C2 — a human may defer with \`ac verdict defer <n> C2\`` on stderr, and nothing when there is none.
  - **Defers:** `ac verdict defer <n> C2` prints `✓ C2 deferred → fix <id>` and one line saying whether the phase can now verify (the `verifiedGate` reason). `ac fix list` shows the fix with `deferred from <NN> C2`, and `ac fix list --json` carries `repro`.
  - **Refusals:** `defer … C3`, `C4`, `C5` and `--agent x` exit non-zero with the reason, and change nothing. A bare `ac verdict defer <n>` with no ids exits non-zero and never prompts.
  - **Verifying and accepting:** after deferring, a passing record lets `ac phase verify` then `ac phase accept` succeed.
  - **Listing the open fix:** `ac phase show` JSON has `deferred_fixes` for that phase, and `ac status` prints one `Deferred:` line naming each open deferred fix.
- Register the fix with `claimFix`, as `ac fix add` does. Add `checkFlags` `'verdict defer': ['by']`, plus the usage and help lines.

### t17 — Workflow: cheap stage first, every gap listed, broad files, record payload and summary lines (P4–P6, P9; C1, C2, C7)
- **files:** workflows/execute-phase.mjs, tests/verify_loop.test.mjs
- **depends_on:** [t1, t11]
- Tests (the `verify_loop` harness):
  - a `verify:cheap` clerk returning `unmet:[C2,C3]` ends the round FAIL listing both, and **no** `astro-verifier` spawn happens that round;
  - a clean cheap result is followed by the verifier spawn;
  - the cheap clerk prompt names `ac verdict cheap <slug> --json`;
  - the verifier prompt says to report every unmet criterion and never stop at the first;
  - the narrowed and targeted prompts tell the verifier to check a broad claim with `ac verdict plan <slug> --broad-files … --json` before running full, and to return `broad_files`;
  - the record payload carries `broad_files` and the per-failed-criterion `command`/`output` (truncated to 1500 chars);
  - the record's `deferrable`, `flapping` and `broad_refused` each add one summary line.
- Implement: add `CHEAP_SCHEMA` and the `runCheapStage` clerk, called at the top of `verifyOnce`. Cheap unmet ids feed `lastSeen` and `evidence`, but cheap passes never set `lastSeen` true. Extend `VERDICT_RECORD_SCHEMA`.

### t18 — Workflow: remediation overlaps the verify in a worktree; the integrator lands it after the verdict (P7; C8)
- **files:** workflows/execute-phase.mjs, tests/verify_overlap.test.mjs, agents/astro-executor.md
- **depends_on:** [t17]
- Tests, with stubs recording spawn order, label, isolation and resolution timing. The two verifier groups resolve at different ticks. With `useWorktrees` on:
  - `remediate:` spawns with `isolation:'worktree'` before the slower group resolves;
  - neither verifier spawn has worktree isolation;
  - the `integrate:` spawn for the remediation branch comes after `verdict:record`, and the next verify comes after the integration.
- With `useWorktrees:false`: a single verifier spawn, and `remediate:` only after `verdict:record`, with no isolation.
- When the worktree remediation returns null, remediation re-runs on-branch after the verdict, and the next round uses no groups.
- An integration failure sets `stoppedReason:'integration-failed'`.
- Edit `agents/astro-executor.md`: during an overlapped verify the executor works on its own worktree branch, syncs first, makes one stamped commit, and never runs `ac verdict`/`ac state`/`ac phase` writes.

### t19 — CLI: `ac verdict plan --broad-files`, the broad refusal line on record, and `ac verdict cheap` (C2, C7, C14)
- **files:** bin/ac.mjs, tests/verdict_cheap_cli.test.mjs
- **depends_on:** [t11, t16]
- Tests via the CLI in scratch projects:
  - `ac verdict plan <p> --broad-files src/a.mjs --json` returns `full` for a supported claim and narrowed with `broad_refused` otherwise, and the text form prints the reason;
  - `ac verdict record` with a refused claim prints `⚠ broad claim refused: <reason> — recorded narrowed`;
  - `ac verdict cheap <p>` exits 1 listing every unmet id on a failing fixture, exits 0 when clean, and prints `⊡ …` when nothing is declared; `--json` matches the `runCheapPass` shape;
  - `--broad-files` with no value dies.
- Add the `checkFlags` entries `'verdict plan': ['full','json','broad-files']` and `'verdict cheap': ['json']`, plus the usage and help lines.

### t20 — CLI: `ac setup run` and `ac setup list` (C9, C14)
- **files:** bin/ac.mjs, tests/setup_cli.test.mjs
- **depends_on:** [t5, t19]
- Tests: after `ac config set setup.steps.build '{"command":"…"}'`, `ac setup run build` twice reports `• ran` and then `✓ reused`, with the counter at 1. `--commit HEAD~1` runs again. `ac setup list --json` lists the steps and entries. An undeclared name exits non-zero with the hint. A typo'd flag dies.
- Add the `checkFlags` entries `'setup run': ['commit','json']` and `'setup list': ['json']`, plus the usage and help lines.

### t21 — Verifier contract and agent text: cheap pass, every gap, broad files, failing evidence, setup cache, never defer (C1, C2, C4)
- **files:** commands/astro-verify.md, agents/astro-verifier.md, tests/verify_contract.test.mjs
- **depends_on:** [t19, t20]
- Test (new file): `verifierContract()` (dynamic import), `agents/astro-verifier.md` and `astro-verify.md` say each of these:
  - report every unmet criterion observed, never stop at the first;
  - give the failing command and output for each failed criterion;
  - `broad_files`, checked with `ac verdict plan --broad-files`;
  - a verifier never defers;
  - use `ac setup run` for declared setup;
  - `astro-verify.md` runs `ac verdict cheap <n>` before spawning the verifier, and stops with a FAIL on unmet.
- Add `astro-verify.md` report slots that state their bound:
  - deferrable ids in one line, or nothing when none, with the `ac verdict defer` form shown for a human to type;
  - flapping in one line per flagged id, or nothing.
- Keep the contract a single marked block. Run `tests/verifyrun.test.mjs`, `tests/calibrate_e2e.test.mjs` and `tests/commands.test.mjs` green.

### t22 — Accept, status and execute commands present open deferred fixes and deferrable ids (C6)
- **files:** commands/astro-accept.md, commands/astro-status.md, commands/astro-execute.md, tests/deferred_commands.test.mjs
- **depends_on:** [t16]
- Test: each command names `deferred_fixes`/`Deferred:` from `ac phase show`/`ac status`. `astro-execute.md`'s FAIL report names the deferrable line, and states that only the human may run `ac verdict defer`. `tests/commands.test.mjs` passes, meaning every new slot states a bound.
- The edits:
  - `/astro-accept` lists each open deferred fix in one line (id plus criterion) before the UAT question, and says nothing when there are none;
  - `/astro-status` gets the same slot;
  - `/astro-execute` gets a one-line deferrable slot on a FAIL.

### t23 — MANUAL and CHANGELOG, a docs-vs-dispatcher test, and the final suite gate (C14, C15)
- **files:** MANUAL.md, CHANGELOG.md, tests/verify_speed_docs.test.mjs
- **depends_on:** [t6, t7, t12, t13, t18, t20, t21, t22]
- Test: every `ac verdict defer|history|show|cheap`, `ac verdict plan --broad-files` and `ac setup run|list` invocation quoted in MANUAL.md and CHANGELOG.md runs in a scratch project without `unknown command`/`usage:`/unknown-flag errors (spawn `bin/ac.mjs`).
- **MANUAL:** document the following, citing the new ADR numbers from t6, and pointing at `lib/` for thresholds rather than restating them:
  - the `[core]`/`[edge]` tags and the `Cheap:` line;
  - deferral and what it blocks;
  - the cheap first pass;
  - the broad-claim rule;
  - the overlap;
  - the setup declaration (`ac config set setup.steps.<name> …`, `setup.max_mb`);
  - history and flapping.
- **CHANGELOG:** an Unreleased entry.
- Finish with `node scripts/test.mjs` exiting 0 on a clean tree, and fix any straggler only inside this task's files.

## Wave shape
- W1: t1, t2, t3, t4, t5, t6, t7
- W2: t8, t12, t13, t14
- W3: t9, t15
- W4: t10, t16
- W5: t11, t22
- W6: t17, t19
- W7: t18, t20
- W8: t21
- W9: t23

Same-file chains:
- `lib/verdict.mjs`: t8 → t9 → t10 → t11
- `bin/ac.mjs`: t15 → t16 → t19 → t20
- `workflows/execute-phase.mjs`: t1 → t17 → t18
- `tests/verify_loop.test.mjs`: t1 → t17

No two tasks with overlapping files share a wave.
