# Plan — phase 45: targeted re-verify after a FAIL (GitHub #129)

This plan follows:
- `.astrocode/CONVENTIONS.md`:
  - zero dependencies, `node:` builtins only (`node:crypto` `createHash` for the fingerprint);
  - named exports only, `lib/` modules are single lowercase words, `die()` for fatal CLI errors,
    `✓ • ⚠` glyphs, machine output through `json()`;
  - workflow style is no semicolons, and args stay small JSON scalars;
  - `node:test` with real `mkdtempSync` and real git, no mocks;
  - dense comments that say why.
- `.astrocode/DECISIONS.in-force.md`:
  - ADR-079 is the decision this phase builds. It amends ADR-031 by reference: ADR-031's text
    stays, and any PASS still needs full coverage.
  - ADR-021: the verifier stays plan-blind, with no change to what it may read.
  - ADR-022: the loop and its cycle budgets are unchanged.
  - ADR-005 and ADR-008: the workflow script runs no git or `ac` itself; an agent does.
  - ADR-017: commit stamps.
  - ADR-018: RED tests reach new symbols only through `await import`.
  - ADR-020: every wave boundary is green.
  - ADR-029: every new flag goes in the `checkFlags` table.
  - ADR-071: canon-guard.
- This phase's `CONTEXT.md`, decisions 1–6 and the planner defaults. The plan aims at
  `CRITERIA.md` C1–C10.

Principles brief (`--stage plan --by planner`), applied and cited:
- **ce7b (enforce in code):** three guards sit in code, not prose:
  - `ac verdict record` derives `passed` itself;
  - `ac phase verify` refuses a phase without a full, all-passed verdict;
  - the workflow cross-checks coverage before it trusts `verdict.passed`.
- **9173 (one place per rule):** the thresholds, the fingerprint and the mode decision live only
  in `lib/verdict.mjs`. The workflow and `/astro-verify` both ask `ac verdict plan`; neither
  restates them.
- **333f (deterministic tooling):** the hash, the ancestry and the count are code. Only "is this
  fix broad?" goes to the verifier.
- **b940 and 6105 (fail soft):** an absent, unreadable or malformed `VERDICT.json`, or a
  clerk agent that returns nothing, gives a full run and one visible reason line. It never
  crashes.
- **2310 (a slash surface):** `/astro-verify <n> --full`.

## Design decisions made here

- **D1 — Where the rules live.**
  - New module `lib/verdict.mjs` holds:
    - the `VERDICT.json` schema;
    - the fingerprint;
    - the criterion-id parser;
    - the mode decision and the thresholds;
    - the record derivation;
    - the `verified` gate.
  - New top-level CLI verb `ac verdict plan|record <phase>`.
  - The workflow cannot import `lib/` or run git, so it asks a mechanical **verdict clerk**
    agent to run the verb and hand back the JSON. The clerk is an `astro-executor` with
    `models.executor`, exactly like the existing stamp audit. It is not a verifier spawn, so the
    verifier count in C6 is unaffected.
- **D2 — Thresholds (stated once, in `lib/verdict.mjs`).** Narrowing is allowed only when
  `unmet <= 3` **and** `unmet * 3 <= total`. The comparison is strict and uses integer maths. So
  the run goes full when more than 3 are unmet, or more than a third. Worked cases:

  | unmet of total | result | why |
  |---|---|---|
  | 4 of 20 | full | more than 3 |
  | 3 of 20 | narrow | |
  | 2 of 5 | full | 6 > 5 |
  | 2 of 6 | narrow | |
  | 3 of 9 | narrow | |

  Everything else references the rule ("the thresholds in `lib/verdict.mjs`") and never
  restates the numbers.
- **D3 — Fingerprint.** `criteriaHash(text)` is `'sha256:' + sha256(raw bytes of CRITERIA.md)`.
  Raw bytes are deterministic, and any one-character edit changes the hash (C1). A CRLF
  rewrite also changes it, which costs one extra full run. That is the safe direction.
- **D4 — `VERDICT.json` shape.**
  ```json
  { "version": 1, "run": 2, "mode": "full|narrowed", "broad": false,
    "commit": "<sha HEAD at record time>", "criteria_sha": "sha256:…", "at": "<ISO>",
    "criteria": [ { "id": "C1", "status": "passed|failed|carried",
                    "last": "passed|failed",                 // carried only: last-seen outcome
                    "from": { "run": 1, "commit": "<sha>" }  // carried only: the verdict it rests on
    } ] }
  ```
  - The file sits beside CRITERIA.md, and there is one per phase: the latest.
  - `run` is the previous value plus 1, or 1 when there is none.
  - A carried entry whose source entry was itself carried keeps the ORIGINAL `from` and `last`.
  - `readVerdict(file)` is total. A missing file, bad JSON, a `version` other than 1, or a wrong
    shape returns `{ verdict: null, reason }` and never throws.
- **D5 — Record derivation (the C4 code guard).**
  - Input is `--result '<json>'`, shaped `{ mode, broad?, criteria: [{ id, passed }] }`. Ids come
    from the CRITERIA.md headings (`/^#{1,6}\s*(C\d+)\b/gm`, unique, in file order).
  - `broad: true` forces `mode` to `full`.
  - In a full run, each CRITERIA id the run reported becomes `passed` or `failed`. An id the run
    did not report becomes `failed`: absence of evidence is failure (ADR-021).
  - In a narrowed run, reported ids become `passed` or `failed`. An id the run did not report is
    `carried`, taking `from` and `last` from the prior valid verdict. When there is no prior
    verdict, an unreported id becomes `failed` instead.
  - Reported ids that are not in CRITERIA.md are ignored, and a ⚠ count of them is printed.
  - `passed` is derived and never trusted: `mode === 'full' && every CRITERIA id has status 'passed'`.
  - `failing` is the `failed` ids plus the `carried` ids whose `last` is `failed`.
  - `record` refuses with `die` in two cases:
    - CRITERIA.md is absent or has no `C<n>` ids, because a self-derived bar is not narrowable;
    - the input is malformed.
- **D6 — Commit mechanics (the main trap).**
  - `ac verdict record` reads `commit = git rev-parse HEAD` **before** it writes, so the commit
    it records is the graded commit.
  - It then writes atomically under `withLock` and commits ONLY that file: `git add <file>` then
    `git commit -m "chore(verdict): phase <NN> run <R> — <mode> <PASS|FAIL>" -- <file>`.
  - The message never contains a `(phase NN tK)` stamp, so the ADR-041 completeness audit is
    unaffected.
  - If the commit fails (no repo, a hook refuses, a detached state), the result has
    `committed: false` and `commitError`. The file stays written, which fails soft.
  - The next run's ancestry check still holds, because the verdict commit is a descendant of the
    graded commit.
  - The `verified` gate therefore does NOT require `commit === HEAD`. It requires two things:
    - `commit` is an ancestor of HEAD;
    - `git diff --name-only <commit> HEAD -- . ':(exclude).astrocode'` is empty.

    That means no code changed since the graded commit, and only `.astrocode/` metadata (such as
    the verdict commit itself) moved HEAD.
- **D7 — Mode decision (`chooseMode`, pure; `planReverify` gathers its inputs).** Rules run
  in order, cheapest first, and the first that fires decides:
  1. `--full`;
  2. CRITERIA.md absent or has no ids;
  3. no saved verdict, or an unreadable one (the reason comes from `readVerdict`);
  4. `criteria_sha` mismatch;
  5. the saved verdict has no failing id (the last run passed);
  6. a failing id that is no longer in CRITERIA.md;
  7. the saved `commit` is not an ancestor of HEAD (`git merge-base --is-ancestor`; any
     non-zero status, including an unknown sha, counts as not an ancestor);
  8. the thresholds.

  If none fires, the mode is `narrowed` with `first` = the saved `failing` ids in CRITERIA
  order. Plan output, used by both paths:
  ```json
  { "mode": "full|narrowed", "reason": "…", "first": ["C3","C7"], "ids": ["C1",…], "total": 9,
    "saved": { "run": 1, "commit": "<sha>", "mode": "full" } | null,
    "range": "<sha>..HEAD" | null }
  ```
  - `saved` and `range` are filled whenever a valid verdict exists, even in full mode.
  - `ids` is always CRITERIA.md's ids, and is `[]` when CRITERIA.md is absent.
- **D8 — The `verified` gate (`verifiedGate(root, slug)` → `{ ok, reason }`).**
  - The gate only applies when the phase folder's CRITERIA.md has at least one `C<n>` id. A
    self-derived bar (the `/astro-fast` lane, legacy phases without CRITERIA.md, the fleet test
    projects) has no stable ids, so it passes the gate unchanged.
  - Otherwise it requires all of:
    - a valid verdict;
    - `mode === 'full'`;
    - every current id `passed`, none carried, none missing;
    - `criteria_sha` current;
    - the graded-commit check from D6.
  - `ac phase verify <phase>` dies with the reason and the fix (`run /astro-verify <n>`), or
    proceeds when given `--force`, mirroring `phase accept`.
- **D9 — Workflow shape (`workflows/execute-phase.mjs`).**
  - **The sequence around every verify** (the first pass and each re-verify) is: plan clerk →
    `runVerify(plan, focusIds)` → record clerk.
  - **The first pass also consults the saved verdict.** A re-execute after a FAIL is itself a
    re-verify after a FAIL, which is decision 4.
  - **Arg:** `full: true` passes `--full` to the plan clerk.
  - **`VERIFY_SCHEMA` gains three fields, all optional, so existing stubs still load:**
    - top-level `mode` (`full|narrowed`);
    - top-level `broad` (boolean);
    - a per-item `status` (`passed|failed|carried`).

    `additionalProperties: false` stays at every level.
  - **The narrowed preamble.** It is used only when `plan.mode === 'narrowed'`. In the loop it
    is used only when `plan.first` equals the in-memory failing set; otherwise the run degrades
    to full, with a logged reason. The preamble:
    - names the `first` ids, the saved run and commit, and the range;
    - says to check ALL of the first ids before stopping;
    - on any still-unmet id: FAIL with `mode: 'narrowed'`, and every other id `carried`;
    - when all now pass: continue in the SAME run over EVERY other criterion, with
      `mode: 'full'`;
    - says to inspect `git diff <range>` first: a broad fix (one touching what many criteria
      rest on) means a full run from the start, with `broad: true`;
    - says a carried criterion is never reported as passed or re-checked.
  - **Full mode keeps today's ADR-031 behaviour.** In-loop it uses the focus preamble; on the
    first pass with no saved verdict it adds no preamble at all.
  - **Code-side coverage guard.** `verdict.passed` is reset to false unless all of these hold:
    - the verifier said `passed: true`;
    - `mode !== 'narrowed'`;
    - no item is `carried`;
    - every id in the known id set has an item with `passed: true` and status other than
      `carried`.

    The known id set is `plan.ids` when the plan clerk supplied it; otherwise it is every id
    seen so far in this run.
  - **The record clerk's verdict wins in the safe direction.** When it returns
    `recorded: true`, its derived `passed: false` forces `verdict.passed = false`.
  - **No-progress uses a `lastSeen` map** from id to passed, updated only from items actually
    checked (status other than `carried`). `beforeIds` and `afterIds` are the failing ids in
    `lastSeen`. So carried criteria count as last seen, and the existing
    `afterIds.size >= beforeIds.size` bail is kept verbatim.
  - **A narrowed FAIL** appends one summary line: `carried, not re-checked: <n> criteria
    (run <R> @ <sha7>)`.
  - **A clerk that returns nothing or a malformed result** gives a full plan or an unrecorded
    verdict. It logs one `⚠` line saying why, and it never throws.

## Test strategy (ADR-018)

Every behaviour task is **test-first inside the task**. The tests are written before the
implementation and land in the same stamped commit. No task is a separate RED task, so the
static-import trap cannot arise. Even so:
- t1's new test file reaches `lib/verdict.mjs` through `await import` in async test bodies;
- t3's tests drive the CLI through `spawnSync`.

There is no test-after serialization, except t5. It depends on t3 and t4 because its doc
guards reference verbs and workflow text that must already exist: `tests/contracts.test.mjs`
fails a command that names an `ac` verb the CLI lacks.

## Tasks

### t1 — `lib/verdict.mjs`: schema, fingerprint, mode decision, record derivation, verified gate
- **id:** t1
- **file:** `lib/verdict.mjs` (new), `tests/verdict.test.mjs` (new), `lib/util.mjs`, `lib/surprises.mjs`
- **depends_on:** []
- **Move `assertSafeSlug`** from `lib/surprises.mjs` (private) to a named export in
  `lib/util.mjs`, and have `surprises.mjs` import it. This is one atomic move, so the build stays
  green, and it keeps the slug rule in one place (9173). `tests/surprises*` must still pass.
- **Test first**, in `tests/verdict.test.mjs`, using real `mkdtempSync` plus `git init`, a
  `.astrocode/phases/<slug>/CRITERIA.md` with N `### C<n> — …` headings, and plain-git commits.
  Reach the module with `await import('../lib/verdict.mjs')`. Name the tests as spec sentences.
  Cover:
  - **`parseCriteriaIds`:** order, uniqueness, and that non-heading `C3` mentions are ignored.
  - **`criteriaHash`:** stable across two reads; a one-character edit changes it; `sha256:`
    prefix.
  - **`readVerdict` is total:** missing file, `{bad json`, `version: 2`, and `criteria` that is
    not an array each return `verdict: null` with a reason, and none throws.
  - **`recordVerdict` round trip** (C1). After recording, in the phase folder:
    - the file holds `version`, `run`, `mode`, `commit` (equal to HEAD read before the write),
      `criteria_sha`, `at`, and per-id statuses for all ids;
    - `git check-ignore` exits 1 for it;
    - `git log -1 --format=%s` is the verdict commit, and `git status --porcelain` is clean for
      it;
    - the recorded `commit` is the parent of the verdict commit.
  - **Record derivation (D5).**
    - A full run with an unreported id records it `failed`.
    - A narrowed run carries the unreported ids, with `from` set to the prior run and commit,
      and `last` taken from the prior status.
    - A carried-of-carried entry keeps the original `from`.
    - `broad: true` with `mode: 'narrowed'` records `mode: 'full'`.
    - `passed` is false for every narrowed run, even when every reported id passed. This is the
      C10 mutation target.
    - `failing` includes a carried entry whose `last` is `failed`.
    - CRITERIA.md absent rejects.
  - **`chooseMode`, pure, one test per rule in D7 plus the control.**
    - The control: 9 ids, a saved full FAIL of {C3, C7}, an ancestor commit, and the same hash
      gives `narrowed` with `first` equal to `['C3','C7']`.
    - Each fallback flips the mode to `full` with a distinct reason:
      - (a) no verdict;
      - (b) 4 of 20 unmet;
      - (c) 2 of 5 unmet;
      - (d) the hash differs;
      - (e) not an ancestor;
      - (f) `full: true`.
    - Both sides of each threshold are tested (3 of 20 and 2 of 6 narrow).
  - **`planReverify` with real git** (C3e).
    - A branch made from A's parent plus a new commit gives `full`.
    - A verdict whose `commit` is `0000…` (unreachable) gives `full`.
    - The control narrows: commit B on top of A, CRITERIA untouched.
    - A malformed VERDICT.json gives `full` with a reason, without throwing.
  - **`verifiedGate`.**
    - `ok` holds for a full all-passed verdict whose graded commit is followed only by the
      verdict commit.
    - It refuses each of these:
      - a narrowed verdict;
      - a carried id;
      - a failed id;
      - a missing id;
      - a stale hash;
      - a later commit touching a file outside `.astrocode/`;
      - no verdict while CRITERIA has ids.
    - `ok` holds when CRITERIA.md is absent.
- **Implement** `lib/verdict.mjs`:
  - named exports `VERDICT_FILE = 'VERDICT.json'`, `parseCriteriaIds`, `criteriaHash`,
    `readVerdict`, `chooseMode`, `planReverify(root, slug, { full })`,
    `recordVerdict(root, slug, result)` (async, `withLock` plus `atomicWriteJSON`, then the
    path-limited commit from D6), and `verifiedGate(root, slug)`;
  - the threshold constants, declared once with a why-comment;
  - reuse of `git` and `gitOk` from `lib/git.mjs`, `paths(root).phases`, and `assertSafeSlug`
    from `lib/util.mjs`;
  - a module header explaining ADR-079 and the commit-ordering trap (D6).
- **Commit:** `feat(verdict): saved verdicts, narrowing decision and verified gate (phase 45 t1)`.

### t2 — canon-guard protects `VERDICT.json` in every phase folder
- **id:** t2
- **file:** `hooks/astro-canon-guard.mjs`, `tests/canon_guard.test.mjs`
- **depends_on:** []
- **Test first** in `tests/canon_guard.test.mjs`, using the existing sandbox and stdin-payload
  harness:
  - `Write` and `Edit` to `.astrocode/phases/<slug>/VERDICT.json` are denied, and the reason
    names `ac verdict record`. Same for the archived layout
    `.astrocode/milestones/3/phases/<slug>/VERDICT.json`.
  - `Bash` `echo {} > .astrocode/phases/<slug>/VERDICT.json` is denied.
  - `Bash` `ac verdict record <n> --result '{}'` is allowed.
  - `Write` to `.astrocode/phases/<slug>/notes.md`, `CRITERIA.md` and `PLAN.md` is not denied.
  - `VERDICT.json` directly under `.astrocode/` is not denied, and neither is `src/VERDICT.json`.
  - The exports test (~L536) gains a check that exactly one `phaseFile` entry exists, with
    `verb`, `rule` and `source`. `PROTECTED_NAMES` stays the `name`-entry list.
- **Implement:**
  - Add a `PROTECTED` entry `{ phaseFile: 'VERDICT.json', verb: 'ac verdict record <phase> --result …', rule: HAND_EDIT_RULE, source: 'ADR-079' }`.
  - `judge()` gains a match: the basename case-insensitively equals `phaseFile`, the grandparent
    is named `phases`, and either the great-grandparent is `.astrocode`, or the
    great-grandparent's parent is `milestones` under `.astrocode`. `display` becomes
    `.astrocode/phases/<slug>/VERDICT.json`.
  - Keep realpath handling and the merge-conflict escape unchanged.
  - Update the header comment's "Paths" paragraph, saying why the phase-file rule needs the
    grandparent.
- **Commit:** `feat(canon-guard): protect phase VERDICT.json (phase 45 t2)`.

### t3 — CLI: `ac verdict plan|record`, `ac phase verify` gate, flags, help
- **id:** t3
- **file:** `bin/ac.mjs`, `tests/verdict_cli.test.mjs` (new), `tests/flags.test.mjs`
- **depends_on:** [t1]
- **Test first**, in `tests/verdict_cli.test.mjs`. Use a real tmp project (`git init`, `ac init`,
  `ac phase add`, a CRITERIA.md written into the phase folder, plain-git commits) and
  `spawnSync(process.execPath, [AC, …])`. Cover:
  - **C1:** `ac verdict record 1 --result '{"mode":"full","criteria":[…C2,C5 failed…]}'` prints
    JSON with `recorded: true`, `run: 1`, `passed: false`, `failing: ["C2","C5"]` and
    `committed: true`. The file is committed and not ignored. Recording again after a
    one-character CRITERIA edit changes `criteria_sha`; recording again with no edit keeps it.
  - **C2:** `ac verdict plan 1 --json` after commit B gives `mode: "narrowed"`,
    `first: ["C3","C7"]`, `saved.run`, `saved.commit` equal to A, and `range`.
  - **C3:**
    - (a) through (e), one variant each, gives `mode: "full"`;
    - (f) `--full` gives `full`;
    - a typo'd `--fulll` exits non-zero with `unknown flag`;
    - a garbage VERDICT.json gives `full` with exit 0.
  - **Plan without `--json`:** prints one line, e.g. `• narrowed: re-check C3, C7 first (run 1 @ <sha7>)`
    or `• full: <reason>`.
  - **C4(3):** `ac phase verify 1` exits non-zero when the latest verdict:
    - is narrowed;
    - has a failed id;
    - has a carried id;
    - is missing.

    `ac phase show 1` status then stays not `verified`. A full all-passed verdict lets it
    through, after the verdict commit too. `--force` lets it through. A phase without
    CRITERIA.md still verifies with no verdict.
  - **Record input:** `ac verdict record` with no CRITERIA.md, or with malformed `--result`,
    exits non-zero and writes nothing.
- **Implement in `bin/ac.mjs`:**
  - `case 'verdict':` with subs `plan` (`--full`, `--json`) and `record` (`--result`). Both
    resolve `<phase>` through `findPhase` and delegate to `lib/verdict.mjs`.
    - `record` prints the JSON result through `json()`.
    - `plan` prints JSON with `--json`, else the one line.
    - The usage `die`s list the verbs.
  - `ALLOWED_FLAGS`:
    - `'verdict plan': ['full', 'json']`;
    - `'verdict record': ['result']`;
    - `'phase verify': ['force']`;
    - each with a one-line why-comment.
  - In `phase verify`: call `checkFlags`, then `verifiedGate`. On a refusal without `--force`,
    `die` with `phase <n>: <reason> — run /astro-verify <n> (or pass --force)`.
  - Help text:
    - `ac verdict plan <phase> [--full] [--json]`, described as "should the next verify narrow?
      (ADR-079)";
    - `ac verdict record <phase> --result '<json>'`, described as "save + commit a verify
      verdict";
    - `ac phase verify` gains `[--force]`.
  - In `tests/flags.test.mjs`, add one ADR-029 typo test for `ac verdict plan --fulll`, following
    the file's existing shape.
- Run `node --test tests/fleet.test.mjs tests/contracts.test.mjs tests/flags.test.mjs` as well:
  `phase verify` without CRITERIA.md must stay unchanged.
- **Commit:** `feat(cli): ac verdict plan|record and a verified gate on ac phase verify (phase 45 t3)`.

### t4 — Workflow: narrowed re-verify, verdict clerk, coverage guard, last-seen no-progress
- **id:** t4
- **file:** `workflows/execute-phase.mjs`, `tests/workflows.test.mjs`, `tests/verify.test.mjs`
- **depends_on:** []
- The CLI contract is pinned in D7 and D5, so this task does not need t3 on the branch. The
  clerk only relays `ac` output.
- **Test first**, in `tests/workflows.test.mjs`:
  - **Extend `runWorkflow`** with options, keeping every existing caller's default behaviour.
    The dispatch for the new options goes BEFORE the generic `'passed' in props` fallback.
    - `verify`: a function `(prompt, n) => verdict`, or a queue array; the default is today's
      constant.
    - `plan`: a function or object answering the plan-clerk schema (fingerprint prop `first`).
    - `record`: answers the record-clerk schema (fingerprint prop `recorded`).
    - `remediate`: answers `REMEDIATE_SCHEMA` (prop `headBefore`), and defaults to moving heads.
  - **Add a counter helper** `verifierCalls(calls)`: calls with `agentType === 'astro-verifier'`.
  - **New behaviour tests:**
    - **C2:** a first pass FAILs {C3, C7}, the plan returns narrowed {C3, C7} with run 1 and
      commit `aaa1111`, and `effort: 'standard'`. The re-verify prompt names C3 and C7 as first,
      `aaa1111`, run 1, and `aaa1111..HEAD`.
    - **C3f:** `args.full: true` puts `--full` in the plan-clerk prompt.
    - **C3f:** a plan returning `full` (any reason) gives no narrowed preamble.
    - **C3f:** a plan-clerk return of `{}` logs a `⚠` and runs full.
    - **C4(1):** a re-verify stub returns `passed: true` with C3 passed and the others `carried`.
      The result is `verdict.passed === false` and `stoppedReason` is not `passed`. The same
      holds when the others are simply absent and the plan supplied `ids`.
    - **C4(2) and C6:**
      - The stub re-checks C4 and returns every id passed with `mode: 'full'`. The result is
        passed, with exactly 2 verifier spawns for the phase.
      - The record-clerk prompt carries `"mode":"full"` and all ids.
      - In a variant, C6 newly fails. The result is FAIL, C6 is in the failing set (not
        carried), and the run is not passed.
    - **C5:** the prior FAIL is {C2, C5, C8} and the stub returns C2 failed, C5 and C8 passed,
      the rest carried, `mode: 'narrowed'`.
      - The record prompt carries all three checked ids and none of the carried ones.
      - `verdict.summary` contains the carried line with the run and sha.
      - The captured narrowed prompt says to check ALL previously unmet criteria before
        stopping.
    - **C7**, run with `effort: 'deep'`:
      - Scenario 1: cycle 0 FAILs {C2, C5} and the narrowed re-verify finds both unmet. The run
        ends `stoppedReason: 'no-progress'` after exactly 1 remediation.
      - Scenario 2: the re-verify finds only C5. A 2nd remediation runs.
      - Scenario 3: the narrowed re-verify omits C5 entirely. The failing set stays {C2, C5}, so
        it is not treated as fixed, and the run bails.
    - **C8:**
      - The narrowed prompt contains the range and an explicit broad-fix instruction.
      - A stub returning `broad: true, mode: 'full'` with all ids sends a record prompt with
        `"mode":"full"`.
      - A stub returning `broad: true, mode: 'narrowed'` is not passed.
    - **Record-clerk wins in the safe direction:** a stub record `{recorded: true, passed: false}`
      overrides a verifier PASS.
  - **Update existing tests (do not delete):**
    - Rename `'ADR-031: re-verify redirects depth but never narrows coverage'` to `'ADR-031/079:
      a re-verify narrows only its first check; a PASS still needs every criterion'`. Widen its
      `runVerify` window as needed. Keep its three assertions (focus, EVERY criterion plus
      regression wording, never carry forward a previous PASS on trust), and add assertions for
      the narrowed preamble's `check ALL`, `carried`, and `continue … EVERY other criterion`.
    - `'a clean first-pass verify is unchanged (no focus preamble)'` stays green: there is no
      saved verdict, so the plan is full.
    - Update the t5 (phase 10) static guards (~L2295–2345) only where the call shape changed: the
      first-call literal `verdict = await runVerify()`, and the 2200-char loop window. They must
      still assert that HEAD-moved precedes the re-verify, both no-progress bails, and
      `afterIds.size >= beforeIds.size`.
    - In `tests/verify.test.mjs`, widen the Verify-section window (`vi + 7200`) if the longer
      prompt pushes the asserted text out. Change no assertion.
- **Implement** D9 in `workflows/execute-phase.mjs`:
  - `const fullRun = input.full === true`, beside `effort`, with a comment.
  - The `VERIFY_SCHEMA` additions.
  - `VERDICT_PLAN_SCHEMA` and `VERDICT_RECORD_SCHEMA` (`additionalProperties: false`).
  - `runVerdictPlan()` and `runVerdictRecord(verdict)`, using `label: 'verdict:plan' |
    'verdict:record'`, `phase: 'Verify'`, `agentType: 'astro-executor'`, `models.executor`.
    - The prompts say it is purely mechanical: run exactly the one `ac verdict …` command in
      `${root}` and return its fields verbatim; do not fix, judge or edit anything.
    - The record result JSON is built in the script, compact, from ids and booleans only: no
      command output, so the clerk can quote it safely.
    - Record is skipped when `criteriaFound` is false.
  - `runVerify(plan, focusIds)` with the narrowed preamble. Update the ADR-031 comment block to
    say "amended by ADR-079", and say why the passing run is still total.
  - The `lastSeen` failing set and the coverage guard.
  - The narrowed-FAIL summary line.
  - One-line logs: `• verify plan: narrowed — re-check C3, C7 first` / `• verify plan: full —
    <reason>`, and `• verdict run <R> saved (<mode>)` / `⚠ verdict not saved — <why>`.
  - Run `node --test tests/workflows.test.mjs tests/verify.test.mjs tests/local_model.test.mjs
    tests/execute_blocked_dependency.test.mjs tests/contracts.test.mjs`. The last three run the
    workflow with their own stubs and must stay green unedited. The clerk degrades to full or
    unrecorded under them.
- **Commit:** `feat(execute): narrowed re-verify after a FAIL, full-coverage guard (phase 45 t4)`.

### t5 — Hand-run `/astro-verify`, the verifier's narrowed mode, execute docs, MANUAL, and the full gate
- **id:** t5
- **file:** `commands/astro-verify.md`, `agents/astro-verifier.md`, `commands/astro-execute.md`,
  `tests/commands.test.mjs`, `tests/verify.test.mjs`, `MANUAL.md`
- **depends_on:** [t2, t3, t4]
- **Test first:**
  - **`tests/commands.test.mjs`:**
    - `astro-verify.md` has `--full` in its `argument-hint`.
    - It runs `ac verdict plan` before spawning the verifier and `ac verdict record` before
      `ac phase verify`, in that order.
    - It says a narrowed FAIL reports one line per still-unmet criterion plus ONE count line for
      carried criteria, citing the run and commit.
    - It says a narrowed re-verify is ONE verifier invocation that continues to full coverage.
    - `astro-execute.md` passes `full` to the Workflow args when the user passed `--full`, and
      its non-Workflow tiers record verdicts too.
    - Keep the slot table (~L666) markers valid. If step 3's wording moves, update `start` and
      `end`, and add a bound row for any new reporting slot.
  - **`tests/verify.test.mjs`:** `astro-verifier.md` has a narrowed-mode section:
    - check ALL previously unmet criteria before stopping;
    - continue to EVERY other criterion in the same run when they pass;
    - report carried, never passed;
    - inspect the given `<saved>..HEAD` range and declare a broad fix by running full.

    The read-only frontmatter assertion stays.
- **`commands/astro-verify.md`:**
  - `argument-hint: <phase number or slug> [--full]`.
  - Step 2 first runs `ac verdict plan <slug> --json` (adding `--full` when it was passed), then
    spawns the verifier. When the plan says `narrowed`, the spawn restates the same narrowed
    contract as the workflow: first ids, saved run and commit, range, check all before
    stopping, continue in the same run when all pass, broad means full, carried is never
    passed.
  - It asks the verifier to end with a fenced JSON block `{mode, broad, criteria:[{id, passed}]}`.
  - Step 3 runs `ac verdict record <slug> --result '<that json>'` whenever `ids` is non-empty.
    PASS requires the record's `passed: true`; then `ac phase verify`. If the record or the gate
    refuses, that is a FAIL line, not a PASS.
  - The FAIL report bound: one line per unmet criterion, then for a narrowed run ONE line
    `carried, not re-checked: <n> (run <R> @ <sha7>)`, then the pointer line.
  - It names `--full` as the override, and references the thresholds by pointing at `ac verdict
    plan`, not by restating them.
- **`agents/astro-verifier.md`:** a `## Narrowed re-verify (ADR-079)` section with the method
  above, plus the structured return fields `mode`, `broad` and `status`. Plan-blindness and the
  tools are unchanged.
- **`commands/astro-execute.md`:**
  - The Workflow args gain `full: <true only when the user passed --full>`.
  - The verify→remediate paragraph gains one sentence: a re-verify after a FAIL narrows first
    and continues to full coverage in the same run (`ac verdict plan`).
  - The Agent-subagents and inline tiers follow `/astro-verify`'s plan → verify → record
    sequence.
  - The `verdict.passed` true bullet notes that `ac phase verify` refuses without a recorded
    full verdict. In that case, report it in one line and point at `/astro-verify <n>`.
- **`MANUAL.md` "Two gates close a phase":** one short paragraph covering:
  - a saved `VERDICT.json` per phase, written by `ac verdict record` and committed;
  - a re-verify after a FAIL checks the unmet criteria first;
  - full runs on the fallbacks (thresholds in `lib/verdict.mjs`), or with `--full`;
  - `ac phase verify` refuses without a full all-passed verdict (`--force` escape);
  - canon-guard protects the file.
- **Full gate:** `node --test tests/` exits 0 (`host node --test tests/` if the container lacks
  something).
- **Commit:** `docs(verify): narrowed re-verify in /astro-verify, the verifier and execute (phase 45 t5)`.

## Waves

| wave | tasks | why parallel-safe |
|---|---|---|
| 1 | t1, t2, t4 | disjoint files: lib engine + `util`/`surprises`; the hook + its test; the workflow + its two tests |
| 2 | t3 | `bin/ac.mjs` needs t1's exports |
| 3 | t5 | docs reference `ac verdict` (contracts test) and the t4 workflow text; final full gate |

Rule checks:
- **RED imports:** there are no separate RED tasks. t1 reaches its new module through
  `await import`; t3 drives the CLI as a subprocess; t4 and t5 test files import only existing
  modules.
- **Wave-green:**
  - The only move is `assertSafeSlug`, from `surprises.mjs` to `util.mjs`, together with its
    one importer, in t1.
  - Nothing else is deleted or renamed.
  - t4's workflow degrades to a full run or an unrecorded verdict when no clerk answers, so the
    other workflow-running suites (`local_model`, `execute_blocked_dependency`) stay green
    without edits.
- **Same file:**
  - `tests/verify.test.mjs` is touched by t4 (window only) and t5 (new assertions); t5 depends
    on t4.
  - `bin/ac.mjs` is only in t3, `tests/workflows.test.mjs` only in t4, and
    `tests/canon_guard.test.mjs` only in t2.
- **Every task declares its files and lands a stamped commit.** No task is `commits: none`.

## Bootstrap note for this phase's own verify

The execute run that builds this phase loads the OLD workflow script at launch. It will
therefore not record a `VERDICT.json`, and the new `ac phase verify 45` gate (t3) will refuse.
That is correct behaviour. Close the AI gate with `/astro-verify 45`, which takes the new path:
plan, then verify, then record, then the gate. Use `--force` only if that path itself is broken.
