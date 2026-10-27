# Plan: phase 52, targeted verify (check only the criteria a change can affect) plus suite receipts (#140, #141)

This plan follows `.astrocode/CONVENTIONS.md`:
- Node ≥22 ESM `.mjs`, zero dependencies, `node:` builtins plus the git CLI through `lib/git.mjs`.
- Named function exports only. `bin/ac.mjs` stays a thin dispatcher. `die()` for fatal errors, `✓ • ⚠ ⊡` glyphs, `json()`.
- A `node:test` test for every `lib/` change, run against a real filesystem and real git (`mkdtempSync` + `git init`).
- Module headers say *why*. Every reporting slot in a loop command states a bound (§Voice).

It follows `DECISIONS.in-force.md`. The decisions that matter here:
- **ADR-079** is amended, not replaced. Its after-FAIL path (narrowed: check the unmet criteria first, then continue to full coverage) stays exactly as it is. Its "Rejected: carrying a PASS into verified with a diff-impact check" is the line the new ADR (t12) supersedes, under the D2/D4/D5 conditions only.
- **ADR-031:** a pass never rests on trust. Here the carry conditions are re-checked in code at record time and again at gate time.
- **ADR-083/084/085:** the test-strength mark (the `[mutation]` tag or the sticky `test_strength`) and the phase's mutate scope (stamped paths).
- **ADR-017:** stamped commits define "the phase's files".
- **ADR-018:** RED tests use dynamic import. **ADR-020:** every wave compiles. **ADR-029:** a per-verb flag allowlist.
- **ADR-006:** `verified` is still only the AI gate. **ADR-087:** the decision number is claimed by `ac decision add`.

It also follows CONTEXT.md D1 to D7 and aims at every criterion C1 to C13 in CRITERIA.md.

Principles applied (`ac principles brief --stage plan`, cited):
- **333f:** the floor, the carry conditions, the receipt checks and the gate are code. The verifier only judges meaning, and may only widen the floor.
- **ce7b:** `recordVerdict` and `verifiedGate` enforce the floor and every carry condition. Prose only describes them.
- **b940:** every plan states its mode and the reason. A receipt miss, a missing base and an unreadable diff each fall back visibly (to observing, or to full), never silently.
- **9173:** one decider (`chooseMode`, reached through `planReverify`), one scope gatherer shared by plan, record and gate, one receipt module. Thresholds live only in `lib/verdict.mjs`. Commands and MANUAL point at them and never restate a number.
- **e618:** the carried list is one line in `/astro-accept`, a single JSON key in `ac phase show`, and absent when nothing was carried.
- **5116:** `ac suite run` never prompts. Nothing waits for a human.
- **2310:** no new slash command. Receipts are agent plumbing inside `/astro-verify` and the executor, not a user-facing capability. The user-facing change rides the existing `/astro-verify`, `/astro-accept` and `ac phase show`.

## Decisions this plan pins (CONTEXT "Open / for the planner", plus gaps)

**P1. A criterion's files are known in code, fail-wide (D1).** This lives in a new `lib/impact.mjs`, which holds mapping facts only and no thresholds.
- **Blocks:** `criterionBlocks(text)` splits CRITERIA.md into `{id, heading, body}`, from each `#{1,6} C<n>` heading to the next one. It uses the same heading rule as `parseCriteriaIds`.
- **Explicit list (optional):** a body line `- **Files:** \`lib/a.mjs\`, \`tests/b/\`` names the criterion's files. Every backticked token on that line is taken as a path, even an untracked one.
- **Fallback for paths:** every backticked span anywhere in the block is split on whitespace. Each token is trimmed of trailing `,.;:)` and a `:<line>` suffix, and a leading `./` is dropped. A token becomes a path when it equals a tracked file (`git ls-files`) or is a directory prefix of one (`tok/` or `tok` + `/`). Glob tokens (`*?[`) never match. **Commands map only through the files they name**, so `` `node scripts/check.mjs` `` maps to `scripts/check.mjs`, and `` `npm run lint` `` maps to nothing.
- **Unmapped means always observed.** A criterion with no resolvable path is in the floor on every targeted verify, with the reason `names no files`. This is the tested default.
- **Matching:** `touches(paths, files)` returns true on an exact equality or a directory prefix.
- **The diff:** `diffSince(root, commit)` runs `git diff --name-only --no-renames <commit> HEAD -- . ':(exclude).astrocode'`. With `--no-renames`, a rename lists both its old and new path. It returns a sorted array, or `null` when git fails. The `.astrocode` exclusion is the same pathspec `verifiedGate` uses, so the `chore(verdict)` commits never count.
- **Unmapped diff files** (changed files that no criterion names) do NOT force a full run, because C6 and C8 need targeted runs on exactly such diffs. They are reported as `unmapped_files` so the verifier can judge widening. The suite criterion, which is never carried, is the backstop for indirect effects.

**P2. Never-carry kinds (D4).**
- **Suite criterion:** `suiteIds(text)` in `lib/impact.mjs` returns the ids where any of these holds:
  - (a) the heading carries `[suite]` right after the id (`### C5 [suite] — …`). The matcher is modelled on `testStrengthIds`: spaces and tabs only, case-insensitive.
  - (b) a backticked span in the block equals one of `SUITE_COMMANDS` exactly (after trim): `npm test`, `npm run test`, `pnpm test`, `yarn test`, `bun test`, `node --test`, `node scripts/test.mjs`, `pytest`, `go test ./...`, `cargo test`. A command with file arguments, such as `node --test tests/x.test.mjs`, is NOT a suite command.
  - (c) the block says `full suite`, `full test suite`, `whole suite` or `entire suite` (case-insensitive, whole words).
  - Separately, the verifier may declare `suite: true` on a criterion in its result. The record keeps that as a sticky `suite: true` mark on the VERDICT.json entry, carried forward exactly like `test_strength` (ADR-085 precedent). The suite set used by the plan is `suiteIds(text)` ∪ the marked entries in the latest verdict.
- **Test-strength criterion:** `testStrengthIds(text)` ∪ the entries marked `test_strength: true` in the latest verdict, the same marked set as ADR-085.
- **The phase's mutate scope:** `mutateScopeFiles(root, slug)` in `lib/impact.mjs` returns `phaseStampedPaths(root, slug).files` (tests included) ∪ every tracked file matched by `pathMatches(entry, f)` for an entry in config `mutation.files` (read via `loadConfig(root)?.mutation?.files`, keeping strings only). It is a superset of what `ac mutate` targets, so it is conservative. `lib/impact.mjs` must NOT import `lib/mutate.mjs`: mutate imports verdict, and verdict imports impact, so that import would make a cycle. Say so in a comment.
- **The rule:** a test-strength criterion is in the floor when `scope ∩ diff ≠ ∅`, and may be carried otherwise (C8). A suite criterion is always in the floor. A receipt may stand in for observing it (P6).

**P3. The base and one hop (D5).**
- **New field:** VERDICT.json gains a top-level `base: {run, commit} | null`, which is the phase's most recent full PASS. `version` stays 1, because the field is additive.
- **Setting it:**
  - A full, all-passed record sets `base` to its own `{run, commit}`.
  - Every other record copies the prior verdict's base forward unchanged, through FAILs, narrowed runs and targeted runs.
- **Legacy verdicts** (no `base` key) derive their base as `{run, commit}` when `mode === 'full'` and every entry is `passed`, and `null` otherwise. A pre-upgrade full PASS can therefore be targeted from. One helper, `baseOf(verdict)`, holds this rule.
- **A targeted run is never a base**, and a carry always cites `base`, never the prior run.
- **Unchanged:** the narrowed-run `was.status === 'carried'` branch keeps its ADR-079 behaviour.

**P4. The decision (D3), extending the single decider.** `chooseMode` stays pure and gains these inputs:
- `base` (`{run, commit} | null`), `baseAncestor` (boolean), `changed` (array | null | undefined);
- `paths` (Map id → array of paths);
- `suite` (array of ids), `strength` (array of ids), `scope` (array of files).

The rules run in this order, and the first that fires decides:
1. `--full` → full `--full passed`. (unchanged)
2. no ids → full. (unchanged)
3. no verdict → full `<verdictReason>`, which is the first-verify case. (unchanged)
4. `criteria_sha` mismatch → full. (unchanged)
5. **The latest verdict has an unmet criterion → the existing ADR-079 branch, byte-for-byte**: the narrowed result or its full fallbacks. A FAIL therefore always takes precedence over targeting (C10).
6. `!base` → full `no full PASS on record to carry from`.
7. `baseAncestor !== true` → full `the full PASS commit is not an ancestor of HEAD`.
8. `changed` null or undefined → full `the diff since the full PASS is unavailable`.
9. `changed.length > MAX_TARGETED_FILES` → full `broad diff: <n> files changed since the full PASS (over <MAX>)`.
10. `affected` = ids whose paths touch `changed`. If `affected.length * TARGETED_DENOMINATOR > ids.length` → full `broad diff: <a> of <m> criteria affected (over half)`.
11. `floor` = `affected` ∪ unmapped ids ∪ `suite` ∪ (`strength` when `scope ∩ changed ≠ ∅`), in id order. Then:
    - if `floor` covers every id → full `every criterion is in the floor`;
    - if `floor` is empty and `changed` is non-empty → full `the diff touches no criterion's files`.
12. Otherwise the mode is targeted, with reason `<floor.length> of <m> criteria affected since full PASS at <sha7> (run <R>)`.

The new constants are exported beside `MAX_NARROW_UNMET`: `MAX_TARGETED_FILES = 20` and `TARGETED_DENOMINATOR = 2`. Integer maths only. The ADR (t12) states the numbers.

The existing test `chooseMode falls back to full with a distinct reason for each rule` must stay green **unedited**. Its `passed` case (a full all-passed verdict with no new inputs) now lands on rule 7 or rule 8, which still gives mode full with a distinct reason.

`planReverify` keeps its sync signature and its existing fields `{mode, reason, first, ids, total, saved, range}`. It adds these fields, all always present:
- `floor: [ids]`;
- `carry: [{id, from: {run, commit}}]`, holding every non-floor id when targeted and `[]` otherwise;
- `why: {id: '<one line>'}`, one entry per floor id, for example `named file changed: lib/x.mjs`, `names no files`, `suite criterion: observe it, or cite a receipt (ac suite receipt)`, or `test-strength: mutate scope changed (lib/y.mjs)`;
- `base: {run, commit} | null`;
- `changed: [files]` and `unmapped_files: [files]`, both `[]` unless targeted.

When the mode is targeted, `range` is `<base.commit>..HEAD`. The output holds no timestamps, so two runs on the same tree print byte-identical JSON (C1).

A single internal `gatherScope(root, slug, {full})` collects every input (text, ids, verdict, base, ancestry, diff, tracked files, paths, suite, strength, scope) and calls `chooseMode`. `planReverify`, `recordVerdict` and `verifiedGate` all call it, so there is no second decider.

**P5. The verdict schema (D7, C11). VERDICT.json, still version 1:**
```
{ version:1, run, mode:'full'|'narrowed'|'targeted', reason, broad, commit, criteria_sha, at,
  base: {run, commit} | null,
  criteria: [
    {id, status:'passed'|'failed', evidence:'observed', test_strength?, suite?, mutation?, refused?},
    {id, status:'carried', evidence:'carried', last:'passed'|'failed', from:{run, commit}, test_strength?, suite?, mutation?},
    {id, status:'carried', evidence:'carried', last:'passed', receipt:{key, command, commit, exit, at}, suite:true} ] }
```
- **Evidence on every entry:** every criterion appears exactly once, and every entry written from now on carries `evidence`.
- **A full PASS** records every entry as `evidence: 'observed'`.
- **Narrowed (ADR-079) carries** get `evidence: 'carried'` and keep their existing `from`/`last`.
- **`reason`** is the mode's reason. When the result's mode equals the mode that `gatherScope` decides at record time, it is that plan's reason. Otherwise it is `verifier ran <mode> (plan: <plan mode>: <plan reason>)`, and `broad` gives `broad fix declared by the verifier`.
- **Validation:** `readVerdict` accepts `targeted` in `MODES`, an optional `evidence` ∈ {observed, carried}, an optional boolean `suite`, and an optional `base`. Legacy entries without `evidence` stay valid.

**The result input to `ac verdict record --result`:**
```
{ mode:'full'|'narrowed'|'targeted', broad?, reason?,
  criteria: [ {id, passed:bool, test_strength?, suite?, mutation?}
            | {id, carried:true, from?:{run, commit}}          // targeted only
            | {id, carried:true, receipt:'<64-hex key>'} ] }   // targeted only, suite criteria only
```
- **Implicit carries:** in a targeted record, a criterion that is absent is treated as `{carried: true}` citing the base.
- **Where `carried: true` is refused:** a `carried: true` item in a full or narrowed result throws, writes nothing, and exits non-zero. This keeps the meaning of "full = every criterion observed".

**P6. Suite receipts (D6, #141), in a new `lib/receipts.mjs`.**
- **Where they live:** `.astrocode/.local/suite-receipts/<key>.json`, made under `ensureLocalDir(root)` so they are covered by `.local/.gitignore` (`*`). They are local and never committed: a teammate's receipt is not evidence this machine saw.
- **The key:** `sha256(commit + '\0' + tree + '\0' + command)`, full hex, where `tree` is `git rev-parse HEAD^{tree}`.
- **The record:** `{version:1, key, command, commit, tree, clean_before, clean_after, clean, exit, node: process.version, started_at, at, seconds, dirty: [first 5 porcelain paths]}`.
- **What clean means:** `git status --porcelain --untracked-files=all -- . ':(exclude).astrocode'` prints nothing. Untracked files count as dirty (C7c). Ignored files are out of scope, and the ADR states this.
- **Running:** `runSuite(root, command, {json})` reads the tree state, runs the command with `spawnSync(command, {shell: true, cwd: root})`, reads the tree state again, and ALWAYS writes a receipt, including failing and dirty runs, so that they can be shown as non-reusable. It returns the receipt. stdio is inherited. With `json`, the child's stdout goes to our stderr so stdout stays pure JSON.
- **Reuse:** `reusableReceipt(root, command)` and `checkReceipt(root, key)` both return `{ok, receipt, reason}`. They refuse, each with a distinct reason, in this order:
  - no receipt for this command on HEAD's tree;
  - receipt not found;
  - receipt is for commit X, not HEAD;
  - tree differs;
  - command differs (key lookup);
  - exit status was N;
  - tree was dirty when the suite ran;
  - tree is dirty now (`<first path>`);
  - node version changed.
- **Exact matching:** the command is matched as an exact string, never normalised.
- **Imports:** `lib/receipts.mjs` imports `ensureLocalDir` from `lib/verdict.mjs`. `lib/verdict.mjs` reaches receipts only through `await import('./receipts.mjs')` inside the async `recordVerdict`, which is the same pattern used for `survivors.mjs`.
- **CLI:**
  - `ac suite run --command "<cmd>" [--json]` exits with the suite's own status and prints one line. On success: `✓ suite receipt <key8>: exit 0 on a clean tree at <sha7> (reusable)`. On a failing or dirty run: `⚠ suite receipt <key8>: not reusable — <reason>`.
  - `ac suite receipt --command "<cmd>" [--json]` is a query and exits 0. It prints `✓ reusable receipt <key8> for "<cmd>" at <sha7>` or `• no reusable receipt: <reason>`. Its JSON is `{reusable, reason, receipt}`.
  - A missing `--command` dies. Unknown flags die (ADR-029).
- **Who writes receipts:**
  - the verifier, via `ac suite run`;
  - the executor, when it runs the full suite on a clean tree after its commit (agent text, t8);
  - any host, through the same `ac` verb.

  A suite criterion's receipt is cited only in a targeted verdict. A full verdict observes everything, so its suite criteria are observed.

**P7. Recording a targeted verdict (C3 to C9), in `recordVerdict`.** Inside the lock, with HEAD read first, it calls `gatherScope` (no `--full`) against the prior verdict:
- **Plan not targeted:** if the plan's mode is not targeted, every carry in the targeted result is refused with `no carry allowed: <plan reason>`. Those criteria are saved as `status: 'failed'` with `refused`. Criteria the run did observe are recorded as reported.
- **Floor criteria:** a floor id that is absent or carried is refused as `in the floor (<why>) — must be observed`. The one exception is a suite id with a valid receipt. The refused criterion is saved `failed`, the refusal names it (C3, C5), and the record still exits 0, following the existing `refused[]` precedent.
- **Carry citations:** a carry whose given `from` does not deep-equal `base` is refused as `carry must cite the most recent full PASS run <R> @ <sha7>, not run <r> @ <sha7>` (C4: one hop, and no non-ancestor citation).
- **Suite carries:** a suite id carried with `from` (no receipt) is refused as `suite criterion: observe it, or cite a reusable receipt`. A receipt citation is checked through `checkReceipt`, and its commit must equal the graded commit. A receipt on a non-suite id is refused.
- **Widening:** observed criteria outside the floor are recorded normally. Observing more than the floor is never refused (C3 i).
- **Pass:** `passed = (mode === 'full' && every entry passed) || (mode === 'targeted' && every entry is passed or a carried entry with last 'passed' && no refusal)`.
- **Output:** the record JSON adds `reason`, `base`, `floor` and `observed` (count). It keeps `carried`, `carriedFrom` and `refused`.
- **Commit:** the commit subject becomes `chore(verdict): phase NN run R — targeted PASS` (and the same pattern for other modes).
- **ADR-085 carry-forward:** marks (`test_strength`, `suite`) and prior `mutation` evidence ride carried entries as they do today.

**P8. The gate (D2), in `verifiedGate`, which stays sync.**
- **Unchanged parts:** a full verdict follows exactly today's rules. The `CRITERIA.md` hash check and the rule "no code changed since `verdict.commit` (outside `.astrocode`)" apply to both modes.
- **A narrowed verdict** still refuses, with reason `the latest verdict is a narrowed run`.
- **A targeted verdict** passes only when all of these hold:
  - every id has exactly one entry;
  - every observed entry is `passed`;
  - every carried entry has `last: 'passed'` and either a `from` deep-equal to `verdict.base`, or a `receipt` whose commit equals `verdict.commit`, on a suite id;
  - `verdict.base` is non-null and its commit is an ancestor of HEAD;
  - a fresh `gatherScope` run still returns targeted, and every id in its floor is observed and passed (or, for a suite id, carried by receipt).

  Each failure has its own reason.
- **Receipt files are not required at gate time.** The record already checked them, and the gate may run on another machine.

**P9. Surfaces.**
- **`ac verdict plan`, human line when targeted:** `• targeted: <n> of <m> criteria affected since full PASS at <sha7> (run <R>): re-check <ids>; carry <k>`. The narrowed and full lines stay unchanged.
- **`ac phase show <phase>`:** prints the roadmap entry as today, plus one key `carried: [{id, from:{run, commit}} | {id, receipt:{key, command, commit}}]`. The key is present only when the latest VERDICT.json has carried entries; on a full PASS it is absent (Voice). The list comes from a `carriedOf(root, slug)` helper in `lib/verdict.mjs`.
- **`/astro-accept`:** a new step 2b runs `ac phase show <slug> --json` and, when there is a `carried` key, states in **one line**, before the walkthrough: `carried, not re-observed: C3, C4 (run 4 @ abc1234); C5 (suite receipt @ def5678)`. It says nothing when the key is absent.
- **`/astro-verify`:** gains a `targeted` bullet and a targeted PASS line (one line: verified, observed n, carried k from run R @ sha7).
- **The workflow:** gains a targeted preamble and a coverage guard. A carry is allowed only outside the floor.

## Tasks

### t1: `lib/impact.mjs`: criterion files, the suite marker, the diff and the mutate scope (P1, P2)
- **id:** t1
- **file:** `lib/impact.mjs` (new), `tests/impact.test.mjs` (new)
- **depends_on:** none
- **Test first.** Use dynamic import inside async tests (ADR-018) and real tmp git repos. Named tests:
  - "criterionBlocks splits CRITERIA.md per C<n> heading and keeps each body";
  - "criterionPaths takes a Files: line verbatim and otherwise only backticked tokens that are tracked files or directory prefixes";
  - "a backticked command maps to the files it names; `npm run lint`, a glob and prose map to nothing";
  - "trailing punctuation, :line suffixes and ./ are stripped before matching";
  - "a criterion with no resolvable path is reported unmapped";
  - "touches matches an exact path or a directory prefix, never a partial name (lib/ab.mjs is not lib/a)";
  - "diffSince lists both sides of a rename, excludes .astrocode, and returns null for an unknown commit";
  - "suiteIds finds the [suite] heading tag, an exact suite command span and the 'full suite' phrase, but not `node --test tests/x.test.mjs`";
  - "mutateScopeFiles returns the phase's stamped paths plus tracked files matched by mutation.files".
- **Implement** these exports: `criterionBlocks`, `criterionPaths(text, tracked)` (returns `Map id → paths[]`), `touches`, `trackedFiles(root)`, `diffSince(root, commit)`, `SUITE_COMMANDS`, `suiteIds(text)` and `mutateScopeFiles(root, slug)`.
  - Imports are limited to `lib/git.mjs`, `lib/fixtures.mjs` (`phaseStampedPaths`, `pathMatches`) and `lib/config.mjs`. Never import `lib/mutate.mjs` or `lib/verdict.mjs`, and add a comment saying why (the cycle).
  - The module header says why the module exists: fail-wide mapping, and unmapped means observed.
- **Covers:** C1 (the floor's file side), C5, C6 (suite detection) and C8 (scope).

### t2: `lib/receipts.mjs`: run, write, find and check suite receipts (P6)
- **id:** t2
- **file:** `lib/receipts.mjs` (new), `tests/receipts.test.mjs` (new)
- **depends_on:** none
- **Test first.** Use dynamic import, real tmp git, and suite commands built with `node -e "process.exit(N)"`. Named tests:
  - "runSuite on a clean tree writes a receipt with command, commit, tree, clean, exit, node and times, and returns the exit";
  - "a receipt lives under .astrocode/.local and is git-ignored";
  - "reusableReceipt reuses the same commit, clean tree and exact command";
  - "a modified tracked file refuses reuse, naming the path";
  - "an untracked source file refuses reuse";
  - "a later commit refuses reuse";
  - "a different command string refuses reuse (no normalisation)";
  - "a non-zero exit is written but never reusable";
  - "a receipt written on a dirty tree is never offered for reuse, even once the tree is clean again";
  - "checkReceipt resolves a key and applies the same refusals";
  - "a changed node version refuses reuse";
  - "each refusal has a distinct reason";
  - "changes under .astrocode/ do not make the tree dirty".
- **Implement** these exports: `receiptDir(root)`, `receiptKey({commit, tree, command})`, `treeState(root)`, `runSuite(root, command, {json, spawn})` (with an injectable spawn for tests), `reusableReceipt(root, command)` and `checkReceipt(root, key)`.
  - Writes use `atomicWriteJSON` after `ensureLocalDir(root)`, which is imported from `lib/verdict.mjs`. Reads never throw.
- **Covers:** C6 (receipt side) and C7.

### t3: `lib/verdict.mjs` part 1: the base, the targeted decision and the plan fields (P3, P4, P5 read side)
- **id:** t3
- **file:** `lib/verdict.mjs`, `tests/verdict_targeted.test.mjs` (new)
- **depends_on:** t1
- **Test first.** Use dynamic import. Pure `chooseMode` cases need no git. The `planReverify` cases use a real tmp repo with a CRITERIA.md whose Observe lines name `src/a.mjs`, `src/b.mjs` and so on, a `[suite]` criterion, a `[mutation]` criterion, and stamped `(phase 01 tK)` commits. Named tests:
  - "after a full PASS a one-file follow-up plans targeted: the floor holds the criterion naming that file plus suite, every other id is carryable from the full PASS run and commit";
  - "planReverify prints byte-identical JSON on two runs of the same tree";
  - "first verify, FAIL-only history, a targeted verdict with no base, a non-ancestor base, a broad diff (files and criteria), an every-criterion floor, a no-criterion-touched diff, a CRITERIA edit and --full each go full with a distinct reason";
  - "a latest FAIL after a full PASS still narrows exactly as ADR-079 (first = unmet ids, carry = [])";
  - "the base survives a FAIL, narrowed and targeted record in VERDICT.json and carries never cite a targeted run";
  - "a legacy full PASS without a base key is a base";
  - "a [mutation] or sticky test_strength criterion is in the floor when a stamped file changed and carryable when only an unstamped file changed";
  - "an unmapped criterion is always in the floor";
  - "a sticky suite mark puts an untagged criterion in the floor";
  - "readVerdict accepts targeted, evidence, suite and base and still refuses unknown modes";
  - "MAX_TARGETED_FILES and TARGETED_DENOMINATOR are exported integers".
  - To get a base in this task's tests, seed VERDICT.json directly (write the file, then commit it), because the recorded targeted path lands in t4.
- **Implement:**
  - `baseOf(verdict)`, the constants, `targeted` in `MODES`, and the `readVerdict` extensions.
  - Extend `chooseMode` per P4. Rule 5 must stay the untouched ADR-079 branch.
  - `gatherScope` (internal) and the new `planReverify` fields.
  - `recordVerdict` writes `base` per P3 and `evidence: 'observed'` / `'carried'` on entries. Nothing else in record or gate changes in this task.
  - Update the module header (amends ADR-079 for the after-PASS case).
- **Done:** `tests/verdict.test.mjs` and `tests/verdict_cli.test.mjs` stay green **unedited** (C10). The whole suite (`npm test`) is green.
- **Covers:** C1, C2, C4 (plan side), C8 (plan side) and C10.

### t4: `lib/verdict.mjs` part 2: targeted record, the amended gate and `carriedOf` (P5, P7, P8)
- **id:** t4
- **file:** `lib/verdict.mjs`, `tests/verdict_targeted_record.test.mjs` (new)
- **depends_on:** t3, t2
- **Test first.** Use dynamic import and real tmp git; for receipts, call `runSuite` from `lib/receipts.mjs` with a `node -e` command. Named tests:
  - "a targeted PASS that observes the floor plus one extra and carries the rest is passed and verifiedGate accepts it";
  - "a floor criterion omitted or carried is saved failed with a refusal naming it, and the gate refuses";
  - "a criterion whose named file changed cannot be carried (C5)";
  - "a carry citing a targeted run, an older full PASS, or a non-ancestor commit is refused";
  - "a second full PASS becomes the base for later carries";
  - "a suite criterion carried from the full PASS is refused; carried by a reusable receipt on HEAD it is recorded with the receipt citation and passes";
  - "a receipt on a dirty tree, another commit or a failing exit is refused at record time";
  - "a test-strength criterion carried after a mutate-scope change is refused; after an out-of-scope change it carries and the gate accepts";
  - "a targeted FAIL is saved, not verified, and the next plan narrows on it";
  - "a targeted result when the plan is full refuses every carry with the plan's reason";
  - "carried:true in a full or narrowed result is rejected and writes nothing";
  - "every id appears exactly once with evidence observed or carried, and carried entries name their run and commit or receipt; mode and reason are recorded";
  - "code committed after a targeted PASS makes the gate refuse";
  - "carriedOf lists carried entries with their source and is empty on a full PASS".
- **Implement** P7 in `recordVerdict` (receipts through `await import('./receipts.mjs')`), P8 in `verifiedGate`, and export `carriedOf(root, slug)`.
  - The ADR-079 narrowed carry branch and the mutation gate stay as they are.
- **Done:** `tests/verdict.test.mjs`, `tests/verdict_cli.test.mjs` and `tests/verdict_targeted.test.mjs` stay green unedited. `npm test` is green.
- **Covers:** C3, C4, C5, C6, C8, C9 and C11.

### t5: CLI `ac suite run|receipt` (P6)
- **id:** t5
- **file:** `bin/ac.mjs`, `tests/suite_cli.test.mjs` (new)
- **depends_on:** t2
- **Test first** (spawn the real CLI in a tmp git project, as `tests/verdict_cli.test.mjs` does). Named tests:
  - "ac suite run --command exits with the suite's status and prints one receipt line";
  - "--json keeps stdout pure JSON with the receipt";
  - "ac suite receipt --command reports reusable on the same clean tree and a reason after a tracked edit, an untracked file, a new commit, another command or a failing run";
  - "a missing --command dies";
  - "an unknown flag (--comand) dies".
- **Implement:**
  - `case 'suite'` with the `run` and `receipt` subverbs.
  - `checkFlags` entries `'suite run': ['command', 'json']` and `'suite receipt': ['command', 'json']`, with a comment saying a typo must not run or reuse the wrong command.
  - Two help lines.
- **Covers:** C7 (the CLI surface the verifier uses).

### t6: CLI: targeted `ac verdict plan` line, `ac phase show` carried list, verdict help (P9)
- **id:** t6
- **file:** `bin/ac.mjs`, `tests/verdict_targeted_cli.test.mjs` (new)
- **depends_on:** t4, t5
- **Test first** (real CLI, tmp project). Named tests:
  - "verdict plan prints the targeted line naming n of m, the full PASS sha7 and the ids to re-check";
  - "verdict plan --json is identical across two runs";
  - "--fulll is refused non-zero after a full PASS";
  - "phase show lists carried criteria with run and commit after a targeted PASS and has no carried key after a full PASS";
  - "phase verify accepts a valid targeted PASS and refuses one with a skipped floor criterion, naming the reason";
  - "phase show still parses as JSON (existing callers)".
- **Implement:**
  - The targeted branch in `case 'verdict'` (plan).
  - `phase show` merges `carried` from `carriedOf` when it is non-empty.
  - Update the `phase verify` comment (ADR-079, amended by the new ADR).
  - Help line: `ac verdict plan <phase> [--full] [--json]  full, narrowed (after a FAIL) or targeted (after a full PASS)`.
- **Done:** `tests/verdict_cli.test.mjs`, `tests/flags.test.mjs` and `tests/evidence_cli.test.mjs` stay green unedited.
- **Covers:** C1 (human line), C2 (typo), C9 and C12 (`ac phase show`).

### t7: Workflow: targeted plan, preamble, coverage guard and receipt pass-through (P4, P5, P7)
- **id:** t7
- **file:** `workflows/execute-phase.mjs`, `tests/workflows.test.mjs`
- **depends_on:** t4
- **Test first** (static source checks plus the existing stub-run harness in `tests/workflows.test.mjs`). Named tests:
  - "VERDICT_PLAN_SCHEMA accepts targeted with floor, carry, why, base, changed and unmapped_files";
  - "a targeted plan missing floor or base degrades to a full verify with one log line";
  - "the targeted preamble names the floor, the base run and commit and the range, lets the verifier widen but never skip a floor id, and tells it to check `ac suite receipt` before running the suite";
  - "the coverage guard withdraws a targeted PASS that carried or failed a floor id and keeps one that carried only non-floor ids";
  - "the record payload sends carried:true with receipt for receipt-cited criteria";
  - "a targeted plan logs `• verify plan: targeted — <reason>`".
  - The existing ADR-031/079 narrowed tests stay unedited.
- **Implement:**
  - Add `targeted` to the VERIFY_SCHEMA `mode` enum, plus an optional item `receipt` string and an optional `suite` boolean.
  - Add the new plan-schema properties and `reason`/`observed` to VERDICT_RECORD_SCHEMA.
  - In `getVerdictPlan`, a targeted plan needs an array `floor`, a `base` and a `range`.
  - Add the `runVerify` targeted preamble.
  - In `verifyOnce`: in targeted mode `covered` = every floor id observed and passed, and carries are allowed only for non-floor ids. The absence-is-failure loop adds the floor ids. The record payload maps carried items with a `receipt` to `{id, carried: true, receipt}` and omits the other carried items.
  - Keep the "no semicolons" style.
- **Covers:** C3 and C9 in the automated loop. C10 is untouched.

### t8: Agent text: verifier targeted mode and receipts, executor receipts, criteria author files and `[suite]`
- **id:** t8
- **file:** `agents/astro-verifier.md`, `agents/astro-executor.md`, `agents/astro-criteria-author.md`
- **depends_on:** none
- **Implement**, using the shapes pinned in P4 to P6 and restating no threshold:
  - **Verifier:** add a "When your prompt says THIS IS A TARGETED VERIFY" section beside the narrowed one:
    - observe every floor id from scratch;
    - widen when the diff (`git diff <range>`) reaches what another criterion rests on;
    - never skip a floor id;
    - report the rest as carried, or omit them;
    - a suite criterion: run `ac suite receipt --command "<the suite command>" --json` first; when it is reusable, cite `receipt: <key>` with `carried: true`; otherwise run the suite through `ac suite run --command "<cmd>"` and observe it;
    - declare `suite: true` on a criterion whose evidence is the full suite;
    - return `mode: targeted`.
    - Also state that, in any mode, a reusable receipt may stand in for the verifier's own structural "run the full suite" step when no criterion's evidence is the suite, cited in the report.
    - The rules live in `lib/verdict.mjs`.
  - **Executor:** "when you run the project's full suite after your commit on a clean tree, run it as `ac suite run --command "<cmd>"` so a later verifier on the same tree can reuse it".
  - **Criteria author:** name every file or command a criterion rests on in backticks on its Observe line, optionally add a `- **Files:**` line, and tag a criterion whose evidence is the full test suite `[suite]` right after its id (mirroring `[mutation]`). A criterion that names no file is always re-checked.
- **Done:** `npm test` is green (any agent-text guards stay green).
- **Covers:** D1, D4 and D6 prose. C6 and C7 in practice.

### t9: End-to-end targeted-verify scenarios through the CLI (test-after gate)
- **id:** t9
- **file:** `tests/verdict_targeted_e2e.test.mjs` (new)
- **depends_on:** t6
- **Test-after, chosen explicitly.** This task drives only shipped CLI verbs, so it depends on t6, and t6 already depends on t4 and t5.
  - **Fixture:** `initPlanning` + `addPhase`, then a CRITERIA.md with C1 to C6 plus a `[suite]` C7 and a `[mutation]` C8. Observe lines name distinct `src/*.mjs` files. The source and test files arrive in stamped `(phase 01 tK)` commits.
  - **Scenarios**, one test each, named after the criterion:
    - C1: targeted after a one-file follow-up, deterministic, with the human line.
    - C2 (a) to (e): each full with a distinct reason, plus `--fulll` refused.
    - C3: widen accepted (phase verified); skipped floor id refused and named (not verified).
    - C4: carries cite F1 after T1, a citation of T1 is refused, F2 becomes the base, a non-ancestor citation is refused.
    - C5.
    - C6: suite in the floor without a receipt, refused when carried, accepted with `ac suite run` then the receipt cited.
    - C7 (a) to (f) through `ac suite receipt`.
    - C8: in-scope vs out-of-scope change, including a sticky untagged `test_strength` criterion.
    - C9: valid targeted PASS → `ac phase verify` → `ac phase show` status verified; targeted FAIL saved and the next plan narrowed.
    - C10: FAIL then plan narrowed, nothing carryable.
    - C11: VERDICT.json shape.
    - C12: `ac phase show` carried list.
- **Done:** all scenarios green and `npm test` green.
- **Covers:** C1 to C12 end to end.

### t10: Command text: `/astro-verify` targeted mode, `/astro-accept` carried line, `/astro-execute` mention, and their guards
- **id:** t10
- **file:** `commands/astro-verify.md`, `commands/astro-accept.md`, `commands/astro-execute.md`, `tests/commands.test.mjs`
- **depends_on:** t6
- **Test first** (in `tests/commands.test.mjs`). Named tests:
  - "phase 52: /astro-verify has a targeted bullet that spawns ONE verifier with the plan's floor, base and range and says the floor may only be widened";
  - "the fenced JSON allows mode targeted, carried:true and receipt";
  - "step 3 has a bounded targeted PASS line naming observed and carried counts and the full PASS run @ sha7";
  - "/astro-accept runs `ac phase show <slug> --json` before the walkthrough and relays the carried list in one line, saying nothing when there is none";
  - "/astro-execute names targeted beside narrowed".
  - Add the new accept slot (`2b`) to the reporting-slot table so its bound is asserted.
  - The existing phase-45 doc tests and the `verifyrun` contract test stay green: the `<!-- verifier-contract -->` block is NOT edited, and targeted text goes in its own bullet.
- **Implement** per P9.
  - Step 2 of `astro-verify.md` keeps "ac verdict plan" before "spawn **ONE**".
  - Step 3 adds the targeted PASS line inside the existing slot.
  - Add `astro-accept.md` step 2b.
  - Edit `astro-execute.md` lines ~74 and ~122 so they say a verify after a full PASS targets (`ac verdict plan` decides).
- **Covers:** C12 (accept flow) and C13 (docs consistency).

### t11: MANUAL and CHANGELOG
- **id:** t11
- **file:** `MANUAL.md`, `CHANGELOG.md`
- **depends_on:** t12, t6
- **Implement.** In MANUAL "Two gates close a phase", add a targeted-verify paragraph:
  - after a full PASS a verify targets automatically;
  - the floor is computed from the diff, and the verifier may only widen it;
  - the carry conditions (most recent full PASS at an ancestor, untouched files, suite and test-strength never carried, one hop);
  - full on first verify, a broad diff or `--full`;
  - the stated mode;
  - `ac phase show` and `/astro-accept` name the carried criteria;
  - the thresholds live in `lib/verdict.mjs`, so no number is restated.

  Also add these to MANUAL:
  - A "Suite receipts" subsection: `ac suite run|receipt`, local and uncommitted, reused only on the same commit, the same clean tree, the exact command and exit 0.
  - In the criteria-authoring text, the `**Files:**` line and the `[suite]` tag.

  CHANGELOG: an Unreleased entry citing the new ADR number from t12. No version bump.
- **Covers:** C13 (docs).

### t12: Record the targeted-verify decision through the claim (amends ADR-079)
- **id:** t12
- **file:** `.astrocode/DECISIONS.md`, `.astrocode/DECISIONS.in-force.md`
- **depends_on:** none
- **Implement.** Run `ac decision add "<title>" --why "…" --rejected "…"`. Never pick a number or write an ADR file by hand.
  - **Title:** "A verify after a recorded full PASS targets: ac computes from the diff the floor of criteria it can affect, the verifier may only widen it, and a targeted PASS may mark the phase verified when every carried criterion cites the phase's most recent full PASS at an ancestor of HEAD, none of its files changed, and it is neither a suite criterion (unless a suite receipt covers the exact clean tree) nor a test-strength criterion whose mutate scope changed; one hop only (amends ADR-079)".
  - **Why:** in one paragraph:
    - #140: full re-runs after one-line follow-ups, around 50 min, and 1-5 vs 9-13 units;
    - #141: 16% of test minutes re-ran suites on identical clean trees;
    - the floor is code (named files, unmapped criteria always observed, suite, test-strength scope), so judgement only widens it;
    - `ac verdict record` and `ac phase verify` re-check every condition in code;
    - `MAX_TARGETED_FILES = 20` and over half of the criteria affected go full;
    - the base is kept in VERDICT.json (`base`), so successive targeted verifies compare against the same full PASS;
    - receipts are local (`.astrocode/.local`), keyed by commit, tree and exact command, refused on a dirty tree (untracked included; ignored files not checked) or on a non-zero exit;
    - **ADR-079 stays in force for the re-verify after a FAIL**, and a FAIL always takes precedence over targeting.
  - **Rejected:**
    - guessing a criterion's files from prose (a false carry);
    - forcing full on any diff file that no criterion names (no narrowing in practice; the suite criterion is the backstop);
    - carrying from the previous targeted run (a chain of carries);
    - committed receipts (a teammate's run is not this verifier's evidence);
    - accepting receipts in a full verdict (full means every criterion observed).
- **Done:** report the claimed id. t11 depends on t12, so the CHANGELOG cites a number that already exists.
- **Covers:** C13 (canon).

## Wave shape
- Wave 1: t1, t2, t8, t12
- Wave 2: t3, t5
- Wave 3: t4
- Wave 4: t6, t7
- Wave 5: t9, t10, t11

## Same-file ownership check
- `lib/verdict.mjs` has two owning tasks: t3, then t4 (t4 depends on t3).
- `bin/ac.mjs` has two owning tasks: t5, then t6 (t6 depends on t5).
- Every other file has exactly one owner:
  - `lib/impact.mjs` and `tests/impact.test.mjs` (t1);
  - `lib/receipts.mjs` and `tests/receipts.test.mjs` (t2);
  - `workflows/execute-phase.mjs` and `tests/workflows.test.mjs` (t7);
  - the three agents (t8);
  - the three commands and `tests/commands.test.mjs` (t10);
  - `MANUAL.md` and `CHANGELOG.md` (t11);
  - the decision files (t12);
  - each new test file (its own task).
- `tests/verdict.test.mjs` and `tests/verdict_cli.test.mjs` are owned by no task, and are kept unedited on purpose (C10).
- No task deletes or renames a symbol. Every change is additive: new modules, new exports, a new mode value, new optional fields and new keys. So every wave boundary compiles.
  - **The interim state after t3** is safe. A targeted plan reaches the workflow as an unknown mode, so it degrades to a full verify. `ac verdict plan` prints it under the full line until t6. The gate still refuses targeted verdicts until t4.
- **Imports:** RED tests in t1 to t4 import lib modules only through `await import(...)` inside async tests (ADR-018). t5, t6 and t10 test through the spawned CLI or file text. t9 is explicitly test-after.
- **Cycles:** `lib/impact.mjs` imports neither `lib/verdict.mjs` nor `lib/mutate.mjs`. `lib/verdict.mjs` loads `lib/receipts.mjs` dynamically, so no static import cycle is introduced.
- No task carries `commits: none`.
