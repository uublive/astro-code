# Plan — phase 49: survivor triage support (ADR-085)

This plan follows:
- `.astrocode/CONVENTIONS.md`:
  - zero deps, `node:` builtins only, ESM `.mjs`;
  - named function exports, lowercase one-word `lib/` modules;
  - `die()`/`json()` and the `✓ • ⚠ ⊡` glyphs;
  - `node:test` with real `mkdtempSync` dirs and real git, no mocks;
  - dense comments that say why;
  - every reporting slot states its bound (§Voice, ADR-055).
- `.astrocode/DECISIONS.in-force.md`:
  - ADR-085: this phase builds it. The tool's result is the bar for every test-strength
    criterion, the verifier declares the mark, code holds it, and the mark is sticky. This amends
    ADR-084's tag-only gate.
  - ADR-083: the kept-run binding stays. A full run is what a verdict records.
  - ADR-084: scope and tests per phase are unchanged (CONTEXT §Out).
  - ADR-079: `VERDICT.json` is written only by `ac verdict record`, committed path-limited and
    unstamped.
  - ADR-017 and ADR-041: no `(phase NN tK)` stamp on verdict or judgement commits.
  - ADR-018: new symbols are reached with `await import`.
  - ADR-020: every wave boundary is green.
  - ADR-029: every new flag goes into `ALLOWED_FLAGS`.
  - ADR-001: zero deps.
- This phase's `CONTEXT.md`: D1–D6 and "Also in scope". The plan aims at every criterion in
  `CRITERIA.md`, C1–C14.

**Tools in this container (checked while planning):**
- Installed: `/data/bin/gremlins` (v0.6.0 by its embedded build info, `--version` prints `dev`),
  `/data/bin/mutmut` (3.8) and `/data/bin/go` (1.25).
- Not installed: Stryker and mutmut 2.4, despite CONTEXT. `which stryker` finds nothing and
  `VERSIONS.json` records the same.
- Consequences:
  - Real-tool checks cover mutmut 3 and Gremlins.
  - Stryker and mutmut 2 are covered by the stub plus the transcribed CLI, marked "transcribed".
  - No network installs. No host command is planned; an executor that uses `host` reports it.

Principles brief (`--stage plan --by planner`), applied:
- **9173: one place per rule.**
  - The mutant identity key, text-only detection, grouping, the judgements file and its
    validation all live in the new `lib/survivors.mjs`.
  - Go and JS function spans live in the new `lib/funcscan.mjs`. Python spans stay in
    `lib/pyscan.mjs`.
  - The evidence contract, the gate, the sticky mark and the run files stay in
    `lib/verdict.mjs`. `oneLine` is exported from there, not copied.
  - The fallback wording table lives in `lib/mutate.mjs`, beside the reasons it words.
  - The verifier, the commands and the MANUAL cite these and never restate them.
- **333f:** grouping, text-only detection and key matching are mechanical text comparison.
  Whether a survivor is equivalent is always a human or verifier judgement.
- **1a0d / D6:** automation only proposes. Nothing is ever auto-marked equivalent. A group note
  is expanded at write time into one explicit entry per current member.
- **7fdd:** a recorded judgement carries over while its mutant still exists.
- **ce7b:** the sticky mark, the partial-run refusal and the code-moved refusal are code gates in
  `recordVerdict`. Prose only tells the verifier to use them.
- **b940:**
  - A narrowing a tool cannot honour is reported as not narrowed.
  - A flaky check that cannot run says why, in `res.flaky.reason`.
  - A version not found stays `null` with no crash.
- **8d73 (cited in CONTEXT):** one cap. The flaky check and the mutation run share one deadline.
- **5116:** no prompt and no stdin anywhere.
- **e618:** human output is bounded. It shows groups, not a flat survivor dump, and caps long
  lists with "+N more", pointing at `--json` for the full version.
- **2310:** `/astro-mutate` gains `judge` and `--survivors`.

## Design decisions made here (the CONTEXT open questions and research forks)

### P1 — Mutant identity key (D3, C4), in `lib/survivors.mjs`
- `describeMutant(m, { lineText, fn, textKinds })` returns
  `{ key, fn, kind, text_only, line_text, group }`.
- The key is `s:` plus the first 12 hex characters of sha1 over these parts, joined with `\0`:
  1. `file`;
  2. `fn`, the enclosing function's qualified name, or `''`;
  3. `kind`;
  4. `line_text`, the mutated source line at HEAD with leading and trailing whitespace trimmed;
  5. `replacement ?? replacement_line ?? ''`;
  6. `col` relative to the first non-blank character, or `''` when the tool gives no column.
- **Never the line number.** A line shift above the mutant keeps the key. An edit of the mutated
  line changes `line_text`, which re-opens the judgement.
- Re-indenting keeps the key, because `line_text` is trimmed and the column is relative to it.
- **Fallback when the tool gives neither column nor replacement** (mutmut 2, or mutmut 3 when
  `show` was capped): an ordinal is appended. It counts among ALL parsed mutants that share
  parts 1–5, not survivors only, so a sibling's kill cannot shift it.
- **`kind`:**
  - Stryker: `mutatorName`.
  - Gremlins: `type`.
  - mutmut 3: `diffKind(line_text, replacement_line)`, the minimal differing token pair, written
    `` `>` → `>=` ``. Its mutant-name suffix is a run-local counter, never a kind.
  - Unknown: `'unknown'`.
- `fn`:
  - mutmut 3 already carries `func`.
  - Python files use `pythonFunctions` and `functionAt`.
  - `.go` and JS/TS use `lib/funcscan.mjs`.
  - Unknown gives `null`, and the survivor is grouped as `(outside any function)` (b940).

### P2 — Text-only and groups (D6, C1, C2)
- **Text-only:** `isTextOnly(m, textKinds)` is true when either holds:
  - the mutator is in the row's `textKinds` (Stryker `['StringLiteral']`);
  - or there is a line-level `replacement_line` (mutmut 3) and `literalOnlyChange(orig, repl)`
    holds: the lines differ only inside string-literal content, with the code outside literals
    identical.
- Gremlins has no string mutator, so it never yields text-only. The MANUAL says so.
- Message content is never matched (research risk 8).
- **Groups:**
  - Logic survivors are grouped by `(file, fn, kind)`.
  - Every text-only survivor of the run goes into ONE group, `g:text-only`, whatever its function,
    so that one note covers it, per the phase goal.
  - Group ids are deterministic: `g:` plus a sha1-12 of `file\0fn\0kind`.
- `groupSurvivors(survivors)` returns
  `[{ id, file, fn, kind, text_only, count, open, equivalent, test_gap, keys }]`.
  - The order is file, then fn, then kind, with `g:text-only` last.
  - Every survivor sits in exactly one group, and the counts sum to `survivors.length`.

### P3 — Judgements file (D3, C2, C3)
- The file is `.astrocode/phases/<slug>/SURVIVORS.json`, beside `VERDICT.json`. It is committed
  and is NOT under the gitignored `.local/`.
- Shape:
  `{ "version": 1, "judgements": [ { key, file, fn, kind, line_text, triage, justification?, group?, at } ] }`.
  - Entries are sorted by key, so diffs stay small.
  - It is written only through `recordJudgements` (`withLock` plus `atomicWriteJSON`), and the
    vocabulary is `TRIAGES` from `lib/verdict.mjs`.
- There is no entry for an untriaged survivor.
- `equivalent` needs a `oneLine` justification. A test-gap note is optional.
- **Reading is total.**
  - `readJudgements` returns `{ judgements, invalid, reason }`.
  - A hand-edited entry with an unknown triage, or an `equivalent` without a one-line
    justification, lands in `invalid` and is never applied. The count is reported.
  - An unreadable file gives no judgements and a reason (6105).
- `applyJudgements(survivors, judgements)` sets `triage`, `justification` and `judged: true` on a
  survivor whose `key` has an entry. It returns `{ survivors, stale }`. `stale` counts entries
  matching no survivor; the file is never pruned automatically, so a capped run cannot drop a
  judgement (research risk 4).
- **Open** means untriaged or `test-gap`. **Judged** means `equivalent` with a justification.
- **Writer: `ac mutate judge <phase> <id>... (--equivalent "<one line>" | --test-gap ["<note>"]) [--json]`.**
  - An `<id>` is a survivor key `s:…` or a group id `g:…`.
  - The command resolves ids against the LAST FULL kept run's survivors (`readMutateRun`).
    - An unknown id is refused, so a note can never cover a survivor that does not exist yet (C2).
    - A group id expands to one entry per current member, each carrying `group`.
  - It refuses with `die`, before writing anything:
    - both flags, or neither;
    - an empty or multi-line justification;
    - no kept run, or a kept run from before this phase with no keys ("run `ac mutate <n>`
      first").
  - The file is written, NOT committed: `git status` shows it (C3).
  - `ac verdict record` commits it together with `VERDICT.json` (P5), and the human line says
    "commit it, or `ac verdict record` will".

### P4 — Sticky test-strength mark (D1, D2, C9, C10), in `recordVerdict`
- A reported criterion may carry `test_strength: true`. A non-boolean is refused structurally.
- `marked(id)` is true when any of these hold:
  - the id is `[mutation]`-tagged (`testStrengthIds`, unchanged);
  - this verdict declares `test_strength: true`;
  - this verdict carries non-null `mutation` evidence for the id (using the tool's result IS
    using it for test strength, so ce7b holds it even if the verifier forgets the flag);
  - the PRIOR verdict's entry for the id has `test_strength: true`, which makes it sticky.
- Every marked id's entry is written with `test_strength: true`, whether it is reported, carried
  or defaulted to failed. A later verdict therefore cannot drop it.
- The mark lives in the committed per-phase `VERDICT.json`. There is no `roadmap.json` edit, and
  a different phase's same-numbered criterion is untouched.
- It survives a `criteria_sha` change, because the rule is "sticky per phase".
- `mutationGate` runs for `c.passed && marked(id)`. This replaces the ADR-084 tag-only line
  (L361–366).
  - It gives the same gate and the same kept-run binding as `[mutation]`.
  - "No evidence" on a marked criterion is refused as today. The message names "test-strength"
    for a declared or sticky mark and keeps the existing `[mutation]` text for tagged ones.
- **The output gains:**
  - `out.test_strength`: every marked id.
  - `out.mark_kept`: ids the verdict omitted but the sticky rule kept, so a human line can say so.

### P5 — Kept run, partial run, code moved (D4, C6), in `lib/verdict.mjs`
- `mutateRunPaths` gains `partial: <slug>.survivors.json`.
- `saveMutateRun` keeps every phase-47 field and adds:
  - `started_at`;
  - the optional per-survivor fields `key, fn, kind, text_only, group, name, loc, col, line_text,
    replacement, replacement_line`.
  - `matchesRun` and `survivorKey` are UNCHANGED (ADR-083 binding).
- New `savePartialRun` and `readPartialRun` write and read `.partial` only.
- **Gate refusals:**
  - `mutationGate` refuses evidence with `partial: true`, before any binding: "a `--survivors`
    run is a partial re-test, never the recorded verdict — run `ac mutate <n>` and record that".
  - `recordVerdict` refuses a marked criterion's pass when its non-fallback evidence binds to a
    kept run whose `head` differs from HEAD by any change outside `.astrocode/`. This uses the
    same `git diff --name-only <head> HEAD -- . ':(exclude).astrocode'` test as `verifiedGate`,
    and the message is "code changed since the last full `ac mutate` run".
- **Judgements reach the gate (9173: SURVIVORS.json is the one store).**
  - Inside the async `recordVerdict`, `lib/survivors.mjs` is loaded with `await import`. That
    avoids a static import cycle, since survivors imports verdict.
  - Each evidence survivor WITHOUT a triage is matched to its kept-run survivor by `survivorKey`.
    That survivor's `key` gives the judgement, which fills `triage` and `justification` before
    `mutationGate`.
  - An explicit evidence triage wins.
- **The verdict commit** adds `SURVIVORS.json` when it exists:
  `git add -- VERDICT.json SURVIVORS.json`, then a commit limited to those paths. It is still
  unstamped.

### P6 — Flaky pre-check (D5, C7, C8), in `runMutate`
- It runs after the dirty-scope check and before the tool. ONE deadline,
  `deadline = start + cap_seconds*1000`, covers both test runs and the mutation run. The tool's
  `capMs` is `deadline - now`.
- **The command comes from a new row hook, `testRun(ctx)`**, which returns
  `{ argv, env?, failing(out) → names[] }`, or `{ skip: reason }`.
  - **Gremlins:** `go test -count=1 -v <pkg dirs of the chosen tests | ./...> [-run ^(…)$]`.
    `-count=1` defeats Go's test cache, which would otherwise replay the first result. The
    parser reads `--- FAIL: (\S+)`.
  - **mutmut 2/3:** `pytest` from `.venv/bin`, `venv/bin` or PATH, then
    `<files> -p no:cacheprovider -rf -q`. The parser reads `^FAILED (\S+)`, which gives node ids.
  - **Stryker:**
    - The `command` runner (the default, `npm test`, or the config's) runs through `sh -c` with
      the files appended as phase 48 does.
    - `mocha`, `jest`, `vitest` and `tap` run as `node_modules/.bin/<runner> <files>`.
    - Anything else is skipped with a reason.
    - The parser reads TAP `not ok N - name`, the spec reporter's `✖ name`, mocha `N) name` and
      jest `● name`.
  - Unparseable failure output names the command instead (`{ name: null, command }`).
- **Classification:**
  - A test failing in exactly one of the two runs is flaky.
  - A failure in both runs is `baseline_failing`. The tool runs anyway and refuses as it does
    today. This is a `•` line, not a reclassification.
- **Kills a flaky test made are never counted. `res.flaky.kills` says how:**
  - `excluded`: the flaky test is removed from the mutation run, so no kill can come from it.
    - mutmut uses `PYTEST_ADDOPTS += --deselect <nodeid>`.
    - Gremlins uses `GOFLAGS += -skip=^(…)$`.
  - `discounted`: Stryker attributes kills with `killedBy` and `testFiles`. A kill whose every
    `killedBy` maps to a flaky test name becomes `survived` with `flaky_kill: true`.
  - `unverified`: neither is possible (Stryker's `command` runner gives no attribution). The run
    is classified `incomplete` with that reason, so the gate refuses. A kill is never counted on
    trust.
- **Result:** `res.flaky = { checked, runs, command, tests, baseline_failing, kills, reason?, duration_ms }`.
  - A check that cannot run gives `checked: false` and a `reason`, printed as a `•` line. It is
    not a warning, so the existing restricted-PATH suites stay quiet.
  - Never silently skipped.
- **Cap during the check:**
  - The result is `capped: true`, `outcome: 'incomplete'` and
    `cap.step: 'flaky check (tests run twice)'`, and the tool never starts.
  - The existing "cap reached … during <step>" line names it.
  - If no time is left after the check, the cap is hit and named the same way.

### P7 — `ac mutate <n> --survivors` (D4, C5, C6)
- **Base:**
  - It needs a kept full run with keys for the same tool. Otherwise it refuses with an `error`
    outcome, without saving, telling the user to run `ac mutate <n>` first.
  - Open = the kept survivors that are untriaged or `test-gap` after `applyJudgements`. With zero
    open, no tool runs and the output says "no open survivors — record against the last full run".
- **Selection: a new row hook, `buildSurvivors(ctx, open)`.** It is a row capability, not a new
  code path.
  - **mutmut 3:** `mutmut run <exact names…>`, using the names stored on the kept run.
    `narrowed: 'mutants'`.
  - **mutmut 2:** `--paths-to-mutate <files holding open survivors>`. `narrowed: 'files'`, with a
    why saying that mutmut 2 selects whole files only.
  - **Stryker:** `--mutate` with one `file:sl:sc-el:ec` per open survivor, from the stored `loc`.
    `narrowed: 'mutant spans'`. Transcribed CLI.
  - **Gremlins**, the narrowest available means in the order t6 confirms against real 0.6:
    1. `--diff <base>`, where `<base>` is a dangling commit built with plumbing only
       (`hash-object -w`, a temp `GIT_INDEX_FILE` under `.astrocode/.local/`, `write-tree`,
       `commit-tree`). Its tree is HEAD with each open survivor's line blanked, so the diff to
       HEAD is exactly those lines. No ref, index, HEAD or working-tree change; t11 tests this
       byte-for-byte.
    2. `-E ^file$` for every tracked `.go` file holding no open survivor.
    3. `--<type-flag>=false` for each mutant type no open survivor has, and `=true` for a
       non-default type one does.
    - `narrowed` is `'lines+kinds'`.
    - If step 1 fails, or t6 shows Gremlins does not honour it, the run falls back to files plus
      kinds with `narrowed: 'files+kinds'`. The why then says killed mutants of those kinds in
      those files re-ran too.
- **After the run:**
  - Every parsed mutant is described (P1) and matched by key to the open set.
  - `res.rerun = { open, executed, killed_now, still_open, not_reobserved, extra_executed, narrowing }`.
    - `executed` counts in-scope mutants the tool actually ran.
    - `extra_executed` counts non-open ones it also ran, such as same-span Stryker siblings or a
      Gremlins fallback. It is always reported and never hidden.
- **Recording and display:**
  - It saves with `savePartialRun` only. `.run` is never touched.
  - The result carries `partial: true` and `base_run: { head, started_at }`.
  - The human output shows the full run's groups with the re-test statuses overlaid, under a
    leading line: `partial re-run on top of the full run <sha7> (<time>) — not a recordable verdict; final: ac mutate <n>`.
  - A full run deletes a stale partial file.
- The flaky check runs here too, before mutating.

### P8 — Gremlins version (debt, C12)
- When `row.parseVersion` gives null and the row has a `binaryVersion` hook, the probe reads the
  resolved binary's embedded Go build info in-process.
  - It searches the file bytes for `\tmod\t<path ending /gremlins>\t(v[^\t\n]+)`, the `mod` line
    and never a `dep` line, the same text `go version -m` prints.
  - `(devel)` gives null. A read error gives null and a warning (b940).
- This spawns nothing, so the P5 "never spawns go" header stays literally true for lookup. It was
  checked while planning: `/data/bin/gremlins` holds `mod github.com/go-gremlins/gremlins v0.6.0`,
  equal to `go version -m`.
- A binary whose `--version` gives a number keeps that number, and the build info is not read.
- The P5 header is amended for P6 only. The flaky check runs the project's own test runner
  (`go test`, `pytest`, the Stryker test command), at the same trust level as the tool's own run
  (P8 hygiene). Lookup still never spawns a package manager.

### P9 — Fallback wording (debt, C13)
- Each fallback object gains `ai_mutants` (boolean) and `report` (a ready one-line sentence),
  set at the fallback sites in `runMutate` from ONE table in `lib/mutate.mjs`, `FALLBACK_REPORTS`.
  - `tool-missing` and `no-tool`: `ai_mutants: true`, and "AI mutants stood in: <reason>".
  - `no-scope` with no tool installed: `ai_mutants: true`.
  - `no-scope` caused by `mutation.exclude`: `ai_mutants: false`, and "no mutants were run:
    <reason>".
  - `no-scope` with the tool installed: `ai_mutants: false`.
- The reason strings stay byte-identical, because tests pin them.
- `/astro-verify` prints `fallback.report` verbatim. Its fixed "(AI mutants stood in)" goes.

**Exit codes:** unchanged. 0 for every reported outcome; `die` only for usage errors and
refused judgements.

## Test strategy (ADR-018)

- **Test-first inside each task.** Each task writes its tests, sees them fail, then implements,
  all in ONE commit. No red commit lands at a wave boundary (ADR-020).
- **New symbols are reached with `const { x } = await import('../lib/…')` inside async test
  bodies, never a static import.**
  - This covers the new modules `funcscan` and `survivors`.
  - It also covers new exports: `oneLine`, `savePartialRun`, `readPartialRun`, `describeMutant`,
    `groupSurvivors`, `isTextOnly`, `literalOnlyChange`, `diffKind`, `readJudgements`,
    `recordJudgements`, `applyJudgements`, `FALLBACK_REPORTS`, `goBuildInfoVersion` and
    `classifyFlaky`.
  - Existing static imports stay as they are.
- **Test-after, chosen explicitly:**
  - t12, the real-tool test, exercises finished behaviour, so it depends on t11 and t9.
  - t13 and t14 depend on the final interfaces they describe.
- **No real tool in the default suite.**
  - Use the stub (`tests/fixtures/mutate/stub.mjs`), extended in t5 to emulate `go test` and
    `pytest`.
  - JS flaky tests use real `node --test` through a Stryker `command` runner config.
  - Use fixture reports and `restrictedEnv`.
- **Real tools are used in two places only:**
  - t6 captures into `tests/fixtures/mutate/real/`;
  - t12's opt-in `AC_MUTATE_REAL=1` test.

## Wave shape

| wave | tasks | why |
|---|---|---|
| 1 | t1 t2 t3 t4 t5 t6 | disjoint files: function spans, parsers, verdict, mutate debt, stub, captures |
| 2 | t7 t8 | t7 `lib/survivors.mjs` (needs t1, t3); t8 flaky check starts the `mutate.mjs`/`bin` chain (needs t2, t4, t5, t6) |
| 3 | t9 t10 | t9 verdict overlay + commit (`verdict.mjs`, after t3); t10 groups, judgements, `ac mutate judge` (`mutate.mjs`/`bin`, after t8) |
| 4 | t11 | `--survivors` (`mutate.mjs`/`bin`, after t10) |
| 5 | t12 t13 | real-tool opt-in test; verifier and command text |
| 6 | t14 | MANUAL, CHANGELOG, debt drops, full-suite gate |

**File ownership chains:**
- `lib/mutate.mjs` and `bin/ac.mjs`: t4 → t8 → t10 → t11.
- `lib/verdict.mjs`, `tests/verdict.test.mjs`: t3 → t9.
- `tests/mutate.test.mjs`: t4 → t8.
- `tests/mutate_cli.test.mjs`: t8 → t10.
- `tests/fixtures/mutate/real/VERSIONS.json`: t6 → t12.
- `tests/fixtures/mutate/stub.mjs`: t5 only.

## Tasks

### t1 — `lib/funcscan.mjs`: Go and JS/TS function spans
- **id:** t1
- **file:** `lib/funcscan.mjs` (new), `tests/funcscan.test.mjs` (new)
- **depends_on:** []
- **Tests first** (`await import`):
  - `goFunctions(text)` returns `[{ qual, start, end }]`:
    - `func F(` gives `F`, and `func (r *T) M(` gives `T.M`;
    - a span runs from the `func` line to the column-0 `}`;
    - a `func` inside a raw string or comment is ignored;
    - a function literal inside `F` folds into `F`.
  - `jsFunctions(text)` covers:
    - `function f(`, `async function`, `export function`, and `export default function g(`;
    - `const f = (…) =>` and `const f = function`;
    - class methods as `K.m`, including `async`, `static`, `get` and TS-typed `m(a: T): R {`;
    - nested arrows, which fold into the enclosing named function;
    - braces inside strings, template literals and comments, which do not shift spans;
    - CRLF input.
  - `enclosingFunction(file, text, line)` dispatches by extension: `.go`, JS/TS, and `.py`
    through `pythonFunctions` plus `functionAt`. It returns the innermost named qual, or null at
    top level or for an unknown extension.
- **Implement:**
  - Pure, total line and brace scanners with no deps, in the `pyscan` style.
  - Header comment: why grouping needs a function (D6), and why it is a mechanical scan, never
    a parse claim (333f). A wrong span only regroups; it never decides a verdict.

### t2 — `lib/mutparse.mjs`: carry replacement, location, column and killedBy
- **id:** t2
- **file:** `lib/mutparse.mjs`, `tests/mutparse.test.mjs`, `tests/fixtures/mutate/stryker-triage.json` (new), `tests/fixtures/mutate/gremlins-triage.json` (new)
- **depends_on:** []
- **Tests first:**
  - `parseStryker` on `stryker-triage.json` gives each mutant
    `replacement`, `loc: { start: {line, column}, end: {line, column} }`, `col` (the start column)
    and `killedBy` (an array of test NAMES resolved through the report's `testFiles[].tests[]`).
    - Survivors sit in two functions, there are two `StringLiteral` survivors plus logic ones,
      and kills carry `killedBy`.
  - `parseGremlins` on `gremlins-triage.json` gives `col`.
  - `parseMutmutResults` output is unchanged.
  - The existing fixtures parse byte-identically on all old fields (regression).
  - `normalize` passes the new optional fields through only when present.
  - `writeFullList` input is unchanged.
- **Implement:**
  - Extend `mapped()` in `normalize` and the two parsers.
  - The fixtures use the real mutation-testing-elements and Gremlins shapes.
  - The comment notes that Stryker's `id` and Gremlins' index are run-local, which is why
    identity moves to `lib/survivors.mjs`.

### t3 — `lib/verdict.mjs`: sticky test-strength mark, partial runs, code-moved refusal, richer kept run
- **id:** t3
- **file:** `lib/verdict.mjs`, `tests/verdict.test.mjs`, `tests/verdict_cli.test.mjs`
- **depends_on:** []
- **Tests first** (real tmp repo; new exports through `await import`):
  - **C9:** an UNTAGGED criterion `{ passed: true, test_strength: true, mutation }` is gated
    exactly as a tagged one:
    - (a) an open survivor (untriaged, or `test-gap`) is refused;
    - (b) evidence bound to a run other than the kept run is refused;
    - (c) all survivors killed or justified is accepted.
    - The tagged-criterion cases from phases 47 and 48 pass unchanged.
  - Mutation evidence with no `test_strength` flag also marks the criterion. The phase-48
    "untagged evidence is never gated" tests are updated to the D1 rule in this task.
  - **C10:**
    - After (c), a second verdict passing the same id with no flag and an open survivor is
      refused, and `out.mark_kept` names the id.
    - A verdict that omits the id entirely (a narrowed run) carries `test_strength: true` on the
      carried entry.
    - A third verdict with no evidence at all is refused ("no evidence").
    - The mark survives a CRITERIA.md edit.
    - A second phase's `C3` is unaffected.
    - `roadmap.json` is byte-identical.
  - `test_strength: "yes"` is refused structurally.
  - **C6:** evidence with `partial: true` is refused, naming `ac mutate <n>`.
  - A kept run at sha A, followed by a source commit B, then recording, is refused ("code
    changed since…"). A `.astrocode/`-only commit after A is accepted.
  - `saveMutateRun` keeps the new optional survivor fields and `started_at`. `matchesRun`
    behaviour is unchanged (existing binding tests).
  - `savePartialRun` and `readPartialRun` round-trip to `<slug>.survivors.json`, and `.json` is
    byte-identical after.
  - `oneLine` is exported.
- **Implement:** P4 and P5, without the judgements overlay and the SURVIVORS.json commit, which
  are t9.
  - `readVerdict` accepts the boolean `test_strength` on entries; `version` stays 1, since the
    field is additive.
  - Rewrite the module header paragraph for ADR-085: one gate, four ways in, sticky.

### t4 — `lib/mutate.mjs`: Gremlins version from the binary, fallback wording from the reason
- **id:** t4
- **file:** `lib/mutate.mjs`, `tests/mutate.test.mjs`
- **depends_on:** []
- **Tests first** (`await import` for `goBuildInfoVersion` and `FALLBACK_REPORTS`):
  - `goBuildInfoVersion(file)` handles these cases:
    - a temp file holding `…\tpath\tgithub.com/go-gremlins/gremlins/cmd/gremlins\n\tmod\tgithub.com/go-gremlins/gremlins\tv0.6.0\th1:…\n\tdep\tgithub.com/x/gremlins\tv9.9.9\n…`
      gives `v0.6.0`, never the `dep` line;
    - `(devel)` gives null;
    - a missing file gives null.
  - A Gremlins stub with `MUTATE_STUB_VERSION='gremlins version dev linux/arm64'`, whose copied
    binary has the `mod` line appended as a comment, gives `res.tool.version` `v0.6.0`.
  - The same stub printing `gremlins version 0.5.0` keeps `0.5.0`.
  - **C13:** each fallback site sets `ai_mutants` and `report`:
    - `tool-missing` and `no-tool`: true, and the report contains "AI mutants stood in";
    - `no-scope` by `mutation.exclude`: false, and the report contains "no mutants were run";
    - `no-scope` with the tool installed: false;
    - `no-scope` with no tool installed: true.
  - The existing reason strings are byte-identical.
- **Implement:** P8 (a `binaryVersion` row hook on Gremlins, a probe fallback) and P9
  (`FALLBACK_REPORTS`). Amend the P5 header comment per P8.

### t5 — Stub: emulate `go test` and `pytest` for the flaky check
- **id:** t5
- **file:** `tests/fixtures/mutate/stub.mjs`, `tests/fixtures/mutate/project.mjs`
- **depends_on:** []
- **Implement (test infrastructure; the check is that the existing suites stay green):**
  - When copied as `go` (with argv `test …`) or as `pytest`, the stub logs argv and env as today.
  - It prints passing output by default.
  - `MUTATE_STUB_FLAKY=<counterfile>:<name>` fails `<name>` on odd-numbered invocations:
    - as `go`, it prints `--- FAIL: <name>` and exits 1;
    - as `pytest`, it prints `FAILED <name>` and exits 1.
  - `MUTATE_STUB_BROKEN=<name>` fails it on every invocation.
  - `MUTATE_STUB_TEST_SLEEP=<s>` sleeps per invocation, for the cap tests.
  - `project.mjs` gains `installRunner(dir, name)` (the stub under `go` or `pytest`) and
    `jsFlakyProject()`. The latter writes a Stryker command-runner config `node --test` and a
    `tests/a.test.mjs` with a stable test plus one that toggles a counter file in the project's
    `.astrocode/.local/`.
  - Existing knobs and defaults are unchanged.

### t6 — Real-tool captures for re-run selection, flaky runners and version (de-risks P6, P7, P8)
- **id:** t6
- **file:** `tests/fixtures/mutate/real/VERSIONS.json`, `tests/fixtures/mutate/real/gremlins-survivors-rerun.txt` (new), `tests/fixtures/mutate/real/mutmut3-names-rerun.txt` (new), `tests/fixtures/mutate/real/go-test-fail.txt` (new), `tests/fixtures/mutate/real/pytest-fail.txt` (new), `tests/fixtures/mutate/real/gremlins-buildinfo.txt` (new), `tests/fixtures/mutate/real/stryker-cli-documented.txt`
- **depends_on:** []
- **Do, in this container, on scratch projects under the scratchpad.** Use no network installs,
  and wrap each call in `timeout 120`.
  - **Gremlins 0.6:**
    1. On a two-function Go module with a phase diff, make a dangling plumbing commit with one
       line blanked (P7.1).
    2. Run `unleash --diff <that sha> -o out.json` and record which mutants ran.
    3. Record whether `--<type>=false` and `-E` narrow further.
    4. Save the output to `gremlins-survivors-rerun.txt`.
    - Record the build info: the output of `go version -m /data/bin/gremlins` and the `--version`
      line, in `gremlins-buildinfo.txt`.
  - **mutmut 3.8:**
    1. Run `mutmut run <exact name> <exact name>` on the existing scratch layout.
    2. Run `results --all true`, which should show only those as checked.
    3. Save both to `mutmut3-names-rerun.txt`.
    - Record what a show diff looks like for a string mutant (the `XX…XX` wrap) and for an
      operator mutant.
  - **Runners:**
    - `go test -count=1 -v` with one failing test goes to `go-test-fail.txt`.
    - Record whether `-skip=^(TestX)$` works through `GOFLAGS`.
    - `pytest -p no:cacheprovider -rf -q` with one failure goes to `pytest-fail.txt`, if pytest
      is installed beside mutmut. Record whether `PYTEST_ADDOPTS=--deselect <nodeid>` drops it.
  - **Stryker (transcribed, not installed):** append to `stryker-cli-documented.txt`:
    - the `file:L:C-L:C` column-range form;
    - the `killedBy` and `testFiles` report fields;
    - that the `command` runner gives no per-test attribution.
  - `VERSIONS.json`: Gremlins `version` becomes `v0.6.0 (from build info; --version prints dev)`.
    Add one `notes` line per finding, saying plainly which selection mechanism worked. t8 and t11
    implement the mechanisms recorded here.

### t7 — `lib/survivors.mjs`: identity key, text-only, groups, judgements file
- **id:** t7
- **file:** `lib/survivors.mjs` (new), `tests/survivors.test.mjs` (new)
- **depends_on:** [t1, t3]
- **Tests first** (`await import`; real tmp dirs):
  - **`describeMutant` / key (C4):**
    - Inserting 5 lines above the function keeps the key.
    - Re-indenting the line keeps it.
    - Editing the mutated line changes it.
    - The same line with two columns or two replacements gives two keys.
    - Moving the line into another function changes it.
    - A tool with neither column nor replacement uses the all-mutants ordinal, and a killed
      sibling does not shift it.
    - The line number appears in no key input.
  - **`isTextOnly`:**
    - Stryker `StringLiteral` is text-only.
    - mutmut `return "bad"` to `return "XXbadXX"` is text-only (`literalOnlyChange`).
    - `if x > "a"` to `if x >= "a"` is not.
    - Gremlins never is.
  - **`diffKind`:** `if x > 10:` to `if x >= 10:` gives `` `>` → `>=` ``.
  - **`groupSurvivors` (C1):**
    - The fixture has two functions, two kinds and two text-only survivors in different functions.
    - Exactly one `g:text-only` group holds both text-only survivors.
    - No text-only survivor sits in a logic group.
    - The counts sum to the total and the ids are deterministic.
  - **`recordJudgements` and `readJudgements` (C2, C3):**
    - A group id expands to explicit per-key entries.
    - An unknown id is refused.
    - `equivalent` with `''` or a newline is refused.
    - The file sorts by key and holds no untriaged entries.
    - A hand-edited invalid entry lands in `invalid` and is never applied.
    - A corrupt file gives no judgements and a reason, with no throw.
    - The path is inside the phase folder and `git check-ignore` exits non-zero in a repo created
      by `initPlanning`.
  - **`applyJudgements`:**
    - A new survivor added after a group note stays open.
    - `stale` counts entries matching no survivor, and nothing is pruned.
    - `test-gap` counts as recorded but open.
- **Implement:** P1–P3.
  - The module statically imports `TRIAGES`, `oneLine` and `readMutateRun` from
    `lib/verdict.mjs`. verdict loads this module only through `await import`, so there is no
    static cycle.
  - The header says why the key is not the line number, and why there is no auto-equivalent.

### t8 — Flaky pre-check inside the one cap (D5, C7, C8)
- **id:** t8
- **file:** `lib/mutate.mjs`, `bin/ac.mjs`, `tests/mutate_flaky.test.mjs` (new), `tests/mutate.test.mjs`, `tests/mutate_cli.test.mjs`
- **depends_on:** [t2, t4, t5, t6]
- **Tests first** (`await import` for `classifyFlaky`):
  - `classifyFlaky(run1, run2)`:
    - fails `{A}` then passes gives flaky `[A]`;
    - fails `{A}` twice gives `baseline_failing [A]`;
    - unparseable failure output gives `{ name: null, command }`.
  - **JS:** `jsFlakyProject` with a stub Stryker report whose kills carry `killedBy` of the flaky
    test.
    - `res.flaky.tests` names it, and `kills: 'discounted'`.
    - Those kills become `survived` with `flaky_kill`, and the counts reflect that.
    - Without `killedBy` the result is `kills: 'unverified'` and the outcome is `incomplete`.
    - With the flaky test removed, nothing is flaky and the counts are unchanged from the stub
      report.
  - **Go and Python** (t5 runner stubs):
    - Gremlins' argv env carries `GOFLAGS … -skip=^(TestFlaky)$`, and `kills: 'excluded'`.
    - mutmut's carries `PYTEST_ADDOPTS … --deselect tests/test_a.py::test_flaky`.
    - `go test` argv contains `-count=1`.
  - **C8:**
    - The runners sleep 2 s each against a 3 s cap.
    - Wall time is at most cap + 1.5 s, and the result is `capped`/`incomplete` with
      `cap.step === 'flaky check (tests run twice)'`.
    - The tool stub never ran (no `unleash` entry in its log).
    - The human line says "during flaky check (tests run twice)".
    - With a 60 s cap, the check completes and the tool runs with `capMs` reduced by the
      check's time (assert through the stub's logged start time).
  - With no runner reachable (`restrictedEnv`):
    - `res.flaky.checked === false` with a reason;
    - the existing tests in `tests/mutate*.test.mjs` pass unchanged, and are updated here only if
      a pinned line moves.
- **Implement:**
  - P6: the `testRun` row hooks, the shared deadline, a cap step name, and env merging with the
    phase-48 `narrow.env`.
  - `bin/ac.mjs` human output: one line after `tests:`.
    - `• flaky check: stable (2 runs, <s>s)`; or
    - `⚠ flaky: <≤5 names>[, +N] — kills <excluded from the mutation run|discounted by the report's attribution|unverified: run marked incomplete>`; or
    - `• flaky check not run: <reason>`.
- Test-first; one commit.

### t9 — Judgements reach the gate; the verdict commit carries SURVIVORS.json
- **id:** t9
- **file:** `lib/verdict.mjs`, `tests/verdict.test.mjs`
- **depends_on:** [t3, t7]
- **Tests first:**
  - A kept run, saved through `saveMutateRun`, holds survivors with keys.
  - `recordJudgements` marks one `equivalent` with a justification.
  - Evidence copied without triage for that survivor and with `triage: 'equivalent'` + a
    justification for the others is accepted, because the triage is filled from SURVIVORS.json.
  - An explicit evidence `test-gap` beats a file `equivalent` and is refused.
  - A survivor with no judgement and no evidence triage is refused as untriaged.
  - After `recordVerdict`, `git show --stat HEAD` lists both `VERDICT.json` and `SURVIVORS.json`,
    and the message has no `(phase NN t…)` stamp.
  - With no SURVIVORS.json, the commit holds `VERDICT.json` alone, as before.
- **Implement:** the P5 overlay through `await import('./survivors.mjs')` and the path-limited
  two-file commit. The comment says why the overlay is dynamic: survivors imports verdict.

### t10 — `ac mutate`: grouped survivors, carried judgements, `ac mutate judge` (D3, D6, C1–C4)
- **id:** t10
- **file:** `lib/mutate.mjs`, `bin/ac.mjs`, `tests/mutate_triage.test.mjs` (new), `tests/mutate_cli.test.mjs`
- **depends_on:** [t2, t3, t7, t8]
- **Tests first** (stub tools and t2's triage fixtures; real tmp repo whose source files hold real
  lines at the fixture's mutant lines):
  - **C1:**
    - `ac mutate 1 --json` gives `survivors[]` each with `key, fn, kind, text_only, group`.
    - `groups[]`: the two text-only survivors are in `g:text-only` only, logic survivors sit by
      `(file, fn, kind)`, every survivor is in exactly one group, and the counts sum to
      `survivors.length`.
    - The human output prints group headers, not a flat list.
    - With 30 groups, it prints 20 and "+10 more groups — ac mutate 1 --json".
  - **C2:**
    - Before any judgement, `triage.judged === 0` and no survivor has `judged`.
    - `ac mutate judge 1 g:text-only --equivalent "user-facing text only; not asserted by design"`
      covers both text-only survivors, and logic survivors stay open.
    - A new string-literal survivor in a later fixture is open.
    - `--equivalent ""` exits non-zero and writes nothing.
    - An unknown `s:…` is refused.
    - Both flags at once are refused.
  - **C3:**
    - `git check-ignore` of the file exits non-zero and `git status --porcelain` lists it.
    - After `git commit` and `git clone`, the clone's `ac mutate 1 --json` shows the same triage
      and justification, `triage.open = total − judged`.
    - The human output separates `judged (SURVIVORS.json): N equivalent` from
      `open: M (K test-gap, J untriaged)`.
  - **C4:**
    - Rewrite the source with 3 lines inserted above (the stub report shifted to match), and the
      judgement still applies.
    - Edit the judged line, and that one survivor re-opens while the others keep their
      judgements.
  - mutmut 3: `mapMutmutLines` keeps the show diff's `+` line as `replacement_line`, and
    `kind`/`text_only` come from it.
  - `saveMutateRun` stores the keys, the `.run` fields the gate binds to are unchanged, and the
    phase-47/48 binding tests stay green.
- **Implement:**
  - In `runMutate`, after parsing:
    1. Read the scoped files at HEAD once.
    2. Describe the survivors, plus all parsed mutants for the ordinal.
    3. Apply the judgements and group the survivors.
    4. Set `res.groups` and
       `res.triage = { file, judged, equivalent, test_gap, open, stale, invalid }`.
  - Rows gain `textKinds` (Stryker `['StringLiteral']`).
  - The `bin/ac.mjs` `case 'mutate'` sub-command `judge`:
    - `ALLOWED_FLAGS 'mutate judge': ['equivalent','test-gap','json']`;
    - the usage and `die` strings;
    - one help line: `ac mutate judge <phase> <s:key|g:group>... --equivalent "<why>" | --test-gap ["<note>"]`.
  - The human survivor block replaces the flat loop (L2674). It leads with one line:
    `survivors: N in G groups — J judged, O open`. Then come open groups only, each as
    `⚠ <file> · <fn|(outside any function)> · <kind> — <open> open [<id>]` with at most 3 members
    as `line key`. Then `+N more groups — ac mutate <n> --json`.
- Test-first; one commit.

### t11 — `ac mutate <n> --survivors`: re-test only open survivors, never recordable (D4, C5, C6)
- **id:** t11
- **file:** `lib/mutate.mjs`, `bin/ac.mjs`, `tests/mutate_survivors.test.mjs` (new)
- **depends_on:** [t6, t9, t10]
- **Tests first** (stubs; argv from `MUTATE_STUB_LOG`):
  - **C5:** a full run, then judge one `equivalent` and one `test-gap`, leaving one untriaged.
    - mutmut 3 argv is `run` plus exactly the test-gap and untriaged names.
    - mutmut 2 argv is `--paths-to-mutate` with only the files holding open survivors, and
      `narrowed: 'files'` with its why.
    - Stryker `--mutate` holds exactly the open survivors' `file:L:C-L:C` spans.
    - Gremlins:
      - the `--diff` sha is not a ref, and `git rev-parse HEAD`, `git status --porcelain`,
        `.git/index` bytes and `git for-each-ref` are identical before and after;
      - `-E` covers every other `.go` file;
      - the type flags are disabled for kinds with no open survivor;
      - `narrowing.why` is present, and the fallback path's why says killed mutants re-ran.
    - `rerun.executed` is less than the full run's mutant count.
    - `rerun.extra_executed` is reported, even when 0.
  - **C6:**
    - `.astrocode/.local/mutate-runs/<slug>.json` is byte-identical after `--survivors`, and
      `<slug>.survivors.json` exists.
    - `res.partial === true`.
    - The human output leads with "partial re-run on top of the full run <sha7>".
    - `ac verdict record` with that output as evidence on a test-strength criterion is refused.
    - A fresh full run, with the formerly open survivor now killed and the rest judged, records
      a pass.
    - A full run deletes the partial file.
  - No kept run: `--survivors` gives an error naming `ac mutate <n>`, with no save.
  - Zero open: no tool spawn, and the "no open survivors" line.
  - The flaky check runs before the re-test.
- **Implement:**
  - P7: the `buildSurvivors` row hooks, the Gremlins plumbing base with its fallback, key
    matching, `res.rerun`, `savePartialRun`, and deleting the partial file on a full run.
  - In `bin/ac.mjs`, `--survivors` is added to `ALLOWED_FLAGS 'mutate'`, the usage strings and
    help text; the human output is the overlaid group block under the partial line.
- Test-first; one commit.

### t12 — Real-tool opt-in test for triage, `--survivors`, flaky and version
- **id:** t12
- **file:** `tests/mutate_real.test.mjs`, `tests/fixtures/mutate/real/VERSIONS.json`
- **depends_on:** [t9, t11]
- **Test-after (explicit):** skipped unless `AC_MUTATE_REAL=1`.
- **On real mutmut 3.8 and Gremlins 0.6, in a scratch project:**
  1. Run a full run with two functions and a string-literal change.
  2. Check the groups, including a text-only group for mutmut.
  3. Judge, then re-run, and check the judgements carry over.
  4. Insert lines above the function; the judgement holds.
  5. Run `--survivors`; it runs only the open mutants, per the tool's own report and log.
  6. Run with a flaky test (toggle file); it is named.
  7. Check the Gremlins `tool.version` equals the `go version -m` module version.
- Run it once here and record the results in `VERSIONS.json` `real_runs` (date, result, notes).
  Stryker and mutmut 2 are "not run: not installed".

### t13 — Verifier, criteria-author and command text match ADR-085 (C11, C13)
- **id:** t13
- **file:** `agents/astro-verifier.md`, `agents/astro-criteria-author.md`, `commands/astro-verify.md`, `commands/astro-mutate.md`, `tests/mutate_agents.test.mjs`, `tests/commands.test.mjs`
- **depends_on:** [t4, t9, t11]
- **Tests first** (`tests/mutate_agents.test.mjs`):
  - The verifier text tells it to:
    - set `test_strength: true` on every criterion it uses `ac mutate` for, tagged or not;
    - start from `triage` in `ac mutate --json` (SURVIVORS.json) and judge only open survivors;
    - record judgements with `ac mutate judge`;
    - use `--survivors` for fix rounds and record only a full run;
    - read `flaky`.
  - No file says only `[mutation]`-tagged criteria get the code bar.
  - `commands/astro-verify.md` prints `fallback.report` verbatim, and the fixed "(AI mutants
    stood in)" is gone.
  - `commands/astro-mutate.md` names `judge` and `--survivors`.
  - `tests/commands.test.mjs` still passes; every touched reporting slot states a bound.
- **Implement:**
  - Rewrite verifier item 5 (L146) and the mutation section.
  - Criteria-author: an untagged test-strength criterion still gets the bar once the verifier
    marks it; the tag stays a way to pre-commit.
  - `/astro-verify` step 3: "at most one line: `fallback.report`".
  - `/astro-mutate`: the judge and re-run lines.
  - All cite `lib/survivors.mjs` and `lib/verdict.mjs` as the rules' home and never restate the
    key rule.

### t14 — MANUAL, CHANGELOG, debt closed, full suite green (C14)
- **id:** t14
- **file:** `MANUAL.md`, `CHANGELOG.md`, `tests/mutate_docs.test.mjs`, `.astrocode/debt.json`
- **depends_on:** [t8, t12, t13]
- **Tests first** (`tests/mutate_docs.test.mjs`), a phase-49 test that the MANUAL names:
  - `SURVIVORS.json` and `ac mutate judge`;
  - what re-opens a judgement;
  - `--survivors` and "not a recordable verdict";
  - the flaky check and that it shares the cap;
  - `test_strength`, and that it is sticky;
  - that Gremlins has no text-only kind.
  - It also checks that the MANUAL no longer says "The tag is the only **code** gate", and that
    CHANGELOG Unreleased has a phase-49 bullet.
- **Implement:**
  - In the MANUAL "Mutation testing" section, replace the tag-only paragraphs. Add short
    subsections: "Judging survivors", "Fix rounds: `--survivors`", "Flaky tests", and "Which
    criteria get the bar". Each points at the CLI, not at code.
  - Add one CHANGELOG bullet in the house style.
  - Close the folded debt through the CLI, never by hand:
    `ac debt drop 2026-10-22-gremlins-installed-via-go-install --reason "phase 49 t4: version read from the binary's build info"`
    and `ac debt drop 2026-10-22-astro-verify-fallback-line-glosses --reason "phase 49 t4/t13: worded from fallback.report"`.
    Use the exact ids from `ac debt list`.
- **Final gate, in this task:** `node --test` over the repo gives zero failures before the commit.
