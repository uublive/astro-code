# Plan: phase 51, verifier calibration (`ac verify calibrate`)

This plan follows `.astrocode/CONVENTIONS.md`:
- Node ≥22 ESM `.mjs`, zero dependencies, `node:` builtins plus the git CLI.
- Named function exports only, and one responsibility per `lib/` module. `bin/ac.mjs` stays a thin dispatcher.
- `die()` for fatal CLI errors. `✓ • ⚠ ⊡` glyphs and `json()`.
- A `node:test` test for every `lib/` change, run against a real filesystem and real git, with no mock framework.
- Module headers say *why*. Every reporting slot states a bound (§Voice).

It follows `DECISIONS.in-force.md`. The decisions that matter here:
- ADR-006: only a human accepts. Calibration never writes `verified` or `accepted`, `VERDICT.json`, `SURVIVORS.json`, the roadmap or state.
- ADR-018: RED tests use dynamic import.
- ADR-020: every wave compiles.
- ADR-021/022/079: the verifier contract, plan-blind and full.
- ADR-029: the per-verb flag allowlist.
- ADR-076: scratch repos live under `os.tmpdir()` and carry `.git/astrocode-scratch`.
- ADR-083/084/085: `ac mutate` is the deterministic source, and survivors are judged by a human or the verifier.
- ADR-087: the decision number is claimed by `ac decision add`.

It also follows CONTEXT.md D1 to D6 and aims at every criterion C1 to C12 in CRITERIA.md.

Principles applied (`ac principles brief --stage plan`, cited):
- **9173:** one source for each rule.
  - The verifier contract is read from `commands/astro-verify.md`, never copied.
  - The mutant identity comes from `lib/survivors.mjs`, and the stamp and status reads use the existing modules.
  - The planting fields are produced only by `ac mutate`.
- **333f:** selection, planting, statistics, the bill, the budget and the log are code. Only the verdict is the model's.
- **ce7b:** blindness is checked in code before every trial, not only asked for in prose.
- **b940:** no kept run, Gremlins, no `claude` on PATH and no accepted phases each fail soft with a visible reason.
- **5116:** `--yes` is the consent gate, and nothing prompts.
- **1a0d:** calibration proposes nothing and promotes nothing.
- **2310:** `/astro-calibrate`.
- **e618:** the report leads with the two rates and is bounded.
- **1f10:** the tool is read from the kept run, and the detected tool is reported when there is none.

## Decisions this plan pins (CONTEXT "Open / for the planner", plus gaps)

**P1. The defect source is this machine's kept `ac mutate` runs, and the full list gains each mutant's exact change.**
- **What calibrate reads, per accepted phase:**
  - `mutateRunPaths(root, slug).run`, for `head` and `tool`.
  - `mutateRunPaths(root, slug).list` (`<slug>.mutants.jsonl`), for every mutant and its status.
  - The phase's committed `SURVIVORS.json`.
- **t1 extends each in-scope list line** (`writeFullList`) beyond today's `{file,line,mutator,status,id,scope}`:
  - Always: `key`, `fn`, `kind`, from `describeRun`/`describeAll`, the one identity rule.
  - **mutmut:** `line_text` (raw original line), `replacement_line` (raw mutated line), and `exact: true` only when the change came from the generated `mutants/<file>` AND touches exactly one line (same function length, one differing line). Changes from `mutmut show` or multi-line changes carry `exact: false`.
  - **Stryker:** `replacement` and `loc: {start:{line,column}, end:{line,column}}`, exactly as the report gives them (1-based line and column, `end` exclusive).
  - Gremlins lines are unchanged (it has no patch).
- **How `exact` is computed:** `mutantsFileChanges` gains a third top-level map `multi` (`{ name: true }` for multi-line changes) beside `offsets` and `changes`. The existing `changes` entries keep their shape, so `tests/mutate_rerun_exact.test.mjs` stays green unedited.
- **A kept list without these fields** (written before this phase) yields no candidates. It is reported as the shortfall reason `kept list predates calibration — run \`ac mutate <n>\` again`.
- **Why not re-run the tool inside calibrate:** it is expensive, it needs the tool, and it would grade a different commit. Why not committed data: killed mutants are not committed anywhere, and adding a committed mutant list is churn. The kept run is the honest source; a missing one is a shortfall, never a guess (D6).

**P2. The accepted phases are every roadmap entry with `status: "complete"`.**
- **Where they are read:** the live `.astrocode/roadmap.json` plus every `.astrocode/milestones/<n>/roadmap.json` snapshot, which includes archived milestones.
- **Phase directory:** `milestones/<n>/phases/<slug>/` for an archived entry when it exists, else `.astrocode/phases/<slug>/`.
- **The bar** is that directory's `CRITERIA.md`. A phase whose CRITERIA.md has no `C<n>` id (`parseCriteriaIds`) is skipped with the reason `no CRITERIA.md`.
- **The judgements** are that directory's `SURVIVORS.json`, read via `readJudgements`.
- **The goal** handed to the verifier is the roadmap entry's `name`, which is what `/astro-verify` resolves from the roadmap.
- **No mapping of defects to criteria (CONTEXT open item 3).** Each trial records the C-ids the verifier failed (`failed_ids`) in `--json` only. Mapping a defect to "the criterion it should fail" would be a judgement of meaning (333f).

**P3. Candidate rules, all exact, never padded (D1, D4, D6).**
- **EASY:** list lines with `scope: "in"` and `status: "killed"` only. `timeout`, `error` and `no-coverage` are not clean test-killed bugs, and a timeout mutant can hang the verifier's suite.
- **HARD:** list lines with `scope: "in"`, status in `SURVIVOR_STATUSES`, and a `key` judged `test-gap` in that phase's SURVIVORS.json. `equivalent` and unjudged survivors are never drawn.
- **Plantable means all three of these hold:**
  - (a) the run's `head` resolves in the repo, and `git diff --quiet <head> HEAD -- <file>` holds, so the file has not drifted since the tool graded it;
  - (b) mutmut: `exact: true`, and the HEAD file's line `line` trimmed equals `line_text` trimmed;
  - (c) Stryker: `replacement` is a string and `loc` lies inside the HEAD file.
- **Gremlins:** a kept run with `tool: "gremlins"` contributes nothing and adds `unsupported: gremlins (it reports no patch)`. With no kept runs at all, `pickTool(root)` naming Gremlins adds the same line, so a Go project always hears it (C8c).
- **Shortfall reasons** are counted per reason and reported as counts: `no kept run`, `kept list predates calibration`, `drifted`, `not exact`, `no CRITERIA.md`, `unsupported`.

**P4. Selection is seeded and deterministic (C6).**
- **The split:** EASY gets `ceil(N/2)` and HARD gets `floor(N/2)`. A short set is NOT refilled from the other; requested and selected counts are reported per set.
- **The order:** each set's pool is first sorted by `(phase number, file, line, key)`. Then a mulberry32 PRNG seeded with `--seed` runs a partial Fisher–Yates, and the first n are taken.
- **The seed:** an integer from 0 to 2³²−1. When absent, one is drawn with `crypto.randomInt`, printed in the bill and logged, so every run can be repeated.
- **Defect ids** are `E1…`, `H1…` in selection order.

**P5. Each trial gets a fresh throwaway clone, holding exactly one planted mutant, with history and status that name nothing (C3, C4).**
- **Creating it:**
  - Per trial: `mkdtempSync(join(tmpdir(), 'ac-v-'))`. The prefix is neutral, because `PWD` is visible to the verifier.
  - It refuses (and the trial is invalid) if the realpath is inside `root`.
  - `git clone --no-hardlinks --no-tags --single-branch --quiet <root> <tmp>/repo`, then `git remote remove origin`.
  - The branch keeps its name unless the name matches the leak pattern; then it is renamed `main`.
- **Planting** is a direct write, never `git apply`:
  - **mutmut:** the line is replaced by the original line's leading whitespace plus `replacement_line.trimStart()`.
  - **Stryker:** `src.slice(0, off(start)) + replacement + src.slice(off(end))`, where `off(p) = lineStart[p.line-1] + p.column - 1` over the HEAD file text (UTF-16 indices).
  - After planting, `git diff --numstat` must show exactly one file changed. Otherwise the trial is invalid and the copy is discarded.
- **Scrub list:** one exported constant `SCRUB` in `lib/plant.mjs`. Each path is removed when present:
  - `.astrocode/.local/` (never cloned, since it is untracked);
  - `.astrocode/CALIBRATION.jsonl`;
  - every `SURVIVORS.json` and `VERDICT.json` under `.astrocode/`, live and archived;
  - `mutants/`, `reports/mutation/`, `.stryker-tmp/`, `.mutmut-cache`.
  - **Why:** SURVIVORS.json names the HARD defect's file, function and line, and VERDICT.json can carry the replacement text. Both would hand the verifier the defect.
  - **What stays:** the project's own tool configuration. It is the project `/astro-verify` sees.
- **Committing:** plant and scrub are folded into the tip with `git commit --amend --no-edit --allow-empty`. The tip's original committer name, email and date go in through `GIT_COMMITTER_*`.
  - So `git status --porcelain` is empty, and every `git log --all` subject is the project's own.
  - No new commit or branch can name the plant.
- **Then:**
  - `touch .git/astrocode-scratch`.
  - Symlink `node_modules`, `.venv` and `venv` from root into the copy, only when present at root AND git-ignored in the copy. Without them the verifier's suite cannot run, and every trial would FAIL for the wrong reason.
- **Removal:** the copy is removed in `finally`. SIGINT also removes it, and no copy outlives the command.
- **`blindnessCheck(copyDir, { prompt, env })`** runs in code before every spawn. It fails the trial as invalid (`reason: blindness: …`, the trial never spawns) when:
  - any `SCRUB` path still exists;
  - an env var NAME matches `LEAK_RE = /calibrat|plant|mutant|mutat|defect|mutmut|stryker/i`;
  - the calibrate-authored prompt framing matches `LEAK_RE`.
  - **Project-sourced text is only reported**, once per run as a `⚠ blindness:` line. This covers the goal, the slug, history subjects, ref names and env values such as PATH: it belongs to the project and `/astro-verify` passes it too, so refusing on it would make calibration unusable on real projects.
- **FLAGGED for the human at plan review:** C3 says the copy's tree differs from the original by "exactly one mutant … nothing else", but C4 forbids the judgement, verdict and log files that the scrub removes.
  - This plan honours C4 (blindness is the point of D5).
  - It reports the removed paths per trial in `--json` (`scrubbed: [...]`). The only source difference stays the single planted hunk, which is what is asserted.
  - **Known limit,** stated in the MANUAL: earlier commits in history still contain the old SURVIVORS.json, which `git log -p` could find. History is kept because the verifier checks that the phase's commits are present.

**P6. The verifier runs headless as the installed `astro-verifier` agent, with `/astro-verify`'s own contract (C4).**
- **The argv** is built by `lib/hosts/claude.mjs` `execCommand`, which t4 extends with optional `agent` and `maxBudgetUsd`:
  ```
  claude --print --output-format json --model <resolveModels(root).verifier unless inherit> \
         --allowedTools <the agent's frontmatter tools> --agent astro-verifier --max-budget-usd <remaining> <prompt>
  ```
  - `cwd` is the copy. `env` is `process.env` minus leak-named vars and `NODE_TEST_CONTEXT`.
  - It runs through `runCapped` with `VERIFY_TRIAL_CAP_MS = 45 min`.
  - The agent role text, which generically mentions the project's mutation tool per ADR-084, is loaded by Claude Code from the installed agent, exactly as `/astro-verify`'s spawn loads it. It is not in the argv.
- **The contract is single-sourced:** t4 wraps step 2's restated-contract sentence in `commands/astro-verify.md` with `<!-- verifier-contract -->` … `<!-- /verifier-contract -->`. `verifierContract()` reads it from the package's own `commands/astro-verify.md` (resolved via `import.meta.url`) and throws if the markers are missing. No second copy exists.
- **The trial prompt** is a fixed calibrate-authored frame around that contract. It contains no leak word, and a unit test asserts this:
  - phase number, slug and goal;
  - the absolute path of CRITERIA.md in the copy;
  - the contract;
  - "this is a full verify, not narrowed";
  - "end with the fenced JSON verdict your role defines: `{"mode":"full","broad":false,"criteria":[{"id":"C1","passed":true}]}` covering every criterion".
- **PASS rule:** the last fenced ```json block of the envelope's `result` (or of stdout when it is not an envelope) parses, and every CRITERIA.md id has an entry with `passed === true`. An absent id counts as failed, as in a full `recordVerdict`.
  - This measures the verifier's OWN verdict. The ADR-085 code gate after it is not applied, because it needs the copy's own kept run. The output's definitions line says so.
- **An invalid trial is neither PASS nor FAIL.** It covers: non-zero exit, capped, envelope `is_error`, unparseable output, no `criteria[]`, a failed plant, or a failed blindness check. It is excluded from every n and counted separately. A crash is never a catch.
- **ENOENT on `claude`** stops the run with `stopped: "no-verifier"`. Nothing probes `claude --version` first, because the stub's invocation count must equal the trial count (C5).
- **Cost** is the envelope's `total_cost_usd`. When it is absent, the trial is charged the per-trial estimate and marked `cost_estimated: true`.
- **Prompt fingerprint** for the log (D3, C9): `prompt_hash = sha256` of the package `agents/astro-verifier.md`, the installed agent file if present, the contract text and the frame template.
  - The installed file is found at `$CLAUDE_CONFIG_DIR/agents/astro-verifier.md`, else `~/.claude/agents/astro-verifier.md`.
  - Component hashes `agent_sha`, `installed_agent_sha` (or null) and `contract_sha` are also recorded, plus the package `version`.
  - Editing either agent file or the contract changes the hash.

**P7. The bill and the budget are in USD, measured from Claude's own report (CONTEXT open item 2).**
- **Per-trial estimate:** the median measured per-trial cost over the last ≤5 log records that have one. Otherwise `DEFAULT_TRIAL_USD = 3.00`, labelled "estimate — no recorded runs".
- **The bill** is `selected defects × runs × per-trial`, printed with its basis.
- **The budget** is new: `--budget <usd>` (C7 asks for "whatever control the command exposes"). Its default is `bill × 1.5`, printed beside the bill.
- **Order:** trials run in rounds. Round r gives every selected defect its r-th trial, so a stop leaves defects with k or k−1 trials, never K and 0.
- **Start rule:** before each trial, it starts only if `spent + expected ≤ budget`, where `expected` is the mean measured trial cost so far, else the estimate. `--max-budget-usd` gets `budget − spent` as a hard belt.
- **When it stops:** reaching the limit stops cleanly with `stopped: "budget"`. The report and the log give completed trials and the defects they cover, and rates are computed only over trials that ran.
- **Without `--yes`:** the command prints the bill and the seed and stops. There is no clone, no spawn and no log write, and it exits 0 (C1). The bill is printed first on a `--yes` run too.

**P8. Statistics (C5, D6).**
- **False PASS:** a PASS verdict on a copy holding a planted defect.
- Per set, two rates, each with a Wilson 95% interval (z = 1.96, never Wald):
  - **defect rate** (headline): defects PASSed on at least one valid trial ÷ defects with at least one valid trial;
  - **trial rate:** PASS trials ÷ valid trials.
- **pass^k** means the defect is caught on all k runs. Per defect it uses the unbiased `C(c,k)/C(n,k)` for k = 1…n, where c is the FAIL count and n the valid trials. The set value is the mean over defects. Always-PASSed gives 0,0,0, PASSed 1 of 3 gives .67,.33,0, and never-PASSed gives 1,1,1.
- **Small sets:** `MIN_DEFECTS_PER_SET = 5`. Below it the set is marked "too few defects to rely on". A set with zero selected defects is `unavailable: <reason>` with no number (C8b).
- The output states these definitions in one line.

**P9. The log is `.astrocode/CALIBRATION.jsonl`: append-only, committed, outside the ignored `.local/` (D3, C9).**
- **Writing:** one JSON line per `--yes` run, including a run stopped before any trial. It is appended under `withLock` (read, then `atomicWriteText` with the extra line) and committed alone: `git add` and `git commit -- <file>`, as `recordVerdict` does.
- **Commit subject:** `chore(astro): verifier run log <ISO date>`. It is neutral on purpose, because later copies clone this history (C4). A commit failure is reported as `committed: false` with its reason (b940).
- **Record fields:** `schema: 1`, `date`, `head`, `seed`, `requested {defects, runs}`, `selected {easy, hard}`, `completed {trials, planned_trials}`, `stopped`, `budget_usd`, `spent_usd`, `cost_basis`, `verifier {model, agent, prompt_hash, agent_sha, installed_agent_sha, contract_sha, version}`, `definitions`, `sets {easy, hard}` (each with `defect_rate` and `trial_rate` `{x, n, p, lo, hi}`, `pass_k[]`, `invalid`, `too_few`, `unavailable`), `defects[]`, `shortfall`, `unsupported`, `defect_set_hash`.
- **Each `defects[]` entry** is `{id, set, phase, tool, key, trials, passes, caught, invalid, pass_k[]}`. It holds no file, line or text, so a later copy's history never points at an earlier plant.
- **Comparability:** two records can be compared when their `defect_set_hash` values match.
- **Agreement with the output:** stdout and `--json` are rendered from the same object that is logged, so they cannot disagree (C9).

**P10. CLI: `ac verify calibrate [--defects N] [--runs K] [--seed S] [--budget USD] [--yes] [--json]`.**
- **The allowlist:** `ALLOWED_FLAGS['verify calibrate']` and `checkFlags`.
- **Rejections, all before any read of mutation data:**
  - `--defects` and `--runs` must be integers ≥1;
  - `--seed` must be an integer from 0 to 2³²−1, and a bare `--seed` dies;
  - `--budget` must be a number >0;
  - `--yes` and `--json` take no value;
  - an unknown subcommand dies with usage.
- **Defaults:** 10 × 3.
- **Exit codes:** 0 for a bill, a finished run, a budget stop or zero usable defects; 1 for a flag error or no `.astrocode/`.
- **Human output** is at most 8 summary lines plus one line per defect, capped at 20 with `+N more — --json`. The first line leads with both rates.

**P11. `/astro-calibrate` runs the bill first and passes `--yes` only after explicit agreement (C11).**
- It runs `ac verify calibrate <args>` without `--yes`.
- It relays the bill, then asks through AskUserQuestion, referencing `$(ac path templates)/asking.md`.
- Only on an explicit yes does it re-run with `--yes --seed <the seed the bill printed>`, so the plants are the billed ones.
- It relays the summary as printed, within the stated bound.
- It is never called by a loop command or workflow, and a guard test asserts this.

**P12. The decision is recorded with `ac decision add`** (t12), which claims the number. No task picks a number or writes an ADR file.

## Tasks

### t1: The full mutant list carries each mutant's exact change (P1)
- **id:** t1
- **file:** `lib/mutparse.mjs`, `lib/mutate.mjs`, `tests/mutate_plantfields.test.mjs` (new)
- **depends_on:** none
- **Test first** (dynamic import, the existing `tests/fixtures/mutate/project.mjs` rig and stub tools). Named tests:
  - "mutantsFileChanges reports a multi-line mutant in `multi` and leaves `changes` entries unchanged";
  - "a mutmut 3 run's list gives every in-scope killed and survived mutant its key, fn, kind, raw line_text, replacement_line and exact:true";
  - "a mutmut mutant described only by `mutmut show` is exact:false";
  - "a Stryker run's list gives every in-scope mutant its key, replacement and loc as reported";
  - "the list key equals the survivor key the kept run records for the same mutant";
  - "a Gremlins list is unchanged".
- **Implement:**
  - Add `multi` to `mutantsFileChanges`.
  - Carry `exact` through `mapMutmutLines` details: true for a generated-source change not in `multi`, false for `show`.
  - Have `triage`/`describeRun` hand `byMutant` to `writeFullList`, which adds the P1 fields for each in-scope line. `RUN_SURVIVOR_EXTRA` and the gate binding stay untouched.
- **Done:** the whole mutate suite stays green unedited.
- **Covers:** C3 (source exactness), C2 (killed/survived data).

### t2: `lib/calstats.mjs`: Wilson, rates, pass^k, seeded selection (P4, P8)
- **id:** t2
- **file:** `lib/calstats.mjs` (new), `tests/calstats.test.mjs` (new)
- **depends_on:** none
- **Test first** (dynamic import). Named tests:
  - "wilson(0,10) is [0, 0.2775] and wilson(5,10) is [0.2366, 0.7634] to 4 places";
  - "every interval contains its estimate and stays in [0,1], and 0/n has an upper bound > 0";
  - "passK distinguishes always-, sometimes- and never-PASSed defects (0,0,0 / .667,.333,0 / 1,1,1)";
  - "summarizeSet excludes invalid trials from n and counts them";
  - "summarizeSet marks too_few below MIN_DEFECTS_PER_SET and unavailable at zero defects";
  - "mulberry32 gives the same stream for the same seed";
  - "selectSeeded gives the same picks in the same order for the same seed, different picks for seed 7 and 8 over a pool of 20, and never repeats an item";
  - "selection ignores input order (sorted by stable key first)";
  - "parseSeed accepts 0…2³²−1 and rejects true, '', -1, 1.5 and 'abc'";
  - "splitCounts gives ceil/floor".
- **Implement** (pure, no fs): `wilson`, `rate`, `passK`, `summarizeSet`, `MIN_DEFECTS_PER_SET`, `mulberry32`, `selectSeeded(pool, n, seed, keyOf)`, `parseSeed`, `newSeed`, `splitCounts`, `DEFINITIONS` (the one-line definitions string).
- **Covers:** C5, C6, C8a (marking).

### t3: `lib/plant.mjs`: exact planting, the throwaway clone, scrub, blindness check (P5)
- **id:** t3
- **file:** `lib/plant.mjs` (new), `tests/plant.test.mjs` (new)
- **depends_on:** none
- **Test first** (dynamic import, real git under `mkdtempSync`). Named tests:
  - "plantChange replaces a mutmut line keeping the file's indentation and changes nothing else";
  - "plantChange applies a Stryker replacement at its 1-based location, multi-line ranges included, byte-exact elsewhere";
  - "plantChange refuses a mutmut line_text that no longer matches and a Stryker loc outside the file";
  - "makeCopy clones HEAD outside root, removes origin and tags, plants one file, scrubs SCRUB paths, and leaves `git status --porcelain` empty with every `git log --all` subject equal to the original's";
  - "the amended tip keeps the original committer name, email and date";
  - "a leaky branch name is renamed main";
  - "an ignored node_modules is linked and an unignored one is not";
  - "makeCopy refuses a tmpdir inside root";
  - "removeCopy leaves nothing behind";
  - "blindnessCheck fails on a remaining SCRUB path or a leak-named env var, and only reports project-sourced matches";
  - "the original repo's tree, index and refs are byte-identical after makeCopy and removeCopy".
- **Implement:** exports `SCRUB`, `LEAK_RE`, `plantChange(text, defect)`, `makeCopy(root, defect)` returning `{dir, repo, scrubbed}`, `removeCopy(copy)`, `blindnessCheck(repo, {prompt, frame, env})`, `trialEnv(env)`. Git only through `lib/git.mjs` `git()`.
- **Covers:** C3, C4.

### t4: Headless verifier trial: single-sourced contract, prompt, verdict parse, fingerprint (P6)
- **id:** t4
- **file:** `commands/astro-verify.md`, `lib/hosts/claude.mjs`, `lib/verifyrun.mjs` (new), `tests/verifyrun.test.mjs` (new)
- **depends_on:** none
- **Test first** (dynamic import). Named tests:
  - "verifierContract returns exactly the marked sentence of astro-verify.md and throws when the markers are missing";
  - "the marked contract still says plan-blind, assume FAIL, full suite and every criterion";
  - "trialPrompt carries the goal, the CRITERIA.md path and the contract, asks for a full run and the fenced verdict, and its frame matches no LEAK word" (the regex is declared locally in the test, so it does not depend on t3);
  - "execCommand adds --agent and --max-budget-usd only when given, and its existing argv is unchanged";
  - "trialArgv uses the agent's frontmatter tools and omits --model for inherit";
  - "parseTrialVerdict: all ids passed is pass; a missing or false id is fail; no fenced block, bad JSON, is_error or an empty criteria list is invalid; total_cost_usd is read and its absence is null";
  - "runTrial with an injected runner maps exit≠0, capped and ENOENT to invalid / no-verifier";
  - "promptFingerprint changes when the package agent, the installed agent (CLAUDE_CONFIG_DIR) or the contract changes".
- **Implement:**
  - Wrap step 2's contract sentence ("check goal + CRITERIA.md only … never silently trust the plan.") in the two markers. Change nothing else in `astro-verify.md`, and keep `tests/commands.test.mjs` and `tests/verify.test.mjs` green unedited.
  - Add `agent` and `maxBudgetUsd` to `execCommand`.
  - `lib/verifyrun.mjs` exports `VERIFY_TRIAL_CAP_MS`, `verifierContract`, `trialPrompt`, `trialArgv`, `parseTrialVerdict(stdout, criteriaIds)`, `runTrial({cwd, prompt, argv, env, run = runCapped})` and `promptFingerprint({ env })`.
- **Covers:** C4 (same contract), C5 (verdict rule), C9 (prompt hash).

### t5: Calibration test fixture and verifier stub
- **id:** t5
- **file:** `tests/fixtures/calibrate/project.mjs` (new), `tests/fixtures/calibrate/verifier_stub.mjs` (new)
- **depends_on:** none
- **Implement** (test infrastructure; the same shape as `tests/fixtures/mutate/project.mjs` and `tests/fixtures/claude_stub.mjs`):
  - **`makeCalibrationProject({ pool, testGap, gremlins, … })`** builds a git project under `mkdtempSync`:
    - a `roadmap.json` with ≥2 `complete` phases (one of them archived under `milestones/1/`) and one `pending` phase;
    - CRITERIA.md per phase;
    - Python and JS sources committed;
    - kept runs `<slug>.json` (real `head`) and `<slug>.mutants.jsonl` in the P1 format, with mutmut and Stryker mutants of every status;
    - SURVIVORS.json with `test-gap`, `equivalent` and unjudged entries.
    - It returns the expected easy and hard keys per phase.
  - **`writeVerifierStub(binDir, { original, script, logFile })`** writes an executable `claude`. Per invocation it appends one JSON line holding: argv, stdin, cwd, env, `git status --porcelain`, `git log --all --format=%s`, `git for-each-ref` names, the file list, and the diff of its tree against `original`. It then answers with a JSON envelope whose `result` holds a fenced verdict and whose `total_cost_usd` is scripted. Outcomes are scripted per plant (matched on the diff text) as a PASS/FAIL sequence. It answers `--version` without logging.
- **Done:** imported by t6–t9. It holds no assertions of its own.

### t6: `lib/calibrate.mjs` part 1: accepted phases, candidates, selection, bill, log (P1–P4, P7, P9)
- **id:** t6
- **file:** `lib/calibrate.mjs` (new), `tests/calibrate.test.mjs` (new)
- **depends_on:** t2, t5
- **Test first** (dynamic import, t5 fixture). Named tests:
  - "acceptedPhases lists complete phases from the live roadmap and every milestone snapshot with their directories, never pending or verified ones";
  - "candidates: easy is killed-only, hard is test-gap-only, and nothing comes from a non-accepted phase";
  - "a drifted file, a non-exact mutmut change, a pre-phase list and a missing kept run each become a counted shortfall reason";
  - "a gremlins kept run, or pickTool naming Gremlins with no runs, yields `unsupported: gremlins`";
  - "planCalibration with a seed selects deterministically, splits ceil/floor, never pads a short set and reports requested vs selected";
  - "the bill scales with defects × runs and names its basis: constant with no log, median of logged per-trial cost with one";
  - "budget defaults to 1.5× the bill and --budget overrides it";
  - "appendLog appends one line under the lock, keeps earlier lines byte-identical, commits only that file with the neutral subject, and is not git-ignored";
  - "planCalibration writes nothing and creates no directory".
- **Implement:** exports `CALIBRATION_FILE`, `DEFAULT_TRIAL_USD`, `acceptedPhases(root)`, `gatherCandidates(root)`, `planCalibration(root, {defects, runs, seed, budget})` (read-only, returns the bill), `readLog(root)`, `appendLog(root, record)` and `defectSetHash(defects)`. Reuse `readMutateRun`, `mutateRunPaths`, `readJudgements`, `parseCriteriaIds`, `pickTool`, `SURVIVOR_STATUSES`, `loadRoadmap`/`readJSON` and the t2 helpers. No second copy of any of their rules.
- **Covers:** C1 (bill), C2, C6, C8, C9 (log).

### t7: `lib/calibrate.mjs` part 2: the trial loop, budget stop, summary and record (P5–P9)
- **id:** t7
- **file:** `lib/calibrate.mjs`, `tests/calibrate_run.test.mjs` (new)
- **depends_on:** t3, t4, t6
- **Test first** (dynamic import, t5 fixture, injected `run` standing in for `runCapped`). Named tests:
  - "every defect gets exactly K trials in rounds, each in a fresh copy that is removed afterwards";
  - "scripted outcomes give the expected defect and trial rates and per-defect pass^k";
  - "with a fixed cost per trial and a budget below the bill, no trial starts once spent + expected exceeds the budget, the result says stopped budget with completed counts, and rates cover only trials that ran";
  - "--max-budget-usd carries the remaining budget";
  - "an invalid trial is excluded from n and listed";
  - "ENOENT stops the run with no-verifier after one attempt";
  - "a blindness failure never spawns";
  - "the record equals the returned summary and is appended once";
  - "no VERDICT.json, SURVIVORS.json, roadmap or state file in root changes";
  - "an abort signal stops between trials, removes the copy and records stopped interrupted".
- **Implement:** `runCalibration(root, plan, { run, signal, now })`, the trial loop of P7, and `renderSummary(result)`, which gives the bounded human lines of P10 (built from the same object as the record).
- **Covers:** C3, C4 (in-process), C5, C7, C8, C9.

### t8: CLI `ac verify calibrate`: flags, bill gate, output (P10)
- **id:** t8
- **file:** `bin/ac.mjs`, `tests/calibrate_cli.test.mjs` (new)
- **depends_on:** t7
- **Test first** (spawns `node bin/ac.mjs` against the t5 fixture, with the stub `claude` first on PATH and `CLAUDE_CONFIG_DIR` pointed at a temp dir). Named tests:
  - "`--run 5`, `--defects 0`, `--runs abc`, a bare `--seed`, `--budget -1` and `--yes 3` each exit non-zero, with zero stub invocations";
  - "no --yes prints the bill (cost, defects × runs, seed, budget, --yes needed) and leaves the stub log empty, the log byte-identical, `git status` unchanged and no `ac-v-` dir in TMPDIR";
  - "the bill for --runs 4 exceeds the bill for --runs 2";
  - "--json without --yes returns the bill with needs_yes and never implies consent";
  - "a --yes --json run returns sets, defects and the log path, and stdout leads with both rates";
  - "`ac verify` with no or an unknown subcommand dies with usage";
  - "the help lists `ac verify calibrate`".
- **Implement:**
  - `case 'verify'` with `calibrate`, and `ALLOWED_FLAGS['verify calibrate'] = ['defects','runs','seed','budget','yes','json']`.
  - Flag validation via the t2 `parseSeed` plus integer and number checks before `planCalibration`.
  - The bill print, the `--yes` gate, `runCalibration` with a SIGINT `AbortController`, `renderSummary`/`json()`, and the help lines.
  - Nothing else in `bin/ac.mjs` changes.
- **Covers:** C1, C10, C2/C5 (surface).

### t9: End-to-end calibration scenarios through the CLI (test-after gate)
- **id:** t9
- **file:** `tests/calibrate_e2e.test.mjs` (new)
- **depends_on:** t1, t8
- **Explicitly test-after.** It drives only `node bin/ac.mjs` with the stub `claude`, against t5 fixtures:
  1. C2: the defects listed match the fixture's killed keys and test-gap keys from accepted phases only, with two separate rates.
  2. C3: every stub record's cwd lies outside the fixture, its diff is one hunk equal to the recorded change for both tools, the fixture's `git status` and `git diff` are empty afterwards, and no `ac-v-*` dir remains.
  3. C4: no stub record's argv, stdin, env names, status, log subjects, ref names or file list match `LEAK_RE`, and there is no `mutants/`, report, SURVIVORS.json, VERDICT.json or calibration log in the copy. The contract text in argv equals `verifierContract()`, and argv names `--agent astro-verifier`.
  4. C5: scripted always / one-of-three / never PASS, with `n×3` invocations, matching rates, intervals and pass^k.
  5. C6: seed 7 twice gives identical defects and diffs, and seed 8 differs, over a pool of 20.
  6. C7: a `--budget` below the bill stops early with honest counts and `stopped: budget` in stdout, JSON and the log.
  7. C8: (a) 2 easy and 1 hard with `--defects 10` gives real counts and too-few marks, (b) no test-gap gives hard unavailable, (c) Gremlins-only data says Gremlins is not supported.
  8. C9: two runs with the agent edited in between give two records, the first byte-identical, the hashes differing, the numbers equal to stdout and JSON, and `git check-ignore` exiting 1.
  9. Producer to consumer: a real `ac mutate` run with the stub mutation tools (the `tests/fixtures/mutate` rig) on an accepted phase feeds `ac verify calibrate`, which plants its killed mutant exactly.
- **No production code.** A defect it exposes belongs to the owning task, re-run.
- **Covers:** C2 to C9.

### t10: `/astro-calibrate` slash command, help line, and the never-in-the-loop guard (P11)
- **id:** t10
- **file:** `commands/astro-calibrate.md` (new), `commands/astro-help.md`, `tests/commands.test.mjs`
- **depends_on:** none
- **Test first** (extends `tests/commands.test.mjs`, reusing `assertSlotBound`). Named tests:
  - "phase 51: /astro-calibrate runs `ac verify calibrate` without --yes first, asks through AskUserQuestion, and passes --yes with the bill's --seed only after an explicit yes";
  - "phase 51: every reporting slot in astro-calibrate.md states a bound";
  - "phase 51: no loop command (discuss, plan, execute, verify, accept, status, debt) and no file in workflows/ mentions calibrate";
  - "astro-help lists /astro-calibrate".
- **Implement:**
  - The command has frontmatter (`description`, `argument-hint: [--defects N] [--runs K] [--seed S] [--budget USD]`, `allowed-tools: Bash, AskUserQuestion`) and numbered steps per P11.
  - **Reporting bounds:**
    - the bill relayed as printed, at most 5 lines;
    - the run summary relayed as `ac` prints it, at most 8 lines plus `ac`'s capped per-defect lines;
    - "say nothing else".
  - **Never:** pass `--yes` without the human's explicit agreement to that bill, or call anything but `ac verify calibrate`.
  - It references `$(ac path templates)/asking.md`, which keeps the existing asking test green.
  - One `astro-help.md` line.
- **Covers:** C11.

### t11: MANUAL and CHANGELOG
- **id:** t11
- **file:** `MANUAL.md`, `CHANGELOG.md`, `tests/calibrate_docs.test.mjs` (new)
- **depends_on:** t8, t10, t12
- **Test first.** Named tests:
  - "the MANUAL has a `## Verifier calibration` section, separate from the mutation section's line budget, naming `ac verify calibrate`, every flag, `/astro-calibrate`, `.astrocode/CALIBRATION.jsonl`, `--yes`, `test-gap`, `Gremlins`, `Wilson`, `pass^k` and `too few defects`";
  - "the MANUAL command list has /astro-calibrate";
  - "CHANGELOG Unreleased names `ac verify calibrate`".
- **MANUAL section** (≤70 lines). It covers:
  - what the two sets are and where the data comes from (kept runs, plus the re-run note for pre-phase lists);
  - the bill, the budget and `--yes`;
  - blindness: the clone, the scrub list, the folded tip, the agent and contract, and the known history limit;
  - the definitions and the small-set rule;
  - the log, its comparability through `defect_set_hash`, and that it never touches phase state;
  - that astro-code itself cannot be calibrated.
- **CHANGELOG:** an Unreleased entry citing the new ADR.
- No version bump.
- **Covers:** documentation of C1 to C11.

### t12: Record the calibration decision through the claim (P12)
- **id:** t12
- **file:** `.astrocode/DECISIONS.md`, `.astrocode/DECISIONS.in-force.md`
- **depends_on:** none
- **Implement:** run `ac decision add "Verifier calibration measures the verifier's own verdict on exact ac mutate defects planted into a blind throwaway clone" --why "…" --rejected "…"`. Never pick a number or write an ADR file by hand.
  - **Why:** it states P1, P5, P6, P7, P8 and P9 in one paragraph:
    - the kept runs as the source, with EASY killed and HARD test-gap;
    - the per-trial clone with the folded tip and scrub;
    - the installed agent plus the contract read from `astro-verify.md`;
    - a USD budget from Claude's reported cost, bill first, with `--yes`;
    - Wilson defect and trial rates with pass^k;
    - the committed `CALIBRATION.jsonl` with key-only defects;
    - never in the loop, and never writes phase state.
  - **Rejected:** re-running the tool inside calibrate; a fresh-init copy (no phase commits, so the verifier would FAIL structurally); a neutral plant commit; Wald intervals; a pooled-trials headline.
- **Done:** the claimed id is reported. t11 depends on t12, so the CHANGELOG cites a number that already exists.

## Wave shape
- Wave 1: t1, t2, t3, t4, t5, t10, t12
- Wave 2: t6
- Wave 3: t7
- Wave 4: t8
- Wave 5: t9, t11

## Same-file ownership check
- `lib/calibrate.mjs` has two owning tasks: t6, then t7 (t7 depends on t6).
- Every other file has exactly one owning task:
  - `bin/ac.mjs` (t8);
  - `tests/commands.test.mjs` (t10);
  - `commands/astro-verify.md` and `lib/hosts/claude.mjs` (t4);
  - `lib/mutate.mjs` and `lib/mutparse.mjs` (t1).
- No task deletes or renames a symbol.
  - t1 adds a top-level key to `mutantsFileChanges` and adds fields to list lines.
  - t4 adds optional `execCommand` parameters and two HTML comments.
  - So every wave boundary compiles.
- RED tests in t1–t4 and t6–t8 import only through `await import(...)` inside async tests (ADR-018).
- t9 is explicitly test-after. t5 is test infrastructure imported only by later waves.
- No task carries `commits: none`.
